'use client';
// components/DropOverlay.tsx - Full-screen drag and drop overlay

import { Music } from 'lucide-react';

interface DropOverlayProps {
  isDragging: boolean;
}

export function DropOverlay({ isDragging }: DropOverlayProps) {
  return (
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center pointer-events-none transition-all duration-200 ${
        isDragging ? 'opacity-100' : 'opacity-0'
      }`}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0"
        style={{
          background: 'rgba(10, 6, 24, 0.88)',
          backdropFilter: 'blur(12px)',
        }}
      />

      {/* Content */}
      <div
        className="relative flex flex-col items-center gap-6 px-12 py-10 rounded-3xl"
        style={{
          background: 'rgba(124, 58, 237, 0.15)',
          border: '2px dashed rgba(167, 139, 250, 0.5)',
          boxShadow: '0 0 80px rgba(124,58,237,0.3)',
        }}
      >
        <div
          className="w-20 h-20 rounded-2xl flex items-center justify-center"
          style={{ background: 'rgba(124,58,237,0.25)' }}
        >
          <Music size={36} className="text-purple-400 animate-bounce" />
        </div>
        <div className="text-center">
          <p className="text-white text-2xl font-bold tracking-tight" style={{ fontFamily: 'var(--font-display)' }}>
            Drop to Play
          </p>
          <p className="text-purple-300 text-sm mt-1 opacity-80">
            Release to add to queue and play
          </p>
        </div>

        {/* Animated rings */}
        <div className="absolute inset-0 rounded-3xl">
          <div
            className="absolute inset-0 rounded-3xl animate-ping"
            style={{
              border: '2px solid rgba(167,139,250,0.2)',
              animationDuration: '1.5s',
            }}
          />
        </div>
      </div>
    </div>
  );
}
