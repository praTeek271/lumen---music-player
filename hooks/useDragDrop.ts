'use client';
// hooks/useDragDrop.ts — Drag & drop with FileSystemFileHandle capture
// When the browser provides DataTransferItem.webkitGetAsEntry() AND the File System
// Access API is available, we attempt to get handles so reload recovery works.
// Falls back gracefully to plain File objects on unsupported browsers.

import { useEffect, useRef, useState } from 'react';
import { usePlayer } from '@/lib/playerStore';
import { isAudioFile } from '@/lib/metaParser';

export function useDragDrop() {
  const { addFiles } = usePlayer();
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);

  useEffect(() => {
    const onDragEnter = (e: DragEvent) => {
      e.preventDefault();
      dragCounter.current++;
      if (e.dataTransfer?.types.includes('Files')) setIsDragging(true);
    };

    const onDragLeave = (e: DragEvent) => {
      e.preventDefault();
      if (--dragCounter.current === 0) setIsDragging(false);
    };

    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };

    const onDrop = async (e: DragEvent) => {
      e.preventDefault();
      dragCounter.current = 0;
      setIsDragging(false);

      const files:   File[]                    = [];
      const handles: (FileSystemFileHandle | undefined)[] = [];

      if (e.dataTransfer?.items) {
        const promises: Promise<void>[] = [];

        for (const item of Array.from(e.dataTransfer.items)) {
          if (item.kind !== 'file') continue;

          // Try File System Access API handle first (Chromium only)
          if (typeof (item as any).getAsFileSystemHandle === 'function') {
            promises.push(
              (async () => {
                try {
                  const h = await (item as any).getAsFileSystemHandle();
                  if (h?.kind === 'file') {
                    const file = await (h as FileSystemFileHandle).getFile();
                    if (isAudioFile(file)) { files.push(file); handles.push(h as FileSystemFileHandle); }
                  } else if (h?.kind === 'directory') {
                    await collectDir(h as FileSystemDirectoryHandle, files, handles);
                  }
                } catch {
                  // Fallback to legacy entry API
                  const entry = item.webkitGetAsEntry?.();
                  if (entry) await collectEntry(entry, files, handles);
                }
              })()
            );
          } else {
            // Legacy webkitGetAsEntry path
            const entry = item.webkitGetAsEntry?.();
            if (entry) {
              promises.push(collectEntry(entry, files, handles));
            } else {
              const file = item.getAsFile();
              if (file && isAudioFile(file)) { files.push(file); handles.push(undefined); }
            }
          }
        }

        await Promise.all(promises);
      } else if (e.dataTransfer?.files) {
        for (const file of Array.from(e.dataTransfer.files)) {
          if (isAudioFile(file)) { files.push(file); handles.push(undefined); }
        }
      }

      if (files.length) {
        // Pass parallel handles array — undefined entries are ignored in playerStore
        const definedHandles = handles.some(Boolean)
          ? (handles as FileSystemFileHandle[])
          : undefined;
        await addFiles(files, definedHandles);
      }
    };

    document.addEventListener('dragenter', onDragEnter);
    document.addEventListener('dragleave', onDragLeave);
    document.addEventListener('dragover',  onDragOver);
    document.addEventListener('drop',      onDrop);
    return () => {
      document.removeEventListener('dragenter', onDragEnter);
      document.removeEventListener('dragleave', onDragLeave);
      document.removeEventListener('dragover',  onDragOver);
      document.removeEventListener('drop',      onDrop);
    };
  }, [addFiles]);

  return { isDragging };
}

// ── File System Access API directory traversal ────────────────────────────────
async function collectDir(
  dir:     FileSystemDirectoryHandle,
  files:   File[],
  handles: (FileSystemFileHandle | undefined)[],
  depth = 0
): Promise<void> {
  if (depth > 5) return;
  for await (const [, entry] of (dir as any).entries()) {
    if (entry.kind === 'file') {
      try {
        const file = await (entry as FileSystemFileHandle).getFile();
        if (isAudioFile(file)) { files.push(file); handles.push(entry as FileSystemFileHandle); }
      } catch { /* skip */ }
    } else if (entry.kind === 'directory') {
      await collectDir(entry as FileSystemDirectoryHandle, files, handles, depth + 1);
    }
  }
}

// ── Legacy FileSystemEntry traversal (fallback) ───────────────────────────────
async function collectEntry(
  entry:   FileSystemEntry,
  files:   File[],
  handles: (FileSystemFileHandle | undefined)[],
  depth = 0
): Promise<void> {
  if (depth > 5) return;
  if (entry.isFile) {
    await new Promise<void>(res => {
      (entry as FileSystemFileEntry).file(f => {
        if (isAudioFile(f)) { files.push(f); handles.push(undefined); }
        res();
      });
    });
  } else if (entry.isDirectory) {
    await new Promise<void>(res => {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      const readBatch = () => {
        reader.readEntries(async entries => {
          if (!entries.length) { res(); return; }
          await Promise.all(entries.map(e => collectEntry(e, files, handles, depth + 1)));
          readBatch();
        });
      };
      readBatch();
    });
  }
}
