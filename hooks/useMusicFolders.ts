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

  // ── Collect audio files from a directory handle (one level deep) ────────
  async function collectAudioFiles(
    handle: FileSystemDirectoryHandle,
  ): Promise<{ files: File[]; handles: FileSystemFileHandle[] }> {
    const files: File[] = [];
    const handles: FileSystemFileHandle[] = [];

    try {
      for await (const entry of (handle as any).values()) {
        if (entry.kind === "file") {
          try {
            const file = await (entry as FileSystemFileHandle).getFile();
            if (isAudioFile(file)) {
              files.push(file);
              handles.push(entry);
            }
          } catch {
            /* unreadable — skip */
          }
        } else if (entry.kind === "directory") {
          // One level of subdirectory
          try {
            for await (const sub of (
              entry as FileSystemDirectoryHandle as any
            ).values()) {
              if (sub.kind === "file") {
                try {
                  const file = await (sub as FileSystemFileHandle).getFile();
                  if (isAudioFile(file)) {
                    files.push(file);
                    handles.push(sub);
                  }
                } catch {
                  /* skip */
                }
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

    return { files, handles };
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

          if (accessible && addToQueue) {
            const { files, handles } = await collectAudioFiles(folder.handle);
            if (files.length) await addFiles(files, handles);
          }

          // Count files for display (even if not adding to queue)
          let trackCount = 0;
          if (accessible) {
            try {
              for await (const e of (folder.handle as any).values()) {
                if (e.kind === "file") {
                  try {
                    const f = await e.getFile();
                    if (isAudioFile(f)) trackCount++;
                  } catch {
                    /* skip */
                  }
                }
              }
            } catch {
              /* skip */
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
      const { files, fileHandles: fh } = await (async () => {
        const { files, handles } = await collectAudioFiles(handle);
        return { files, fileHandles: handles };
      })();

      if (files.length) await addFiles(files, fh);

      // Count and update folder list
      setFolders((prev) => [
        ...prev,
        { id, name: handle.name, trackCount: files.length, accessible: true },
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
      const { files, handles } = await collectAudioFiles(rec.handle);
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
