'use client';
// components/QueuePanel.tsx
//
// Reorder fix: uses index-based swap instead of splice-at-drop.
// dragOverIndex tracked in a ref (not state) so React re-renders
// don't interfere with the drag sequence.
// Each row has pointer-events:none on all children except the grip handle,
// so dragenter fires only on the row div itself — no child interference.

import { useState, useRef, useCallback } from 'react';
import { X, Music, Trash2, GripVertical } from 'lucide-react';
import { usePlayer } from '@/lib/playerStore';
import { TrackMeta } from '@/lib/db';
import { VinylSVG } from './VinylSVG';
import { formatTime } from '@/lib/metaParser';

interface QueuePanelProps {
  open:    boolean;
  onClose: () => void;
}

export function QueuePanel({ open, onClose }: QueuePanelProps) {
  const { state, play, removeFromQueue, reorderQueue, clearAll } = usePlayer();
  const { queue, currentIndex, isPlaying } = state;

  // Use refs for drag indices — avoids stale closure issues in handlers
  const dragFromRef = useRef<number | null>(null);
  const dragToRef   = useRef<number | null>(null);

  // Only use state for the visual drop-target highlight
  const [dropHighlight, setDropHighlight] = useState<number | null>(null);

  const handleDragStart = useCallback((e: React.DragEvent<HTMLDivElement>, index: number) => {
    dragFromRef.current = index;
    dragToRef.current   = index;
    e.dataTransfer.effectAllowed = 'move';
    // Transparent 1x1 drag image so the browser ghost doesn't fight with our opacity
    const ghost = document.createElement('div');
    ghost.style.cssText = 'position:fixed;top:-100px;width:1px;height:1px;opacity:0';
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 0, 0);
    requestAnimationFrame(() => document.body.removeChild(ghost));
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>, index: number) => {
    e.preventDefault();
    if (dragFromRef.current === null) return;
    dragToRef.current = index;
    setDropHighlight(index);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    // Must prevent default to allow drop
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>, dropIndex: number) => {
    e.preventDefault();
    e.stopPropagation();
    const fromIndex = dragFromRef.current;
    if (fromIndex === null || fromIndex === dropIndex) {
      dragFromRef.current = null;
      dragToRef.current   = null;
      setDropHighlight(null);
      return;
    }

    // Simple index swap: remove from source, insert at destination
    const next = [...queue];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(dropIndex, 0, moved);
    reorderQueue(next);

    dragFromRef.current = null;
    dragToRef.current   = null;
    setDropHighlight(null);
  }, [queue, reorderQueue]);

  const handleDragEnd = useCallback(() => {
    dragFromRef.current = null;
    dragToRef.current   = null;
    setDropHighlight(null);
  }, []);

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-40 transition-opacity duration-300 ${
          open
            ? "opacity-100 pointer-events-auto"
            : "opacity-0 pointer-events-none"
        }`}
        style={{ background: "rgba(0,0,0,0.60)", backdropFilter: "blur(6px)" }}
        onClick={onClose}
      />

      {/* Panel — monochrome glass */}
      <div
        className={`fixed bottom-0 left-0 right-0 z-50 rounded-t-3xl transition-transform duration-500 ${
          open ? "translate-y-0" : "translate-y-full"
        }`}
        style={{
          maxHeight: "72vh",
          background: "rgba(10,10,10,0.97)",
          backdropFilter: "blur(40px)",
          borderTop: "1px solid rgba(255,255,255,0.10)",
          borderLeft: "1px solid rgba(255,255,255,0.06)",
          borderRight: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        {/* Pull indicator */}
        <div className="flex justify-center pt-3 pb-1">
          <div
            style={{
              width: 36,
              height: 4,
              borderRadius: 2,
              background: "rgba(255,255,255,0.18)",
            }}
          />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3">
          <div className="flex items-center gap-2">
            <Music size={15} style={{ color: "rgba(255,255,255,0.45)" }} />
            <span
              style={{
                color: "rgba(255,255,255,0.80)",
                fontWeight: 600,
                fontSize: 13,
              }}
            >
              Queue
            </span>
            <span
              style={{
                fontSize: 11,
                padding: "1px 8px",
                borderRadius: 99,
                background: "rgba(255,255,255,0.08)",
                color: "rgba(255,255,255,0.40)",
              }}
            >
              {queue.length}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {queue.length > 0 && (
              <button
                onClick={clearAll}
                className="flex items-center gap-1 px-2 py-1 rounded-lg transition-colors text-xs"
                style={{ color: "rgba(255,80,80,0.65)" }}
                onMouseEnter={(e) =>
                  ((e.target as HTMLElement).style.color = "rgba(255,80,80,1)")
                }
                onMouseLeave={(e) =>
                  ((e.target as HTMLElement).style.color =
                    "rgba(255,80,80,0.65)")
                }
              >
                <Trash2 size={16} />
              </button>
            )}
            <button
              onClick={onClose}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: 6,
                borderRadius: "50%",
                color: "rgba(255,255,255,0.40)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <X size={16}/>
            </button>
          </div>
        </div>

        {/* Divider */}
        <div
          style={{
            height: 1,
            background: "rgba(255,255,255,0.06)",
            margin: "0 16px 4px",
          }}
        />

        {/* Track list */}
        <div
          className="overflow-y-auto pb-8"
          style={{ maxHeight: "calc(72vh - 112px)", padding: "0 8px" }}
        >
          {queue.length === 0 ? (
            <div
              className="text-center py-14"
              style={{ color: "rgba(255,255,255,0.22)", fontSize: 13 }}
            >
              <Music
                size={28}
                className="mx-auto mb-3"
                style={{ opacity: 0.2 }}
              />
              <p>Queue is empty</p>
              <p style={{ fontSize: 11, marginTop: 4, opacity: 0.6 }}>
                Drop audio files or tap Add Music
              </p>
            </div>
          ) : (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 1,
                paddingTop: 4,
              }}
            >
              {queue.map((track: TrackMeta, i: number) => {
                const isActive = i === currentIndex;
                const isDropTarget = dropHighlight === i;
                const isDragging = dragFromRef.current === i;

                return (
                  <div
                    key={track.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, i)}
                    onDragEnter={(e) => handleDragEnter(e, i)}
                    onDragOver={handleDragOver}
                    onDrop={(e) => handleDrop(e, i)}
                    onDragEnd={handleDragEnd}
                    onClick={() => play(i)}
                    className="group"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "7px 6px",
                      borderRadius: 10,
                      cursor: "pointer",
                      userSelect: "none",
                      background: isActive
                        ? "rgba(255,255,255,0.07)"
                        : isDropTarget
                          ? "rgba(255,255,255,0.04)"
                          : "transparent",
                      borderTop: isDropTarget
                        ? "1px solid rgba(255,255,255,0.22)"
                        : "1px solid transparent",
                      borderBottom: "1px solid transparent",
                      borderLeft: "1px solid transparent",
                      borderRight: "1px solid transparent",
                      opacity: isDragging ? 0.35 : 1,
                      transition: "background 0.12s, opacity 0.12s",
                    }}
                  >
                    {/* ── Drag grip — only interactive element, stops click propagation ── */}
                    <div
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        flexShrink: 0,
                        cursor: "grab",
                        color: "rgba(255,255,255,0.18)",
                        padding: "2px 0",
                        display: "flex",
                        alignItems: "center",
                        // Give it a real drag zone without blocking the row
                      }}
                    >
                      <GripVertical size={14} />
                    </div>

                    {/* ── Thumbnail — pointer-events none so it doesn't catch dragenter ── */}
                    <div
                      style={{
                        flexShrink: 0,
                        position: "relative",
                        width: 36,
                        height: 36,
                        borderRadius: 8,
                        overflow: "hidden",
                        pointerEvents: "none", // ← key: prevents child dragenter
                      }}
                    >
                      {track.coverUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={track.coverUrl}
                          alt=""
                          style={{
                            width: "100%",
                            height: "100%",
                            objectFit: "cover",
                            display: "block",
                          }}
                        />
                      ) : (
                        <div
                          style={{
                            width: "100%",
                            height: "100%",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            background: "rgba(255,255,255,0.05)",
                          }}
                        >
                          <VinylSVG
                            size={26}
                            spinning={isActive && isPlaying}
                          />
                        </div>
                      )}
                      {isActive && isPlaying && (
                        <div
                          style={{
                            position: "absolute",
                            inset: 0,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            background: "rgba(0,0,0,0.50)",
                          }}
                        >
                          <NowPlayingBars />
                        </div>
                      )}
                    </div>

                    {/* ── Info — pointer-events none to prevent child dragenter ── */}
                    <div
                      style={{ flex: 1, minWidth: 0, pointerEvents: "none" }}
                    >
                      <p
                        style={{
                          margin: 0,
                          fontSize: 12,
                          fontWeight: 500,
                          lineHeight: 1.3,
                          color: isActive
                            ? "rgba(255,255,255,0.95)"
                            : "rgba(255,255,255,0.75)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {track.title}
                      </p>
                      <p
                        style={{
                          margin: 0,
                          fontSize: 10,
                          lineHeight: 1.3,
                          marginTop: 1,
                          color: "rgba(255,255,255,0.35)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {track.artist}
                        {track.duration > 0 && (
                          <span
                            style={{
                              color: "rgba(255,255,255,0.20)",
                              marginLeft: 6,
                            }}
                          >
                            {formatTime(track.duration)}
                          </span>
                        )}
                      </p>
                    </div>

                    {/* ── Remove button — always rendered, visibility via opacity ── */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeFromQueue(track.id);
                      }}
                      style={{
                        flexShrink: 0,
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        padding: 4,
                        borderRadius: 4,
                        color: "rgba(255,255,255,0.25)",
                        opacity: 0, // shown via CSS group-hover below
                        transition: "color 0.15s, opacity 0.15s",
                        display: "flex",
                        alignItems: "center",
                      }}
                      className="group-hover:opacity-100"
                      onMouseEnter={(e) =>
                        ((e.currentTarget as HTMLElement).style.color =
                          "rgba(255,90,90,0.85)")
                      }
                      onMouseLeave={(e) =>
                        ((e.currentTarget as HTMLElement).style.color =
                          "rgba(255,255,255,0.25)")
                      }
                      aria-label="Remove"
                    >
                      <X size={13} />
                    </button>
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

function NowPlayingBars() {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 14 }}>
      {[1, 2, 3].map(i => (
        <div key={i} style={{
          width: 3, borderRadius: 2, background: 'white',
          height: `${6 + i * 3}px`,
          animation: 'queueBar 0.7s ease-in-out infinite',
          animationDelay: `${i * 0.13}s`,
        }} />
      ))}
      <style>{`
        @keyframes queueBar {
          0%, 100% { transform: scaleY(0.35); }
          50% { transform: scaleY(1); }
        }
      `}</style>
    </div>
  );
}
