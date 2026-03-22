'use client';
// lib/playerStore.tsx — Global player state
//
// Track load state machine (per-song, not global):
//   ┌─ track changes (SET_INDEX / PREPEND_TRACKS)
//   │    → trackLoadingId = track.id   ← skeleton starts
//   │    → start 5s timeout
//   │
//   ├─ progress > 0 (first timeupdate with movement)
//   │    → trackLoadingId = null        ← skeleton stops, song playing fine
//   │    → cancel timeout
//   │
//   └─ 5s timeout fires (no progress yet)
//        → trackErrors.add(track.id)   ← broken card shown
//        → trackLoadingId = null

import React, {
  createContext, useContext, useReducer, useRef,
  useEffect, useCallback, ReactNode,
} from 'react';
import { TrackMeta, getAllTracks, saveTrack, removeTrack, clearQueue } from './db';
import { rebuildCoverUrl } from './metaParser';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PlayerState {
  queue:          TrackMeta[];
  currentIndex:   number;
  isPlaying:      boolean;
  volume:         number;
  progress:       number;
  currentTime:    number;
  duration:       number;
  shuffle:        boolean;
  repeat:         'none' | 'one' | 'all';
  loading:        boolean;          // parsing/adding new files
  restoring:      boolean;          // recovering queue from IDB on reload
  trackErrors:    Set<string>;      // track ids that definitively failed (5s timeout)
  trackLoadingId: string | null;    // id of the track currently being loaded (skeleton)
}

type Action =
  | { type: 'SET_QUEUE';          queue: TrackMeta[] }
  | { type: 'PREPEND_TRACKS';     tracks: TrackMeta[] }
  | { type: 'UPDATE_TRACK';       track: TrackMeta }
  | { type: 'REMOVE_TRACK';       id: string }
  | { type: 'CLEAR_QUEUE' }
  | { type: 'SET_INDEX';          index: number }
  | { type: 'SET_PLAYING';        playing: boolean }
  | { type: 'SET_VOLUME';         volume: number }
  | { type: 'SET_PROGRESS';       progress: number; currentTime: number; duration: number }
  | { type: 'TOGGLE_SHUFFLE' }
  | { type: 'CYCLE_REPEAT' }
  | { type: 'SET_LOADING';        loading: boolean }
  | { type: 'SET_RESTORING';      restoring: boolean }
  | { type: 'SET_TRACK_ERROR';    id: string }
  | { type: 'CLEAR_TRACK_ERROR';  id: string }
  | { type: 'SET_TRACK_LOADING';  id: string | null };   // ← new: drive skeleton

interface PlayerContextValue {
  state:     PlayerState;
  audioRef:  React.RefObject<HTMLAudioElement>;
  dispatch:  React.Dispatch<Action>;
  play:      (index?: number) => void;
  pause:     () => void;
  toggle:    () => void;
  next:      () => void;
  prev:      () => void;
  seek:      (fraction: number) => void;
  addFiles:  (files: FileList | File[], handles?: FileSystemFileHandle[]) => Promise<void>;
  removeFromQueue: (id: string) => void;
  clearAll:  () => void;
}

// ─── Reducer ─────────────────────────────────────────────────────────────────

const initial: PlayerState = {
  queue: [], currentIndex: 0, isPlaying: false,
  volume: 0.8, progress: 0, currentTime: 0, duration: 0,
  shuffle: false, repeat: 'none', loading: false, restoring: false,
  trackErrors: new Set<string>(), trackLoadingId: null,
};

function reducer(state: PlayerState, action: Action): PlayerState {
  switch (action.type) {
    case 'SET_QUEUE':
      return { ...state, queue: action.queue };
    case 'PREPEND_TRACKS':
      return { ...state, queue: [...action.tracks, ...state.queue], currentIndex: 0 };
    case 'UPDATE_TRACK':
      return { ...state, queue: state.queue.map(t => t.id === action.track.id ? action.track : t) };
    case 'REMOVE_TRACK': {
      const idx      = state.queue.findIndex(t => t.id === action.id);
      const newQueue = state.queue.filter(t => t.id !== action.id);
      let   newIndex = state.currentIndex;
      if (idx < state.currentIndex)   newIndex--;
      if (idx === state.currentIndex) newIndex = Math.min(newIndex, newQueue.length - 1);
      const errs = new Set(state.trackErrors); errs.delete(action.id);
      return { ...state, queue: newQueue, currentIndex: Math.max(0, newIndex), trackErrors: errs };
    }
    case 'CLEAR_QUEUE':
      return { ...state, queue: [], currentIndex: 0, isPlaying: false, restoring: false, trackErrors: new Set(), trackLoadingId: null };
    case 'SET_INDEX':
      return { ...state, currentIndex: action.index };
    case 'SET_PLAYING':
      return { ...state, isPlaying: action.playing };
    case 'SET_VOLUME':
      return { ...state, volume: action.volume };
    case 'SET_PROGRESS':
      return { ...state, progress: action.progress, currentTime: action.currentTime, duration: action.duration };
    case 'TOGGLE_SHUFFLE':
      return { ...state, shuffle: !state.shuffle };
    case 'CYCLE_REPEAT': {
      const order: PlayerState['repeat'][] = ['none', 'all', 'one'];
      const next = order[(order.indexOf(state.repeat) + 1) % order.length];
      return { ...state, repeat: next };
    }
    case 'SET_LOADING':       return { ...state, loading:        action.loading };
    case 'SET_RESTORING':     return { ...state, restoring:      action.restoring };
    case 'SET_TRACK_LOADING': return { ...state, trackLoadingId: action.id };
    case 'SET_TRACK_ERROR': {
      const errs = new Set(state.trackErrors); errs.add(action.id);
      return { ...state, trackErrors: errs, trackLoadingId: null };
    }
    case 'CLEAR_TRACK_ERROR': {
      const errs = new Set(state.trackErrors); errs.delete(action.id);
      return { ...state, trackErrors: errs };
    }
    default: return state;
  }
}

// ─── Context ──────────────────────────────────────────────────────────────────

const PlayerContext = createContext<PlayerContextValue | null>(null);

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [state, dispatch]  = useReducer(reducer, initial);
  const audioRef           = useRef<HTMLAudioElement>(null!);
  const objectUrlsRef      = useRef<Map<string, string>>(new Map());

  // Ref to hold the 5-second load-timeout so we can cancel it
  const loadTimeoutRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ref tracking which track id we last started the timeout for (avoids stale closures)
  const loadingTrackIdRef  = useRef<string | null>(null);

  // ── Helper: start the skeleton + 5s failure timer for a track ────────────
  const beginLoadWatch = useCallback((trackId: string) => {
    // Cancel any previous timer
    if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
    loadingTrackIdRef.current = trackId;

    // Show skeleton immediately
    dispatch({ type: 'SET_TRACK_LOADING', id: trackId });

    // 5s fallback — if progress never moved, mark as error
    loadTimeoutRef.current = setTimeout(() => {
      if (loadingTrackIdRef.current === trackId) {
        dispatch({ type: 'SET_TRACK_ERROR', id: trackId });
        loadingTrackIdRef.current = null;
      }
    }, 5000);
  }, []);

  // ── Helper: cancel the skeleton (song loaded successfully) ───────────────
  const clearLoadWatch = useCallback((trackId: string) => {
    if (loadingTrackIdRef.current !== trackId) return;
    if (loadTimeoutRef.current) { clearTimeout(loadTimeoutRef.current); loadTimeoutRef.current = null; }
    loadingTrackIdRef.current = null;
    dispatch({ type: 'SET_TRACK_LOADING', id: null });
  }, []);

  useEffect(() => () => { if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current); }, []);

  // ── MOUNT: restore persisted queue ───────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const stored = await getAllTracks();
        if (!stored.length) return;

        dispatch({ type: 'SET_RESTORING', restoring: true });

        const withCovers = stored.map(t => ({
          ...t,
          coverUrl: t.coverData ? rebuildCoverUrl(t) : undefined,
        }));
        dispatch({ type: 'SET_QUEUE', queue: withCovers });

        let firstResolved = false;

        for (const track of withCovers) {
          if (!track.fileHandle) continue;
          try {
            const perm = await (track.fileHandle as any).queryPermission({ mode: 'read' });
            let granted = perm === 'granted';
            if (!granted) {
              const req = await (track.fileHandle as any).requestPermission({ mode: 'read' });
              granted = req === 'granted';
            }
            if (!granted) continue;

            const file     = await track.fileHandle.getFile();
            const audioUrl = URL.createObjectURL(file);
            objectUrlsRef.current.set(track.id, audioUrl);

            if (!firstResolved) {
              firstResolved = true;
              const audio = audioRef.current;
              if (audio) { audio.src = audioUrl; audio.volume = state.volume; }
            }
          } catch { /* stale handle — skip */ }
        }

        dispatch({ type: 'SET_RESTORING', restoring: false });
      } catch {
        dispatch({ type: 'SET_RESTORING', restoring: false });
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Volume sync ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = state.volume;
  }, [state.volume]);

  // ── Play / pause sync ─────────────────────────────────────────────────────
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (state.isPlaying) audio.play().catch(() => dispatch({ type: 'SET_PLAYING', playing: false }));
    else audio.pause();
  }, [state.isPlaying]);

  // ── Load audio src when current track changes ─────────────────────────────
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !state.queue.length) return;
    const track = state.queue[state.currentIndex];
    if (!track) return;

    const url = objectUrlsRef.current.get(track.id);
    if (url && audio.src !== url) {
      audio.src = url;
      // Start skeleton + 5s watchdog for this track
      beginLoadWatch(track.id);
      if (state.isPlaying) audio.play().catch(console.warn);
    } else if (!url) {
      // No audio URL at all — immediately mark as error (no blob, no handle)
      // Small delay so the card renders first
      setTimeout(() => dispatch({ type: 'SET_TRACK_ERROR', id: track.id }), 300);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.currentIndex, state.queue.length]);

  // ── Audio event listeners ─────────────────────────────────────────────────
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => {
      const dur = audio.duration || 0;
      const cur = audio.currentTime;
      dispatch({ type: 'SET_PROGRESS', progress: dur ? cur / dur : 0, currentTime: cur, duration: dur });

      // Progress moved → song is genuinely playing — cancel skeleton
      if (cur > 0) {
        const { queue, currentIndex } = state;
        const track = queue[currentIndex];
        if (track) clearLoadWatch(track.id);
      }
    };

    const onEnded = () => {
      const { queue, currentIndex, repeat, shuffle } = state;
      if (repeat === 'one') { audio.currentTime = 0; audio.play(); return; }
      if (shuffle)          { dispatch({ type: 'SET_INDEX', index: Math.floor(Math.random() * queue.length) }); return; }
      const next = currentIndex + 1;
      if (next < queue.length)   dispatch({ type: 'SET_INDEX', index: next });
      else if (repeat === 'all') dispatch({ type: 'SET_INDEX', index: 0 });
      else                       dispatch({ type: 'SET_PLAYING', playing: false });
    };

    const onLoadedMeta = () => {
      dispatch({ type: 'SET_PROGRESS', progress: 0, currentTime: 0, duration: audio.duration || 0 });
    };

    audio.addEventListener('timeupdate',     onTimeUpdate);
    audio.addEventListener('ended',          onEnded);
    audio.addEventListener('loadedmetadata', onLoadedMeta);
    return () => {
      audio.removeEventListener('timeupdate',     onTimeUpdate);
      audio.removeEventListener('ended',          onEnded);
      audio.removeEventListener('loadedmetadata', onLoadedMeta);
    };
  });

  // ── MediaSession API ──────────────────────────────────────────────────────
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const track = state.queue[state.currentIndex];
    if (!track) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title, artist: track.artist, album: track.album,
      artwork: track.coverUrl ? [{ src: track.coverUrl, sizes: '512x512' }] : [],
    });
    navigator.mediaSession.setActionHandler('play',          toggle);
    navigator.mediaSession.setActionHandler('pause',         toggle);
    navigator.mediaSession.setActionHandler('nexttrack',     next);
    navigator.mediaSession.setActionHandler('previoustrack', prev);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.currentIndex, state.queue]);

  // ─── Helpers ──────────────────────────────────────────────────────────────

  const play = useCallback((index?: number) => {
    if (index !== undefined) dispatch({ type: 'SET_INDEX', index });
    dispatch({ type: 'SET_PLAYING', playing: true });
  }, []);

  const pause  = useCallback(() => dispatch({ type: 'SET_PLAYING', playing: false }), []);
  const toggle = useCallback(() => dispatch({ type: 'SET_PLAYING', playing: !state.isPlaying }), [state.isPlaying]);

  const next = useCallback(() => {
    const { queue, currentIndex, shuffle } = state;
    if (!queue.length) return;
    const idx = shuffle ? Math.floor(Math.random() * queue.length) : (currentIndex + 1) % queue.length;
    dispatch({ type: 'SET_INDEX', index: idx });
    dispatch({ type: 'SET_PLAYING', playing: true });
  }, [state]);

  const prev = useCallback(() => {
    const { queue, currentIndex } = state;
    if (!queue.length) return;
    const audio = audioRef.current;
    if (audio && audio.currentTime > 3) { audio.currentTime = 0; return; }
    dispatch({ type: 'SET_INDEX', index: (currentIndex - 1 + queue.length) % queue.length });
    dispatch({ type: 'SET_PLAYING', playing: true });
  }, [state]);

  const seek = useCallback((fraction: number) => {
    const audio = audioRef.current;
    if (audio?.duration) audio.currentTime = fraction * audio.duration;
  }, []);

  const addFiles = useCallback(async (files: FileList | File[], handles?: FileSystemFileHandle[]) => {
    const { parseFileMeta, isAudioFile } = await import('./metaParser');
    const arr = Array.from(files).filter(isAudioFile);
    if (!arr.length) return;

    dispatch({ type: 'SET_LOADING', loading: true });

    const tracks: TrackMeta[] = [];
    for (let i = 0; i < arr.length; i++) {
      const file   = arr[i];
      const handle = handles?.[i];
      const meta   = await parseFileMeta(file, handle);

      const audioUrl = URL.createObjectURL(file);
      objectUrlsRef.current.set(meta.id, audioUrl);
      tracks.push(meta);
      saveTrack(meta).catch(() => {});
    }

    // Clear any prior errors for re-added tracks
    tracks.forEach(t => dispatch({ type: 'CLEAR_TRACK_ERROR', id: t.id }));
    dispatch({ type: 'PREPEND_TRACKS', tracks });
    dispatch({ type: 'SET_LOADING', loading: false });

    // Auto-play first track + begin load watch
    const audio = audioRef.current;
    if (audio) {
      const url = objectUrlsRef.current.get(tracks[0].id);
      if (url) {
        audio.src = url;
        beginLoadWatch(tracks[0].id);
        audio.play().catch(() => {});
        dispatch({ type: 'SET_PLAYING', playing: true });
      }
    }
  }, [beginLoadWatch]);

  const removeFromQueue = useCallback((id: string) => {
    const url = objectUrlsRef.current.get(id);
    if (url) { URL.revokeObjectURL(url); objectUrlsRef.current.delete(id); }
    dispatch({ type: 'REMOVE_TRACK', id });
    removeTrack(id).catch(() => {});
  }, []);

  const clearAll = useCallback(() => {
    const audio = audioRef.current;
    if (audio) { audio.pause(); audio.src = ''; }
    if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
    objectUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
    objectUrlsRef.current.clear();
    dispatch({ type: 'CLEAR_QUEUE' });
    clearQueue().catch(() => {});
  }, []);

  return (
    <PlayerContext.Provider value={{ state, audioRef, dispatch, play, pause, toggle, next, prev, seek, addFiles, removeFromQueue, clearAll }}>
      <audio ref={audioRef} preload="metadata" />
      {children}
    </PlayerContext.Provider>
  );
}

export function usePlayer() {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('usePlayer must be used inside PlayerProvider');
  return ctx;
}
