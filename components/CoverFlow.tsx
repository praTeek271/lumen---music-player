'use client';
// components/CoverFlow.tsx
// Premium 3D coverflow:
//  - 1200px perspective
//  - Cards: 15px padding acting as physical "frame" around album art (1:1)
//  - Gray frosted glass base (rgba(80,80,80,0.35)) with blur(40px) backdrop
//  - Title + artist sit BELOW the image frame, not overlaid on art
//  - Side cards: progressive Z-push + inward rotateY

import { useEffect, useRef, useState, useCallback } from 'react';
import { usePlayer } from '@/lib/playerStore';
import { VinylSVG } from './VinylSVG';

const SIDE_COUNT = 2;

// Physical card dimensions (the frosted glass shell)
const CARD_W = 280;
const CARD_H = 360; // taller to accommodate image + text below

// Padding that creates the "frame" effect around album art
const FRAME_PAD = 15;

interface CardTransform {
  translateX: number;
  translateZ: number;
  rotateY: number;
  scale: number;
  opacity: number;
  zIndex: number;
}

function getTransform(offset: number): CardTransform {
  const abs  = Math.abs(offset);
  if (offset === 0) {
    return { translateX: 0, translateZ: 80, rotateY: 0, scale: 1, opacity: 1, zIndex: 10 };
  }
  const sign = offset > 0 ? 1 : -1;
  return {
    // Each successive card: step back and to the side
    translateX: sign * (CARD_W * 0.48 + abs * 12),
    translateZ: -80 - abs * 70,
    rotateY:    sign * -42,
    scale:      0.82 - abs * 0.04,
    opacity:    0.60 - abs * 0.14,
    zIndex:     10 - abs,
  };
}


/**
 * Generate a deterministic warm gradient from a seed string.
 * Each track without cover art gets its own distinct color — no two cards
 * look identical, and all palettes are warm/rich enough to look good on screen.
 */
function defaultCardGradient(seed: string): string {
  // Simple hash → number in 0..1
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (Math.imul(31, h) + seed.charCodeAt(i)) >>> 0;
  const t = (h >>> 0) / 0xFFFFFFFF;

  // Eight warm palette pairs [from, to]
  const palettes: [string, string][] = [
    ['#7c2d12', '#451a03'],   // deep amber
    ['#713f12', '#3f2d00'],   // dark gold
    ['#14532d', '#052e16'],   // forest green
    ['#1e3a5f', '#0c1a2e'],   // deep navy
    ['#4a044e', '#2d0030'],   // dark violet
    ['#7f1d1d', '#450a0a'],   // deep crimson
    ['#064e3b', '#022c22'],   // dark teal
    ['#3b0764', '#1e0533'],   // deep purple
  ];

  const [from, to] = palettes[Math.floor(t * palettes.length)];
  const angle = 120 + Math.floor(t * 80); // vary angle 120–200°
  return `linear-gradient(${angle}deg, ${from} 0%, ${to} 100%)`;
}

export function CoverFlow() {
  const { state, play, next, prev, removeFromQueue } = usePlayer();
  const { queue, currentIndex, isPlaying, trackLoadingId, trackErrors } = state;
  const [mounted, setMounted]   = useState(false);
  const touchStartX             = useRef(0);

  // Trigger "mounted" so CSS entry animation fires once
  useEffect(() => {
    const id = setTimeout(() => setMounted(true), 80);
    return () => clearTimeout(id);
  }, []);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  }, []);

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    const delta = e.changedTouches[0].clientX - touchStartX.current;
    if (Math.abs(delta) > 48) delta < 0 ? next() : prev();
  }, [next, prev]);

  if (!queue.length) return null;

  const start = Math.max(0, currentIndex - SIDE_COUNT);
  const end   = Math.min(queue.length - 1, currentIndex + SIDE_COUNT);

  return (
    <div
      className="relative w-full flex items-center justify-center select-none"
      style={{
        height: `clamp(320px, 48vw, ${CARD_H + 60}px)`,
        // 1200px perspective as specified
        perspective:       '1200px',
        perspectiveOrigin: '50% 46%',
      }}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <div
        className="relative w-full h-full flex items-center justify-center"
        style={{ transformStyle: 'preserve-3d' }}
      >
        {queue.slice(start, end + 1).map((track, i) => {
          const realIndex = start + i;
          const offset    = realIndex - currentIndex;
          const isActive  = offset === 0;
          const tf        = getTransform(offset);

          // Album art area height = card height minus padding (top+bottom) minus text area
          const textAreaH = 56; // px reserved below image for title + artist
          const artSize   = CARD_W - FRAME_PAD * 2; // square, enforced

          return (
            <div
              key={track.id}
              onClick={() => !isActive && play(realIndex)}
              className="absolute"
              style={{
                width:  CARD_W,
                height: CARD_H,
                transform: `translateX(${tf.translateX}px) translateZ(${tf.translateZ}px) rotateY(${tf.rotateY}deg) scale(${tf.scale})`,
                opacity:   tf.opacity,
                zIndex:    tf.zIndex,
                cursor:    isActive ? 'default' : 'pointer',
                transition: 'all 0.55s cubic-bezier(0.16, 1, 0.3, 1)',
                // Entry unfold animation (only before mounted)
                animation: mounted
                  ? undefined
                  : `cardUnfold 0.72s cubic-bezier(0.16,1,0.3,1) ${Math.abs(offset) * 0.09}s both`,
              }}
            >
              {/* ── Gray frosted glass card shell ─────────────────── */}
              <div
                className="relative w-full h-full rounded-3xl flex flex-col"
                style={{
                  background:        'rgba(80, 80, 80, 0.35)',
                  backdropFilter:    'blur(40px) saturate(140%)',
                  WebkitBackdropFilter: 'blur(40px) saturate(140%)',
                  border: isActive
                    ? '1px solid rgba(255,255,255,0.22)'
                    : '1px solid rgba(255,255,255,0.10)',
                  boxShadow: isActive
                    ? '0 32px 80px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.08)'
                    : '0 12px 36px rgba(0,0,0,0.40)',
                  overflow: 'hidden',
                }}
              >
                {/* ── BROKEN CARD: load failed — blurred, trash icon ─ */}
                {trackErrors.has(track.id) && (
                  <button
                    onClick={(e) => { e.stopPropagation(); removeFromQueue(track.id); }}
                    title="Remove from queue"
                    style={{
                      position: 'absolute', inset: 0, zIndex: 20,
                      display: 'flex', flexDirection: 'column',
                      alignItems: 'center', justifyContent: 'center',
                      gap: 10, padding: 20,
                      background: 'rgba(30,30,30,0.72)',
                      backdropFilter: 'blur(12px)',
                      WebkitBackdropFilter: 'blur(12px)',
                      border: '1.5px solid rgba(255,255,255,0.12)',
                      borderRadius: 24,
                      cursor: 'pointer',
                      transition: 'background 0.2s',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(50,30,30,0.82)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'rgba(30,30,30,0.72)')}
                  >
                    {/* Grey circle with black trash icon */}
                    <div style={{
                      width: 52, height: 52, borderRadius: '50%',
                      background: '#9ca3af',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      boxShadow: '0 2px 12px rgba(0,0,0,0.4)',
                    }}>
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#111" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
                      </svg>
                    </div>
                    <p style={{ margin: 0, fontSize: 11, color: 'rgba(255,255,255,0.55)', textAlign: 'center', lineHeight: 1.4 }}>
                      Failed to load<br/>
                      <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>Click to remove</span>
                    </p>
                  </button>
                )}
                {/* ── Album art: 15px framed, perfect 1:1 square ─── */}
                <div
                  style={{
                    margin:   `${FRAME_PAD}px ${FRAME_PAD}px 0`,
                    width:    artSize,
                    height:   artSize,
                    flexShrink: 0,
                    borderRadius: 14,
                    overflow: 'hidden',
                    // Slight inner shadow to give depth to the frame
                    boxShadow: '0 4px 20px rgba(0,0,0,0.45)',
                  }}
                >
                  {track.coverUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={track.coverUrl}
                      alt={track.title}
                      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                      draggable={false}
                    />
                  ) : (
                    <div
                      style={{
                        width: '100%', height: '100%',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: defaultCardGradient(track.title + track.artist),
                      }}
                    >
                      <VinylSVG size={artSize * 0.72} spinning={isActive && isPlaying} />
                    </div>
                  )}
                </div>

                {/* ── Text BELOW the frame — skeleton during load, normal after ── */}
                <div
                  style={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    paddingLeft:  FRAME_PAD + 2,
                    paddingRight: FRAME_PAD + 2,
                    paddingTop:   10,
                  }}
                >
                  {/* Show skeleton shimmer on title + artist while trackLoadingId matches this card */}
                  {isActive && trackLoadingId === track.id && !trackErrors.has(track.id) ? (
                    <>
                      {/* Skeleton title line */}
                      <div style={{
                        height: 13, width: '68%', borderRadius: 6,
                        background: 'rgba(255,255,255,0.08)',
                        position: 'relative', overflow: 'hidden', marginBottom: 6,
                      }}>
                        <div style={{ position: 'absolute', inset: 0, animation: 'cardShimmer 1.6s ease-in-out infinite' }} />
                      </div>
                      {/* Skeleton artist line */}
                      <div style={{
                        height: 10, width: '45%', borderRadius: 5,
                        background: 'rgba(255,255,255,0.05)',
                        position: 'relative', overflow: 'hidden',
                      }}>
                        <div style={{ position: 'absolute', inset: 0, animation: 'cardShimmer 1.6s ease-in-out infinite 0.2s' }} />
                      </div>
                    </>
                  ) : (
                    <>
                      <p
                        className="truncate font-semibold leading-tight"
                        style={{
                          fontSize:   isActive ? 15 : 13,
                          color:      trackErrors.has(track.id)
                            ? 'rgba(255,255,255,0.25)'
                            : isActive ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.65)',
                          fontFamily: 'var(--font-display)',
                          letterSpacing: '-0.01em',
                        }}
                      >
                        {track.title}
                      </p>
                      <p
                        className="truncate mt-0.5"
                        style={{
                          fontSize: 12,
                          color: trackErrors.has(track.id)
                            ? 'rgba(255,255,255,0.18)'
                            : isActive ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.35)',
                        }}
                      >
                        {track.artist}
                      </p>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <style>{`
        @keyframes cardUnfold {
          from {
            opacity: 0;
            transform: translateX(0px) translateZ(-200px) rotateY(-88deg) scale(0.55);
          }
          to { opacity: 1; }
        }
        @keyframes cardShimmer {
          0%   { background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.12) 50%, transparent 100%); background-size: 200% 100%; background-position: -100% 0; }
          100% { background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.12) 50%, transparent 100%); background-size: 200% 100%; background-position: 200% 0; }
        }
      `}</style>
    </div>
  );
}
