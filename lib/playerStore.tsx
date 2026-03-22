"use client";
// lib/playerStore.tsx
//
// Fix log:
//  P1 — Background suspend kills blob URLs → audio error → tracks marked failed + queue wiped.
//       Fix: (a) re-enable IDB queue persistence on reload so queue survives page discard,
//            (b) on visibilitychange=visible, re-create blob URLs from fileHandles silently,
//            (c) use preload="auto" on audio element so browser buffers before suspend,
//            (d) don't mark track as error on audio 'error' event alone — only the 5s
//                watchdog should trigger errors (blob URLs can briefly 404 during resume).
//  P2 — useFolderScanner permissions expire mid-iteration on Android.
//       Fix: re-request permission on each file access individually (in useFolderScanner).
//  P3 — No loading UI when adding many songs.
//       Fix: state.loading is already set; page.tsx now shows a progress bar when true.

import React, {
  createContext,
  useContext,
  useReducer,
  useRef,
  useEffect,
  useCallback,
  ReactNode,
} from "react";
import {
  TrackMeta,
  getAllTracks,
  saveTrack,
  removeTrack,
  clearQueue,
} from "./db";
import { rebuildCoverUrl } from "./metaParser";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PlayerState {
  queue: TrackMeta[];
  currentIndex: number;
  isPlaying: boolean;
  volume: number;
  progress: number;
  currentTime: number;
  duration: number;
  shuffle: boolean;
  repeat: "none" | "one" | "all";
  loading: boolean;
  restoring: boolean;
  trackErrors: Set<string>;
  trackLoadingId: string | null;
}

type Action =
  | { type: "SET_QUEUE"; queue: TrackMeta[] }
  | { type: "PREPEND_TRACKS"; tracks: TrackMeta[] }
  | { type: "APPEND_TRACKS"; tracks: TrackMeta[] }
  | { type: "REORDER_QUEUE"; queue: TrackMeta[] }
  | { type: "UPDATE_TRACK"; track: TrackMeta }
  | { type: "REMOVE_TRACK"; id: string }
  | { type: "CLEAR_QUEUE" }
  | { type: "SET_INDEX"; index: number }
  | { type: "SET_PLAYING"; playing: boolean }
  | { type: "SET_VOLUME"; volume: number }
  | {
      type: "SET_PROGRESS";
      progress: number;
      currentTime: number;
      duration: number;
    }
  | { type: "TOGGLE_SHUFFLE" }
  | { type: "CYCLE_REPEAT" }
  | { type: "SET_LOADING"; loading: boolean }
  | { type: "SET_RESTORING"; restoring: boolean }
  | { type: "SET_TRACK_ERROR"; id: string }
  | { type: "CLEAR_TRACK_ERROR"; id: string }
  | { type: "SET_TRACK_LOADING"; id: string | null };

interface PlayerContextValue {
  state: PlayerState;
  audioRef: React.RefObject<HTMLAudioElement>;
  dispatch: React.Dispatch<Action>;
  play: (index?: number) => void;
  pause: () => void;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  seek: (fraction: number) => void;
  addFiles: (
    files: FileList | File[],
    handles?: FileSystemFileHandle[],
  ) => Promise<void>;
  removeFromQueue: (id: string) => void;
  reorderQueue: (newQueue: TrackMeta[]) => void;
  clearAll: () => void;
}

// ─── Reducer ─────────────────────────────────────────────────────────────────

const initial: PlayerState = {
  queue: [],
  currentIndex: 0,
  isPlaying: false,
  volume: 0.8,
  progress: 0,
  currentTime: 0,
  duration: 0,
  shuffle: false,
  repeat: "none",
  loading: false,
  restoring: false,
  trackErrors: new Set<string>(),
  trackLoadingId: null,
};

function reducer(state: PlayerState, action: Action): PlayerState {
  switch (action.type) {
    case "SET_QUEUE":
      return { ...state, queue: action.queue };
    case "PREPEND_TRACKS":
      return {
        ...state,
        queue: [...action.tracks, ...state.queue],
        currentIndex: 0,
      };
    case "APPEND_TRACKS":
      // Append at end, keep currentIndex pointing at same track
      return { ...state, queue: [...state.queue, ...action.tracks] };
    case "REORDER_QUEUE": {
      // After drag-reorder: find the currently playing track in the new order
      const currentTrackId = state.queue[state.currentIndex]?.id;
      const newIndex = currentTrackId
        ? action.queue.findIndex((t) => t.id === currentTrackId)
        : state.currentIndex;
      return {
        ...state,
        queue: action.queue,
        currentIndex: Math.max(0, newIndex),
      };
    }
    case "UPDATE_TRACK":
      return {
        ...state,
        queue: state.queue.map((t) =>
          t.id === action.track.id ? action.track : t,
        ),
      };
    case "REMOVE_TRACK": {
      const idx = state.queue.findIndex((t) => t.id === action.id);
      const newQueue = state.queue.filter((t) => t.id !== action.id);
      let newIndex = state.currentIndex;
      if (idx < state.currentIndex) newIndex--;
      if (idx === state.currentIndex)
        newIndex = Math.min(newIndex, newQueue.length - 1);
      const errs = new Set(state.trackErrors);
      errs.delete(action.id);
      return {
        ...state,
        queue: newQueue,
        currentIndex: Math.max(0, newIndex),
        trackErrors: errs,
      };
    }
    case "CLEAR_QUEUE":
      return {
        ...state,
        queue: [],
        currentIndex: 0,
        isPlaying: false,
        restoring: false,
        trackErrors: new Set(),
        trackLoadingId: null,
      };
    case "SET_INDEX":
      return { ...state, currentIndex: action.index };
    case "SET_PLAYING":
      return { ...state, isPlaying: action.playing };
    case "SET_VOLUME":
      return { ...state, volume: action.volume };
    case "SET_PROGRESS":
      return {
        ...state,
        progress: action.progress,
        currentTime: action.currentTime,
        duration: action.duration,
      };
    case "TOGGLE_SHUFFLE":
      return { ...state, shuffle: !state.shuffle };
    case "CYCLE_REPEAT": {
      const order: PlayerState["repeat"][] = ["none", "all", "one"];
      return {
        ...state,
        repeat: order[(order.indexOf(state.repeat) + 1) % order.length],
      };
    }
    case "SET_LOADING":
      return { ...state, loading: action.loading };
    case "SET_RESTORING":
      return { ...state, restoring: action.restoring };
    case "SET_TRACK_LOADING":
      return { ...state, trackLoadingId: action.id };
    case "SET_TRACK_ERROR": {
      const errs = new Set(state.trackErrors);
      errs.add(action.id);
      return { ...state, trackErrors: errs, trackLoadingId: null };
    }
    case "CLEAR_TRACK_ERROR": {
      const errs = new Set(state.trackErrors);
      errs.delete(action.id);
      return { ...state, trackErrors: errs };
    }
    default:
      return state;
  }
}

// ─── Context ──────────────────────────────────────────────────────────────────

const PlayerContext = createContext<PlayerContextValue | null>(null);

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initial);
  const audioRef = useRef<HTMLAudioElement>(null!);
  const objectUrlsRef = useRef<Map<string, string>>(new Map());
  const loadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadingTrackIdRef = useRef<string | null>(null);

  // ── Load watchdog: show skeleton → fail after 5s if no progress ────────────
  const beginLoadWatch = useCallback((trackId: string) => {
    if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
    loadingTrackIdRef.current = trackId;
    dispatch({ type: "SET_TRACK_LOADING", id: trackId });
    loadTimeoutRef.current = setTimeout(() => {
      if (loadingTrackIdRef.current === trackId) {
        dispatch({ type: "SET_TRACK_ERROR", id: trackId });
        loadingTrackIdRef.current = null;
      }
    }, 9000);
  }, []);

  const clearLoadWatch = useCallback((trackId: string) => {
    if (loadingTrackIdRef.current !== trackId) return;
    if (loadTimeoutRef.current) {
      clearTimeout(loadTimeoutRef.current);
      loadTimeoutRef.current = null;
    }
    loadingTrackIdRef.current = null;
    dispatch({ type: "SET_TRACK_LOADING", id: null });
  }, []);

  useEffect(
    () => () => {
      if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
    },
    [],
  );

  // ── Helper: (re)create a blob URL from a FileSystemFileHandle ──────────────
  const resolveHandleUrl = useCallback(
    async (track: TrackMeta): Promise<string | null> => {
      if (!track.fileHandle) return null;
      try {
        // Always re-request permission — handles expire across suspend/resume on Android
        const perm = await (track.fileHandle as any).queryPermission({
          mode: "read",
        });
        if (perm !== "granted") {
          const req = await (track.fileHandle as any).requestPermission({
            mode: "read",
          });
          if (req !== "granted") return null;
        }
        const file = await track.fileHandle.getFile();
        const url = URL.createObjectURL(file);
        // Revoke the old URL if one existed to avoid memory leaks
        const old = objectUrlsRef.current.get(track.id);
        if (old) URL.revokeObjectURL(old);
        objectUrlsRef.current.set(track.id, url);
        return url;
      } catch {
        return null;
      }
    },
    [],
  );

  // ── MOUNT: restore persisted queue from IDB ─────────────────────────────────
  // P1 fix: we now KEEP the IDB queue (not clearing it) and restore on every mount.
  // Blob URLs are rebuilt from fileHandles. Tracks without handles get no URL
  // and will show the 5s error state if the user tries to play them.
  useEffect(() => {
    (async () => {
      try {
        const stored = await getAllTracks();
        if (!stored.length) return;

        dispatch({ type: "SET_RESTORING", restoring: true });

        // Step 1: populate queue immediately with metadata + cover art (no audio yet)
        const withCovers = stored.map((t) => ({
          ...t,
          coverUrl: t.coverData ? rebuildCoverUrl(t) : undefined,
        }));
        dispatch({ type: "SET_QUEUE", queue: withCovers });

        // Step 2: rebuild audio blob URLs for every track that has a fileHandle
        let firstResolved = false;
        for (const track of withCovers) {
          const url = await resolveHandleUrl(track);
          if (url && !firstResolved) {
            firstResolved = true;
            const audio = audioRef.current;
            if (audio) {
              audio.src = url;
              audio.volume = state.volume;
            }
          }
        }

        dispatch({ type: "SET_RESTORING", restoring: false });
      } catch {
        dispatch({ type: "SET_RESTORING", restoring: false });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── P1 fix: visibilitychange — rebuild blob URLs when app comes back from background ──
  // When the browser suspends the page (home button on mobile), blob URLs become invalid.
  // On resume, silently re-create them from fileHandles before the user tries to play.
  useEffect(() => {
    const onVisible = async () => {
      if (document.visibilityState !== "visible") return;

      const audio = audioRef.current;
      const tracks = state.queue;
      if (!tracks.length) return;

      // Rebuild URLs for all tracks in the background
      for (const track of tracks) {
        if (!track.fileHandle) continue;
        await resolveHandleUrl(track); // silently re-creates the URL
      }

      // Re-attach the current track's URL to the audio element if it was dropped
      const current = tracks[state.currentIndex];
      if (current && audio) {
        const url = objectUrlsRef.current.get(current.id);
        if (url && audio.src !== url) {
          const wasPlaying = state.isPlaying;
          const savedTime = audio.currentTime;
          audio.src = url;
          audio.currentTime = savedTime;
          if (wasPlaying) audio.play().catch(() => {});
        }
      }
    };

    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.queue, state.currentIndex, state.isPlaying, resolveHandleUrl]);

  // ── Volume sync ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = state.volume;
  }, [state.volume]);

  // ── Play / pause sync ──────────────────────────────────────────────────────
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (state.isPlaying)
      audio
        .play()
        .catch(() => dispatch({ type: "SET_PLAYING", playing: false }));
    else audio.pause();
  }, [state.isPlaying]);

  // ── Load audio src when current track changes ──────────────────────────────
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !state.queue.length) return;
    const track = state.queue[state.currentIndex];
    if (!track) return;

    const url = objectUrlsRef.current.get(track.id);
    if (url) {
      if (audio.src !== url) {
        audio.src = url;
        beginLoadWatch(track.id);
        if (state.isPlaying) audio.play().catch(console.warn);
      }
    } else if (track.fileHandle) {
      // URL missing but handle exists — rebuild it (can happen after background suspend)
      resolveHandleUrl(track).then((newUrl) => {
        if (!newUrl) {
          setTimeout(
            () => dispatch({ type: "SET_TRACK_ERROR", id: track.id }),
            300,
          );
          return;
        }
        audio.src = newUrl;
        beginLoadWatch(track.id);
        if (state.isPlaying) audio.play().catch(console.warn);
      });
    } else {
      // No URL, no handle — unplayable
      setTimeout(
        () => dispatch({ type: "SET_TRACK_ERROR", id: track.id }),
        300,
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.currentIndex, state.queue.length]);

  // ── Audio event listeners ──────────────────────────────────────────────────
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => {
      const dur = audio.duration || 0;
      const cur = audio.currentTime;
      dispatch({
        type: "SET_PROGRESS",
        progress: dur ? cur / dur : 0,
        currentTime: cur,
        duration: dur,
      });
      // Progress moving = track loaded successfully → clear skeleton
      if (cur > 0.05) {
        const track = state.queue[state.currentIndex];
        if (track) clearLoadWatch(track.id);
      }
    };

    const onEnded = () => {
      const { queue, currentIndex, repeat, shuffle } = state;
      if (repeat === "one") {
        audio.currentTime = 0;
        audio.play();
        return;
      }
      if (shuffle) {
        dispatch({
          type: "SET_INDEX",
          index: Math.floor(Math.random() * queue.length),
        });
        return;
      }
      const next = currentIndex + 1;
      if (next < queue.length) dispatch({ type: "SET_INDEX", index: next });
      else if (repeat === "all") dispatch({ type: "SET_INDEX", index: 0 });
      else dispatch({ type: "SET_PLAYING", playing: false });
    };

    const onLoadedMeta = () => {
      dispatch({
        type: "SET_PROGRESS",
        progress: 0,
        currentTime: 0,
        duration: audio.duration || 0,
      });
    };

    // P1 fix: do NOT dispatch SET_TRACK_ERROR on audio 'error' alone.
    // Blob URLs can temporarily return errors during background→foreground transitions.
    // The 5s watchdog in beginLoadWatch is the only trigger for marking a track failed.
    // We only log here for debugging.
    const onAudioError = () => {
      console.warn(
        "[LUMEN] Audio error event — watchdog will handle if still loading",
      );
    };

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("loadedmetadata", onLoadedMeta);
    audio.addEventListener("error", onAudioError);
    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("loadedmetadata", onLoadedMeta);
      audio.removeEventListener("error", onAudioError);
    };
  });

  // ── MediaSession API ───────────────────────────────────────────────────────
  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator))
      return;
    const track = state.queue[state.currentIndex];
    if (!track) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: track.album,
      artwork: track.coverUrl
        ? [{ src: track.coverUrl, sizes: "512x512" }]
        : [],
    });
    navigator.mediaSession.setActionHandler("play", toggle);
    navigator.mediaSession.setActionHandler("pause", toggle);
    navigator.mediaSession.setActionHandler("nexttrack", next);
    navigator.mediaSession.setActionHandler("previoustrack", prev);
    navigator.mediaSession.setActionHandler("stop", () =>
      dispatch({ type: "SET_PLAYING", playing: false }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.currentIndex, state.queue]);

  // ─── Helpers ──────────────────────────────────────────────────────────────

  const play = useCallback((index?: number) => {
    if (index !== undefined) dispatch({ type: "SET_INDEX", index });
    dispatch({ type: "SET_PLAYING", playing: true });
  }, []);

  const pause = useCallback(
    () => dispatch({ type: "SET_PLAYING", playing: false }),
    [],
  );
  const toggle = useCallback(
    () => dispatch({ type: "SET_PLAYING", playing: !state.isPlaying }),
    [state.isPlaying],
  );

  const next = useCallback(() => {
    const { queue, currentIndex, shuffle } = state;
    if (!queue.length) return;
    const idx = shuffle
      ? Math.floor(Math.random() * queue.length)
      : (currentIndex + 1) % queue.length;
    dispatch({ type: "SET_INDEX", index: idx });
    dispatch({ type: "SET_PLAYING", playing: true });
  }, [state]);

  const prev = useCallback(() => {
    const { queue, currentIndex } = state;
    if (!queue.length) return;
    const audio = audioRef.current;
    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }
    dispatch({
      type: "SET_INDEX",
      index: (currentIndex - 1 + queue.length) % queue.length,
    });
    dispatch({ type: "SET_PLAYING", playing: true });
  }, [state]);

  const seek = useCallback((fraction: number) => {
    const audio = audioRef.current;
    if (audio?.duration) audio.currentTime = fraction * audio.duration;
  }, []);

  const addFiles = useCallback(
    async (files: FileList | File[], handles?: FileSystemFileHandle[]) => {
      const { parseFileMeta, isAudioFile } = await import("./metaParser");
      const arr = Array.from(files).filter(isAudioFile);
      if (!arr.length) return;

      dispatch({ type: "SET_LOADING", loading: true });

      const isFirstBatch = state.queue.length === 0;
      let firstTrackId: string | null = null;

      // Stream tracks to the queue one-by-one as each is parsed
      // This makes the loading spinner meaningful — user sees tracks appear immediately
      for (let i = 0; i < arr.length; i++) {
        const file = arr[i];
        const handle = handles?.[i];
        const meta = await parseFileMeta(file, handle);
        const audioUrl = URL.createObjectURL(file);
        objectUrlsRef.current.set(meta.id, audioUrl);
        dispatch({ type: "CLEAR_TRACK_ERROR", id: meta.id });

        // APPEND to end — drag-drop adds to end of queue, not front
        dispatch({ type: "APPEND_TRACKS", tracks: [meta] });
        saveTrack(meta).catch(() => {});

        // Track the first file added so we can auto-play it
        if (i === 0) firstTrackId = meta.id;
      }

      dispatch({ type: "SET_LOADING", loading: false });

      // Auto-play only if nothing was playing before
      if (isFirstBatch && firstTrackId) {
        const audio = audioRef.current;
        const url = objectUrlsRef.current.get(firstTrackId);
        if (audio && url) {
          audio.src = url;
          beginLoadWatch(firstTrackId);
          audio.play().catch(() => {});
          dispatch({ type: "SET_PLAYING", playing: true });
        }
      }
    },
    [beginLoadWatch, state.queue.length],
  );

  const reorderQueue = useCallback((newQueue: TrackMeta[]) => {
    dispatch({ type: "REORDER_QUEUE", queue: newQueue });
    // Persist updated order to IDB (clear and re-save in new order)
    clearQueue()
      .then(() => {
        newQueue.forEach((t, i) =>
          saveTrack({ ...t, addedAt: Date.now() - i }).catch(() => {}),
        );
      })
      .catch(() => {});
  }, []);

  const removeFromQueue = useCallback((id: string) => {
    const url = objectUrlsRef.current.get(id);
    if (url) {
      URL.revokeObjectURL(url);
      objectUrlsRef.current.delete(id);
    }
    dispatch({ type: "REMOVE_TRACK", id });
    removeTrack(id).catch(() => {});
  }, []);

  const clearAll = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.src = "";
    }
    if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrlsRef.current.clear();
    dispatch({ type: "CLEAR_QUEUE" });
    clearQueue().catch(() => {});
  }, []);

  return (
    <PlayerContext.Provider
      value={{
        state,
        audioRef,
        dispatch,
        play,
        pause,
        toggle,
        next,
        prev,
        seek,
        addFiles,
        removeFromQueue,
        reorderQueue,
        clearAll,
      }}
    >
      {/* suppressHydrationWarning: audio element doesn't exist in SSR, only in browser */}
      <audio ref={audioRef} preload="auto" suppressHydrationWarning />
      {children}
    </PlayerContext.Provider>
  );
}

export function usePlayer() {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer must be used inside PlayerProvider");
  return ctx;
}
