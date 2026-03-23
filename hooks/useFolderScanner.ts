"use client";
// hooks/useFolderScanner.ts
//
// P2 fix: Android Chrome revokes directory permissions mid-iteration.
// Fix: (a) request permission on the dirHandle BEFORE iterating,
//      (b) wrap every individual file.getFile() in its own try/catch so
//          one failed file doesn't abort the whole scan,
//      (c) use a manual iteration queue instead of for-await which can
//          lose the activation lock on slow Android devices.

import { useState, useCallback } from "react";
import { usePlayer } from "@/lib/playerStore";
import { isAudioFile } from "@/lib/metaParser";

export interface ScanResult {
  folderName: string;
  fileCount: number;
  files: File[];
  handles: FileSystemFileHandle[];
  isPlaylist?: boolean;
}

/** Parse an M3U/M3U8 text and return each entry's basename in order. */
function parseM3U(text: string): string[] {
  const basenames: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    // Strip any absolute/relative path — keep only the filename
    const basename = line.split(/[\\/]/).pop() ?? '';
    if (basename) basenames.push(basename);
  }
  return basenames;
}

export function useFolderScanner() {
  const { addFiles } = usePlayer();
  const [scanning, setScanning] = useState(false);
  const [scanResults, setScanResults] = useState<ScanResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  const hasSupport =
    typeof window !== "undefined" && "showDirectoryPicker" in window;

  const scanFolder = useCallback(async () => {
    if (!hasSupport) {
      setError(
        "Folder scanning requires Chrome or Edge. Use the file picker instead.",
      );
      return;
    }
    setError(null);
    setScanning(true);
    setScanResults([]);

    try {
      const dirHandle: FileSystemDirectoryHandle = await (
        window as any
      ).showDirectoryPicker({ mode: "read" });

      // P2 fix: explicitly request read permission on the root handle up-front,
      // before any async work that might lose the user-gesture activation.
      try {
        const perm = await (dirHandle as any).requestPermission({
          mode: "read",
        });
        if (perm !== "granted") {
          setError("Permission denied. Please allow access to the folder.");
          setScanning(false);
          return;
        }
      } catch {
        // Some browsers don't support requestPermission on directory handles —
        // proceed and let individual file accesses handle their own errors.
      }

      const results: ScanResult[] = [];
      const rootFiles: File[] = [];
      const rootHandles: FileSystemFileHandle[] = [];

      // Map of lowercase filename → {file, handle} — used to resolve M3U entries
      const allAudioFiles = new Map<string, { file: File; handle: FileSystemFileHandle }>();
      // All M3U/M3U8 handles found anywhere in the scanned tree
      const m3uHandles: Array<{ name: string; handle: FileSystemFileHandle }> = [];

      // Collect all top-level entries first into a plain array,
      // then process them — avoids async generator permission expiry
      const topLevel: [string, FileSystemHandle][] = [];
      for await (const entry of (dirHandle as any).values()) {
        topLevel.push([entry.name, entry]);
      }

      for (const [name, handle] of topLevel) {
        if ((handle as FileSystemHandle).kind === "file") {
          // P2 fix: individual try/catch per file
          try {
            const file = await (handle as FileSystemFileHandle).getFile();
            if (isAudioFile(file)) {
              rootFiles.push(file);
              rootHandles.push(handle as FileSystemFileHandle);
              allAudioFiles.set(file.name.toLowerCase(), { file, handle: handle as FileSystemFileHandle });
            } else if (/\.m3u8?$/i.test(file.name)) {
              m3uHandles.push({ name: file.name, handle: handle as FileSystemFileHandle });
            }
          } catch {
            /* unreadable file — skip */
          }
        } else if ((handle as FileSystemHandle).kind === "directory") {
          const subFiles: File[] = [];
          const subHandles: FileSystemFileHandle[] = [];

          try {
            const subEntries: [string, FileSystemHandle][] = [];
            for await (const sub of (handle as any).values()) {
              subEntries.push([sub.name, sub]);
            }
            for (const [, sub] of subEntries) {
              if ((sub as FileSystemHandle).kind === "file") {
                try {
                  const file = await (sub as FileSystemFileHandle).getFile();
                  if (isAudioFile(file)) {
                    subFiles.push(file);
                    subHandles.push(sub as FileSystemFileHandle);
                    allAudioFiles.set(file.name.toLowerCase(), { file, handle: sub as FileSystemFileHandle });
                  } else if (/\.m3u8?$/i.test(file.name)) {
                    // M3U inside a subfolder (e.g. "Playlists/my.m3u")
                    m3uHandles.push({ name: file.name, handle: sub as FileSystemFileHandle });
                  }
                } catch {
                  /* skip unreadable file */
                }
              } else if ((sub as FileSystemHandle).kind === "directory") {
                // One extra level — catches a dedicated "Playlists" subfolder
                try {
                  const deepEntries: [string, FileSystemHandle][] = [];
                  for await (const deep of (sub as any).values()) {
                    deepEntries.push([deep.name, deep]);
                  }
                  for (const [, deep] of deepEntries) {
                    if ((deep as FileSystemHandle).kind === "file") {
                      try {
                        const file = await (deep as FileSystemFileHandle).getFile();
                        if (/\.m3u8?$/i.test(file.name)) {
                          m3uHandles.push({ name: file.name, handle: deep as FileSystemFileHandle });
                        }
                        // Audio files two levels deep are NOT added as a folder result
                        // but ARE indexed so deeper-nested songs can still be resolved
                        // by an M3U that references them.
                        if (isAudioFile(file)) {
                          allAudioFiles.set(file.name.toLowerCase(), { file, handle: deep as FileSystemFileHandle });
                        }
                      } catch { /* skip */ }
                    }
                  }
                } catch { /* skip unreadable deep dir */ }
              }
            }
          } catch {
            /* skip unreadable subdirectory */
          }

          if (subFiles.length) {
            results.push({
              folderName: name,
              fileCount: subFiles.length,
              files: subFiles,
              handles: subHandles,
            });
          }
        }
      }

      if (rootFiles.length) {
        results.unshift({
          folderName: dirHandle.name,
          fileCount: rootFiles.length,
          files: rootFiles,
          handles: rootHandles,
        });
      }

      // Resolve every discovered M3U against the audio file index
      for (const { name: m3uName, handle: m3uHandle } of m3uHandles) {
        try {
          const m3uFile = await m3uHandle.getFile();
          const text = await m3uFile.text();
          const basenames = parseM3U(text);

          const playlistFiles: File[] = [];
          const playlistHandles: FileSystemFileHandle[] = [];
          for (const basename of basenames) {
            const match = allAudioFiles.get(basename.toLowerCase());
            if (match) {
              playlistFiles.push(match.file);
              playlistHandles.push(match.handle);
            }
          }

          if (playlistFiles.length > 0) {
            results.push({
              folderName: m3uName.replace(/\.m3u8?$/i, ''),
              fileCount: playlistFiles.length,
              files: playlistFiles,
              handles: playlistHandles,
              isPlaylist: true,
            });
          }
        } catch { /* skip unreadable M3U */ }
      }

      if (results.length === 0) {
        setError("No audio files found in this folder.");
      } else {
        setScanResults(results);
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== "AbortError") {
        setError(err.message || "Scan failed. Try the file picker instead.");
      }
    } finally {
      setScanning(false);
    }
  }, [hasSupport]);

  const playFolder = useCallback(
    async (result: ScanResult) => {
      await addFiles(result.files, result.handles);
      setScanResults([]);
    },
    [addFiles],
  );

  // Fallback file picker — works on all platforms including iOS Safari
  const openFilePicker = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = "audio/*,.mp3,.flac,.ogg,.wav,.aac,.m4a,.opus,.wma,.aiff";
    input.onchange = (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (files?.length) addFiles(files);
    };
    input.click();
  }, [addFiles]);

  return {
    scanFolder,
    playFolder,
    openFilePicker,
    scanning,
    scanResults,
    setScanResults,
    hasSupport,
    error,
  };
}
