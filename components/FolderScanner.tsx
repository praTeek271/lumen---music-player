'use client';
// components/FolderScanner.tsx - Folder scanning modal with results

import { Folder, FolderOpen, Music, Loader2, X, FolderSearch } from 'lucide-react';
import { useFolderScanner, ScanResult } from '@/hooks/useFolderScanner';

interface FolderScannerProps {
  open: boolean;
  onClose: () => void;
}

export function FolderScanner({ open, onClose }: FolderScannerProps) {
  const {
    scanFolder, playFolder, openFilePicker,
    scanning, scanResults, setScanResults, error,
  } = useFolderScanner();

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)' }}
        onClick={onClose}
      />

      {/* Modal */}
      <div
        className="fixed z-50 inset-x-4 top-1/2 -translate-y-1/2 rounded-3xl overflow-hidden"
        style={{
          maxWidth: 500,
          margin: '0 auto',
          background: 'rgba(14,10,30,0.95)',
          backdropFilter: 'blur(40px)',
          border: '1px solid rgba(167,139,250,0.2)',
          boxShadow: '0 32px 80px rgba(0,0,0,0.7)',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-purple-900/60 flex items-center justify-center">
              <FolderSearch size={16} className="text-purple-400" />
            </div>
            <div>
              <h2 className="text-white font-bold text-base" style={{ fontFamily: 'var(--font-display)' }}>
                Add Music
              </h2>
              <p className="text-white/40 text-xs">Scan a folder or pick files</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-white/8 transition-colors"
          >
            <X size={18} className="text-white/50" />
          </button>
        </div>

        {/* Divider */}
        <div className="h-px mx-6 bg-white/8" />

        {/* Content */}
        <div className="p-6 space-y-4">
          {/* Action buttons */}
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={async () => {
                setScanResults([]);
                await scanFolder();
              }}
              disabled={scanning}
              className="flex flex-col items-center gap-2 p-4 rounded-2xl border transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:border-purple-500/40"
              style={{
                background: 'rgba(124,58,237,0.12)',
                border: '1px solid rgba(124,58,237,0.25)',
              }}
            >
              {scanning ? (
                <Loader2 size={24} className="text-purple-400 animate-spin" />
              ) : (
                <FolderOpen size={24} className="text-purple-400" />
              )}
              <span className="text-white text-sm font-medium">
                {scanning ? 'Scanning…' : 'Scan Folder'}
              </span>
              <span className="text-white/40 text-xs text-center leading-tight">
                Auto-detect music subfolders
              </span>
            </button>

            <button
              onClick={() => { openFilePicker(); onClose(); }}
              className="flex flex-col items-center gap-2 p-4 rounded-2xl border transition-all hover:border-indigo-500/40"
              style={{
                background: 'rgba(99,102,241,0.12)',
                border: '1px solid rgba(99,102,241,0.25)',
              }}
            >
              <Music size={24} className="text-indigo-400" />
              <span className="text-white text-sm font-medium">Pick Files</span>
              <span className="text-white/40 text-xs text-center leading-tight">
                Select individual tracks
              </span>
            </button>
          </div>

          {/* Error */}
          {error && (
            <div className="px-4 py-3 rounded-xl bg-red-900/30 border border-red-500/20 text-red-300 text-sm">
              {error}
            </div>
          )}

          {/* Scan results */}
          {scanResults.length > 0 && (
            <div>
              <p className="text-white/50 text-xs mb-3 uppercase tracking-widest font-medium">
                Found {scanResults.length} folder{scanResults.length > 1 ? 's' : ''}
              </p>
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {scanResults.map((result: ScanResult) => (
                  <button
                    key={result.folderName}
                    onClick={async () => {
                      await playFolder(result);
                      onClose();
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left group transition-all hover:bg-purple-900/30"
                    style={{ border: '1px solid rgba(255,255,255,0.06)' }}
                  >
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors group-hover:bg-purple-800/50"
                      style={{ background: 'rgba(124,58,237,0.2)' }}>
                      <Folder size={18} className="text-purple-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-medium truncate">{result.folderName}</p>
                      <p className="text-white/40 text-xs">{result.fileCount} track{result.fileCount > 1 ? 's' : ''}</p>
                    </div>
                    <div className="text-purple-400 text-xs opacity-0 group-hover:opacity-100 transition-opacity font-medium">
                      Add all →
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Drag hint */}
          <div className="flex items-center gap-2 text-white/25 text-xs">
            <div className="flex-1 h-px bg-white/8" />
            <span>or drag &amp; drop audio files onto the player</span>
            <div className="flex-1 h-px bg-white/8" />
          </div>
        </div>
      </div>
    </>
  );
}
