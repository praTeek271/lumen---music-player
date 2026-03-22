'use client';
// components/DropOverlay.tsx — monochrome drop target overlay

import { Music } from 'lucide-react';

interface DropOverlayProps {
  isDragging: boolean;
}

export function DropOverlay({ isDragging }: DropOverlayProps) {
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        pointerEvents: 'none',
        opacity: isDragging ? 1 : 0,
        transition: 'opacity 0.18s ease',
      }}
    >
      {/* Dark blur backdrop */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'rgba(0,0,0,0.82)',
        backdropFilter: 'blur(14px)',
      }} />

      {/* Drop target card — white dashed border */}
      <div style={{
        position: 'relative',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', gap: 18,
        padding: '40px 56px',
        borderRadius: 28,
        background: 'rgba(255,255,255,0.05)',
        border: '2px dashed rgba(255,255,255,0.35)',
        boxShadow: '0 0 60px rgba(255,255,255,0.04)',
      }}>
        <div style={{
          width: 72, height: 72, borderRadius: 18,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(255,255,255,0.08)',
          border: '1px solid rgba(255,255,255,0.12)',
        }}>
          <Music size={32} style={{ color: 'rgba(255,255,255,0.70)' }} />
        </div>

        <div style={{ textAlign: 'center' }}>
          <p style={{
            fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700,
            color: 'rgba(255,255,255,0.90)', margin: 0, letterSpacing: '-0.01em',
          }}>
            Drop to Add
          </p>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.40)', marginTop: 6 }}>
            Release to add to queue
          </p>
        </div>

        {/* Expanding ring animation */}
        <div style={{
          position: 'absolute', inset: -2, borderRadius: 28,
          border: '2px solid rgba(255,255,255,0.12)',
          animation: isDragging ? 'dropRing 1.4s ease-out infinite' : 'none',
        }} />

        <style>{`
          @keyframes dropRing {
            0%   { transform: scale(1);    opacity: 0.6; }
            100% { transform: scale(1.08); opacity: 0;   }
          }
        `}</style>
      </div>
    </div>
  );
}
