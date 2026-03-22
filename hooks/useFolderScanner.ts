'use client';
// hooks/useFolderScanner.ts — File System Access API folder scanner
// Updated: collects FileSystemFileHandle objects alongside File objects so that
// the playerStore can persist them for post-reload recovery.

import { useState, useCallback } from 'react';
import { usePlayer } from '@/lib/playerStore';
import { isAudioFile } from '@/lib/metaParser';

export interface ScanResult {
  folderName: string;
  fileCount:  number;
  files:      File[];
  handles:    FileSystemFileHandle[];  // ← parallel array, same length as files
}

export function useFolderScanner() {
  const { addFiles } = usePlayer();
  const [scanning,     setScanning]     = useState(false);
  const [scanResults,  setScanResults]  = useState<ScanResult[]>([]);
  const [error,        setError]        = useState<string | null>(null);

  const hasSupport = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

  const scanFolder = useCallback(async () => {
    if (!hasSupport) {
      setError('Folder scanning requires Chrome or Edge. Please use the file picker instead.');
      return;
    }
    setError(null);
    setScanning(true);
    setScanResults([]);

    try {
      // @ts-ignore — showDirectoryPicker not in all TS libs yet
      const dirHandle: FileSystemDirectoryHandle = await window.showDirectoryPicker({ mode: 'read' });

      const results:      ScanResult[] = [];
      const rootFiles:    File[]                    = [];
      const rootHandles:  FileSystemFileHandle[]    = [];

      for await (const [name, handle] of (dirHandle as any).entries()) {
        if (handle.kind === 'file') {
          const file = await (handle as FileSystemFileHandle).getFile();
          if (isAudioFile(file)) { rootFiles.push(file); rootHandles.push(handle as FileSystemFileHandle); }
        } else if (handle.kind === 'directory') {
          const subFiles:   File[]                 = [];
          const subHandles: FileSystemFileHandle[] = [];
          for await (const [, sub] of (handle as any).entries()) {
            if (sub.kind === 'file') {
              const file = await (sub as FileSystemFileHandle).getFile();
              if (isAudioFile(file)) { subFiles.push(file); subHandles.push(sub as FileSystemFileHandle); }
            }
          }
          if (subFiles.length) {
            results.push({ folderName: name, fileCount: subFiles.length, files: subFiles, handles: subHandles });
          }
        }
      }

      if (rootFiles.length) {
        results.unshift({ folderName: dirHandle.name, fileCount: rootFiles.length, files: rootFiles, handles: rootHandles });
      }

      setScanResults(results);
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'AbortError') setError(err.message || 'Scan failed.');
    } finally {
      setScanning(false);
    }
  }, [hasSupport]);

  const playFolder = useCallback(async (result: ScanResult) => {
    await addFiles(result.files, result.handles);
    setScanResults([]);
  }, [addFiles]);

  // Fallback: native <input> file picker (no handles, no reload recovery)
  const openFilePicker = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = 'audio/*,.mp3,.flac,.ogg,.wav,.aac,.m4a,.opus,.wma,.aiff';
    input.onchange = (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (files?.length) addFiles(files); // no handles — tracks won't survive reload
    };
    input.click();
  }, [addFiles]);

  return { scanFolder, playFolder, openFilePicker, scanning, scanResults, setScanResults, hasSupport, error };
}
