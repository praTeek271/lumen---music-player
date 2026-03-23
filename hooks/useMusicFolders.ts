"use client";
// hooks/useMusicFolders.ts
//
// Manages persistent music folder access across sessions.
//
// Flow:
//  1. On mount: load all saved FileSystemDirectoryHandle objects from IDB
//  2. For each handle: re-request permission (Chrome prompts once with a
//     top-of-page banner; subsequent visits within the session are auto-granted)
//  3. Scan newly-accessible folders for audio files and add to queue
//  4. New folders granted by user are saved to IDB for future sessions
//
// Platform reality:
//  • Chrome/Edge desktop: full support — handles persist across restarts,
//    browser shows a one-time permission banner on reopen
//  • Chrome Android: partial — handles persist but permission re-prompt
//    may appear each session (OS limitation, not a bug)
//  • Safari / Firefox: showDirectoryPicker not supported — falls back to
//    plain file picker (no persistence)

import { useState, useCallback, useEffect } from "react";
import {
  getAllMusicFolders,
  saveMusicFolder,
  removeMusicFolder,
  SavedFolder,
} from "@/lib/db";
import { isAudioFile } from "@/lib/metaParser";
import { usePlayer } from "@/lib/playerStore";

export interface FolderEntry {
  id: string;
  name: string;
  trackCount: number;
  accessible: boolean; // false = permission denied after reload
}

export interface PlaylistEntry {
  name: string; // M3U filename without extension
  files: File[];
  handles: FileSystemFileHandle[];
}

// ── Parse an M3U/M3U8 text and return ordered basenames ─────────────────────
function parseM3UText(text: string): string[] {
  const basenames: string[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    // Normalize Windows/Unix separators and extract basename
    const bn =
      trimmed.replace(/\\/g, "/").split("/").pop()?.toLowerCase() ?? "";
    if (bn && !seen.has(bn)) {
      seen.add(bn);
      basenames.push(bn);
    }
  }
  return basenames;
}

export function useMusicFolders() {
  const { addFiles } = usePlayer();

  const [folders, setFolders] = useState<FolderEntry[]>([]);
  const [syncing, setSyncing] = useState(false); // re-scanning saved folders
  const [hasSupport, setHasSupport] = useState(false);

  useEffect(() => {
    setHasSupport(
      typeof window !== "undefined" && "showDirectoryPicker" in window,
    );
  }, []);

  // ── Collect audio files + M3U playlists from a directory handle ───────────
  // Scans the root and one level of subdirectories (covers common layouts:
  //   Music/song.mp3, Music/Artist/song.mp3, Music/Playlists/list.m3u)
  async function collectAudioFiles(
    handle: FileSystemDirectoryHandle,
  ): Promise<{
    files: File[];
    handles: FileSystemFileHandle[];
    playlists: PlaylistEntry[];
  }> {
    // Map keyed by lowercased filename for O(1) M3U resolution
    const audioMap = new Map<
      string,
      { file: File; fh: FileSystemFileHandle }
    >();
    const m3uList: { file: File; name: string }[] = [];

    const tryFile = async (entry: FileSystemFileHandle) => {
      try {
        const file = await entry.getFile();
        const lc = file.name.toLowerCase();
        if (isAudioFile(file)) {
          audioMap.set(lc, { file, fh: entry });
        } else if (lc.endsWith(".m3u") || lc.endsWith(".m3u8")) {
          const nameNoExt = file.name.replace(/\.m3u8?$/i, "");
          m3uList.push({ file, name: nameNoExt });
        }
      } catch {
        /* unreadable — skip */
      }
    };

    try {
      for await (const entry of (handle as any).values()) {
        if (entry.kind === "file") {
          await tryFile(entry as FileSystemFileHandle);
        } else if (entry.kind === "directory") {
          // One level of subdirectory (covers Artist/ and Playlist/ folders)
          try {
            for await (const sub of (
              entry as FileSystemDirectoryHandle as any
            ).values()) {
              if (sub.kind === "file") {
                await tryFile(sub as FileSystemFileHandle);
              }
            }
          } catch {
            /* skip unreadable subdir */
          }
        }
      }
    } catch {
      /* permission denied */
    }

    // ── Resolve each M3U into an ordered file list ──────────────────────────
    const playlists: PlaylistEntry[] = [];
    const claimedByPlaylist = new Set<string>(); // basenames already in a playlist

    for (const { file, name } of m3uList) {
      try {
        const text = await file.text();
        const basenames = parseM3UText(text);
        const pFiles: File[] = [];
        const pHandles: FileSystemFileHandle[] = [];
        for (const bn of basenames) {
          const entry = audioMap.get(bn);
          if (entry) {
            pFiles.push(entry.file);
            pHandles.push(entry.fh);
            claimedByPlaylist.add(bn);
          }
        }
        if (pFiles.length > 0) {
          playlists.push({ name, files: pFiles, handles: pHandles });
        }
      } catch {
        /* skip unparseable M3U */
      }
    }

    // ── Remaining audio files not referenced by any M3U ─────────────────────
    const files: File[] = [];
    const handles: FileSystemFileHandle[] = [];
    for (const [lc, { file, fh }] of audioMap) {
      if (!claimedByPlaylist.has(lc)) {
        files.push(file);
        handles.push(fh);
      }
    }

    return { files, handles, playlists };
  }

  // ── Re-verify permission for a stored handle ────────────────────────────
  async function verifyPermission(
    handle: FileSystemDirectoryHandle,
  ): Promise<boolean> {
    try {
      const status = await (handle as any).queryPermission({ mode: "read" });
      if (status === "granted") return true;
      const req = await (handle as any).requestPermission({ mode: "read" });
      return req === "granted";
    } catch {
      return false;
    }
  }

  // ── On mount: silently re-scan all saved folders ─────────────────────────
  const syncSavedFolders = useCallback(
    async (addToQueue = false) => {
      if (!hasSupport) return;
      setSyncing(true);

      try {
        const saved = await getAllMusicFolders();
        const entries: FolderEntry[] = [];

        for (const folder of saved) {
          const accessible = await verifyPermission(folder.handle);

          // collectAudioFiles also gives us the track count — avoids a second scan
          let trackCount = 0;
          if (accessible) {
            const { files, handles, playlists } = await collectAudioFiles(
              folder.handle,
            );
            const playlistCount = playlists.reduce(
              (s, p) => s + p.files.length,
              0,
            );
            trackCount = files.length + playlistCount;

            if (addToQueue) {
              // Enqueue playlist tracks in M3U order first, then loose files
              for (const pl of playlists) {
                if (pl.files.length) await addFiles(pl.files, pl.handles);
              }
              if (files.length) await addFiles(files, handles);
            }
          }

          entries.push({
            id: folder.id,
            name: folder.name,
            trackCount,
            accessible,
          });
        }

        setFolders(entries);
      } finally {
        setSyncing(false);
      }
    },
    [hasSupport, addFiles],
  );

  // Load folder list on mount (don't auto-add to queue — user controls that)
  useEffect(() => {
    if (hasSupport) syncSavedFolders(false);
  }, [hasSupport, syncSavedFolders]);

  // ── Grant access to a new folder ─────────────────────────────────────────
  const grantFolder = useCallback(async (): Promise<void> => {
    if (!hasSupport) return;

    try {
      const handle: FileSystemDirectoryHandle = await (
        window as any
      ).showDirectoryPicker({ mode: "read" });

      // Request permission explicitly before saving
      const ok = await verifyPermission(handle);
      if (!ok) return;

      // Save the handle to IDB for future sessions
      const id = await saveMusicFolder(handle);

      // Scan and add to queue immediately
      const { files, handles, playlists } = await collectAudioFiles(handle);

      // Enqueue playlist tracks in M3U order first, then loose files
      for (const pl of playlists) {
        if (pl.files.length) await addFiles(pl.files, pl.handles);
      }
      if (files.length) await addFiles(files, handles);

      const totalCount =
        files.length + playlists.reduce((s, p) => s + p.files.length, 0);

      // Count and update folder list
      setFolders((prev) => [
        ...prev,
        { id, name: handle.name, trackCount: totalCount, accessible: true },
      ]);
    } catch (err: any) {
      if (err?.name !== "AbortError")
        console.warn("[LUMEN] grantFolder error:", err);
    }
  }, [hasSupport, addFiles]);

  // ── Play a specific saved folder ─────────────────────────────────────────
  const playFolder = useCallback(
    async (folderId: string) => {
      const saved = await getAllMusicFolders();
      const rec = saved.find((f) => f.id === folderId);
      if (!rec) return;
      const ok = await verifyPermission(rec.handle);
      if (!ok) return;
      const { files, handles, playlists } = await collectAudioFiles(rec.handle);
      for (const pl of playlists) {
        if (pl.files.length) await addFiles(pl.files, pl.handles);
      }
      if (files.length) await addFiles(files, handles);
    },
    [addFiles],
  );

  // ── Remove a saved folder ────────────────────────────────────────────────
  const forgetFolder = useCallback(async (id: string) => {
    await removeMusicFolder(id);
    setFolders((prev) => prev.filter((f) => f.id !== id));
  }, []);

  return {
    folders,
    syncing,
    hasSupport,
    grantFolder,
    playFolder,
    forgetFolder,
    syncSavedFolders,
  };
}
