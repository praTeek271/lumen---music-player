'use client';
// components/QueuePanel.tsx - Slide-up queue panel with track list

import { X, Music, Trash2 } from 'lucide-react';
import { usePlayer } from '@/lib/playerStore';
import { VinylSVG } from './VinylSVG';
import { formatTime } from '@/lib/metaParser';

interface QueuePanelProps {
  open: boolean;
  onClose: () => void;
}

export function QueuePanel({ open, onClose }: QueuePanelProps) {
  const { state, play, removeFromQueue, clearAll } = usePlayer();
  const { queue, currentIndex, isPlaying } = state;

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-40 transition-opacity duration-300 ${open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
        style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className={`fixed bottom-0 left-0 right-0 z-50 rounded-t-3xl transition-transform duration-500 ${open ? 'translate-y-0' : 'translate-y-full'}`}
        style={{
          maxHeight: '70vh',
          background: 'rgba(14, 10, 30, 0.92)',
          backdropFilter: 'blur(40px)',
          border: '1px solid rgba(167,139,250,0.15)',
          borderBottom: 'none',
        }}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-white/20" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3">
          <div className="flex items-center gap-2">
            <Music size={16} className="text-purple-400" />
            <span className="text-white font-semibold text-sm" style={{ fontFamily: 'var(--font-display)' }}>
              Queue
            </span>
            <span className="text-purple-300 text-xs bg-purple-900/40 px-2 py-0.5 rounded-full">
              {queue.length}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {queue.length > 0 && (
              <button
                onClick={clearAll}
                className="flex items-center gap-1 text-xs text-red-400/70 hover:text-red-400 transition-colors px-2 py-1 rounded-lg hover:bg-red-900/20"
              >
                <Trash2 size={13} />
                Clear all
              </button>
            )}
            <button onClick={onClose} className="p-1.5 rounded-full hover:bg-white/8 transition-colors">
              <X size={18} className="text-white/60" />
            </button>
          </div>
        </div>

        {/* Track list */}
        <div className="overflow-y-auto px-3 pb-6" style={{ maxHeight: 'calc(70vh - 100px)' }}>
          {queue.length === 0 ? (
            <div className="text-center py-12 text-white/30 text-sm">
              <Music size={32} className="mx-auto mb-3 opacity-30" />
              <p>No tracks in queue</p>
              <p className="text-xs mt-1 opacity-60">Drop audio files here or use the + button</p>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {queue.map((track, i) => {
                const isActive = i === currentIndex;
                return (
                  <div
                    key={track.id}
                    onClick={() => play(i)}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer group transition-all ${
                      isActive
                        ? 'bg-purple-900/40 border border-purple-500/20'
                        : 'hover:bg-white/5'
                    }`}
                  >
                    {/* Cover */}
                    <div className="relative w-10 h-10 rounded-lg overflow-hidden flex-shrink-0">
                      {track.coverUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={track.coverUrl} alt={track.title} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-purple-950">
                          <VinylSVG size={32} spinning={isActive && isPlaying} />
                        </div>
                      )}
                      {isActive && isPlaying && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                          <NowPlayingBars />
                        </div>
                      )}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium truncate ${isActive ? 'text-purple-300' : 'text-white/80'}`}>
                        {track.title}
                      </p>
                      <p className="text-xs text-white/40 truncate">{track.artist}</p>
                    </div>

                    {/* Duration + remove */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-xs text-white/30 tabular-nums">
                        {track.duration > 0 ? formatTime(track.duration) : '—'}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeFromQueue(track.id);
                        }}
                        className="p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity hover:text-red-400 text-white/40"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// Animated bars for "now playing" indicator
function NowPlayingBars() {
  return (
    <div className="flex items-end gap-0.5 h-4">
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className="w-1 rounded-sm bg-purple-400"
          style={{
            animation: `nowPlayingBar 0.8s ease-in-out infinite`,
            animationDelay: `${i * 0.15}s`,
            height: `${8 + i * 4}px`,
          }}
        />
      ))}
      <style>{`
        @keyframes nowPlayingBar {
          0%, 100% { transform: scaleY(0.3); }
          50% { transform: scaleY(1); }
        }
      `}</style>
    </div>
  );
}
