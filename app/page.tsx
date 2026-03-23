"use client";
// app/page.tsx — LUMEN Immersive Player
//
// Background zones:
//  • Behind CoverFlow  → album-art dominant-colour radial gradient (cinematic)
//  • Queue panel       → deep black monochrome glass (clean)
//  • Empty / top bar   → pure black monochrome

import { useState, useEffect, useCallback, useRef } from "react";
import { Plus, Download, ChevronLeft, ChevronRight } from "lucide-react";

import { usePlayer } from "@/lib/playerStore";
import { useDragDrop } from "@/hooks/useDragDrop";

import { CoverFlow } from "@/components/CoverFlow";
import { PlaybackBar } from "@/components/PlaybackBar";
import { QueuePanel } from "@/components/QueuePanel";
import { FolderScanner } from "@/components/FolderScanner";
import { DropOverlay } from "@/components/DropOverlay";
import { VinylSVG } from "@/components/VinylSVG";
import { RestoringSkeleton } from "@/components/RestoringSkeleton";
import { FirstLaunch } from "@/components/FirstLaunch";
import { useMusicFolders } from "@/hooks/useMusicFolders";
import { getSetting, saveSetting } from "@/lib/db";

/* ── Canvas 16×16 dominant-colour extractor ─────────────────────────────── */
function extractRGB(src: string): Promise<[number, number, number]> {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = c.height = 16;
        const ctx = c.getContext("2d");
        if (!ctx) {
          resolve([80, 80, 80]);
          return;
        }
        ctx.drawImage(img, 0, 0, 16, 16);
        const d = ctx.getImageData(0, 0, 16, 16).data;
        let r = 0,
          g = 0,
          b = 0;
        for (let i = 0; i < d.length; i += 4) {
          r += d[i];
          g += d[i + 1];
          b += d[i + 2];
        }
        const n = d.length / 4;
        // Boost saturation — make the glow vivid
        resolve([
          Math.min(255, Math.round((r / n) * 1.5)),
          Math.min(255, Math.round((g / n) * 1.5)),
          Math.min(255, Math.round((b / n) * 1.5)),
        ]);
      };
      img.onerror = () => resolve([80, 80, 80]);
      img.src = src;
    } catch {
      resolve([80, 80, 80]);
    }
  });
}

/* ── PWA install prompt ─────────────────────────────────────────────────── */
function useInstallPrompt() {
  const [prompt, setPrompt] = useState<Event | null>(null);
  useEffect(() => {
    const h = (e: Event) => {
      e.preventDefault();
      setPrompt(e);
    };
    window.addEventListener("beforeinstallprompt", h);
    return () => window.removeEventListener("beforeinstallprompt", h);
  }, []);
  const install = useCallback(async () => {
    if (!prompt) return;
    (prompt as any).prompt();
    await (prompt as any).userChoice;
    setPrompt(null);
  }, [prompt]);
  return { canInstall: !!prompt, install };
}

/* ══════════════════════════════════════════════════════════════════════════ */

export default function ImmersivePlayer() {
  const { state, next, prev, toggle, addFiles } = usePlayer();
  const { queue, currentIndex, isPlaying, restoring, loading } = state;

  const { isDragging } = useDragDrop();
  const { canInstall, install } = useInstallPrompt();

  const [queueOpen, setQueueOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [showFirstLaunch, setShowFirstLaunch] = useState(false);

  const { syncSavedFolders } = useMusicFolders();

  // On mount: show first-launch if never seen, then silently re-scan saved folders
  useEffect(() => {
    (async () => {
      const seen = await getSetting("firstLaunchDone").catch(() => false);
      if (!seen) setShowFirstLaunch(true);
      // Always attempt to silently reload saved folder handles
      // (does nothing if no folders were ever granted)
      await syncSavedFolders(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dismissFirstLaunch = useCallback(async () => {
    await saveSetting("firstLaunchDone", true).catch(() => {});
    setShowFirstLaunch(false);
  }, []);

  // Album colour for the CoverFlow zone only
  const [albumRGB, setAlbumRGB] = useState("60,60,60");
  const currentTrack = queue[currentIndex];

  useEffect(() => {
    if (!currentTrack?.coverUrl) {
      setAlbumRGB("60,60,60");
      return;
    }
    extractRGB(currentTrack.coverUrl).then(([r, g, b]) =>
      setAlbumRGB(`${r},${g},${b}`),
    );
  }, [currentTrack?.coverUrl, currentTrack?.id]);

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(tag)) return;
      if (e.code === "ArrowRight") {
        e.preventDefault();
        next();
      }
      if (e.code === "ArrowLeft") {
        e.preventDefault();
        prev();
      }
      if (e.code === "Space") {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev, toggle]);

  return (
    <div
      className="relative w-full h-full flex flex-col overflow-hidden"
      style={{ background: "#0a0a0a" }}
    >
      {/* ── First-launch permission screen ──────────────────────────────── */}
      {showFirstLaunch && (
        <FirstLaunch
          onDismiss={dismissFirstLaunch}
          onPickFiles={() => {
            openFilePicker();
            dismissFirstLaunch();
          }}
        />
      )}

      {/* ── Loading overlay ──────────────────────────────────────────────── */}
      {loading && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9998,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 18,
            background: "rgba(0,0,0,0.78)",
            backdropFilter: "blur(10px)",
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: "50%",
              border: "3px solid rgba(255,255,255,0.10)",
              borderTopColor: "rgba(255,255,255,0.88)",
              animation: "spin 0.75s linear infinite",
            }}
          />
          <div style={{ textAlign: "center" }}>
            <p
              style={{
                color: "rgba(255,255,255,0.90)",
                fontSize: 14,
                fontWeight: 600,
                margin: 0,
              }}
            >
              Loading tracks…
            </p>
            <p
              style={{
                color: "rgba(255,255,255,0.35)",
                fontSize: 12,
                marginTop: 3,
              }}
            >
              {queue.length > 0
                ? `${queue.length} added so far`
                : "Parsing files"}
            </p>
          </div>
          {/* Indeterminate bar */}
          <div
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              height: 2,
              background: "rgba(255,255,255,0.07)",
            }}
          >
            <div
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                width: "35%",
                background: "rgba(255,255,255,0.70)",
                animation: "loadingSlide 1.1s ease-in-out infinite",
                borderRadius: 1,
              }}
            />
          </div>
        </div>
      )}

      {/* ── BASE: pure black background ──────────────────────────────────── */}
      <div
        className="absolute inset-0"
        style={{ background: "#0a0a0a" }}
        aria-hidden
      />

      {/* ── ALBUM GLOW — only covers the CoverFlow stage area ───────────── */}
      {/* Positioned in the top 65% of the screen — below header, above pill */}
      <div
        className="absolute inset-x-0"
        style={{
          top: 0,
          height: "68%",
          pointerEvents: "none",
          overflow: "hidden",
          zIndex: 0,
        }}
        aria-hidden
      >
        {/* Primary colour blob */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: `radial-gradient(ellipse 90% 80% at 50% 60%,
            rgba(${albumRGB}, ${isPlaying ? 0.55 : 0.32}) 0%,
            rgba(${albumRGB}, ${isPlaying ? 0.2 : 0.1}) 45%,
            transparent 72%)`,
            transition: "background 1.4s ease",
          }}
        />
        {/* Vignette to keep text readable */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(ellipse 100% 100% at 50% 50%, transparent 25%, rgba(0,0,0,0.65) 100%)",
          }}
        />
      </div>

      {/* ── Bottom fade to black (for pill bar legibility) ───────────────── */}
      <div
        className="absolute inset-x-0 bottom-0"
        style={{
          height: "35%",
          zIndex: 0,
          pointerEvents: "none",
          background: "linear-gradient(to top, #0a0a0a 0%, transparent 100%)",
        }}
        aria-hidden
      />

      {/* ── TOP BAR ─────────────────────────────────────────────────────── */}
      <header className="relative z-10 flex items-center justify-between px-5 pt-5 pb-0 safe-top flex-shrink-0">
        <div>
          <h1
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 18,
              fontWeight: 700,
              color: "rgba(255,255,255,0.90)",
              letterSpacing: "-0.02em",
              lineHeight: 1,
              margin: 0,
            }}
          >
            LUMEN
          </h1>
          <p
            style={{
              fontSize: 11,
              color: "rgba(255,255,255,0.28)",
              margin: 0,
              marginTop: 2,
            }}
          >
            {queue.length > 0
              ? `${queue.length} track${queue.length !== 1 ? "s" : ""}`
              : "No music"}
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {canInstall && (
            <button
              onClick={install}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                padding: "5px 12px",
                borderRadius: 99,
                fontSize: 11,
                cursor: "pointer",
                color: "rgba(255,255,255,0.50)",
                background: "transparent",
                border: "1px solid rgba(255,255,255,0.14)",
                transition: "background 0.15s",
              }}
              onMouseEnter={(e) =>
                ((e.currentTarget as HTMLElement).style.background =
                  "rgba(255,255,255,0.07)")
              }
              onMouseLeave={(e) =>
                ((e.currentTarget as HTMLElement).style.background =
                  "transparent")
              }
            >
              <Download size={11} />
              Install
            </button>
          )}
          <button
            onClick={() => setScannerOpen(true)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              padding: "5px 12px",
              borderRadius: 99,
              fontSize: 11,
              cursor: "pointer",
              color: "rgba(255,255,255,0.50)",
              background: "transparent",
              border: "1px solid rgba(255,255,255,0.14)",
              transition: "background 0.15s",
            }}
            onMouseEnter={(e) =>
              ((e.currentTarget as HTMLElement).style.background =
                "rgba(255,255,255,0.07)")
            }
            onMouseLeave={(e) =>
              ((e.currentTarget as HTMLElement).style.background =
                "transparent")
            }
          >
            <Plus size={11} />
            Add Music
          </button>
        </div>
      </header>

      {/* ── MAIN STAGE ──────────────────────────────────────────────────── */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center overflow-hidden">
        {restoring ? (
          <RestoringSkeleton />
        ) : queue.length === 0 ? (
          <EmptyState onOpen={() => setScannerOpen(true)} />
        ) : (
          <>
            {/* Desktop prev/next */}
            <div className="absolute inset-y-0 left-0 z-20 hidden md:flex items-center pl-4">
              <button
                onClick={prev}
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: "50%",
                  cursor: "pointer",
                  background: "rgba(0,0,0,0.30)",
                  border: "1px solid rgba(255,255,255,0.10)",
                  color: "rgba(255,255,255,0.50)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  transition: "background 0.15s, color 0.15s",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.background =
                    "rgba(0,0,0,0.55)";
                  (e.currentTarget as HTMLElement).style.color =
                    "rgba(255,255,255,0.90)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.background =
                    "rgba(0,0,0,0.30)";
                  (e.currentTarget as HTMLElement).style.color =
                    "rgba(255,255,255,0.50)";
                }}
              >
                <ChevronLeft size={18} />
              </button>
            </div>
            <div className="absolute inset-y-0 right-0 z-20 hidden md:flex items-center pr-4">
              <button
                onClick={next}
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: "50%",
                  cursor: "pointer",
                  background: "rgba(0,0,0,0.30)",
                  border: "1px solid rgba(255,255,255,0.10)",
                  color: "rgba(255,255,255,0.50)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  transition: "background 0.15s, color 0.15s",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.background =
                    "rgba(0,0,0,0.55)";
                  (e.currentTarget as HTMLElement).style.color =
                    "rgba(255,255,255,0.90)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.background =
                    "rgba(0,0,0,0.30)";
                  (e.currentTarget as HTMLElement).style.color =
                    "rgba(255,255,255,0.50)";
                }}
              >
                <ChevronRight size={18} />
              </button>
            </div>

            <CoverFlow />
          </>
        )}
      </main>

      {/* ── PLAYBACK PILL ────────────────────────────────────────────────── */}
      {(queue.length > 0 || restoring) && (
        <div
          className="relative z-10 flex-shrink-0 px-3"
          style={{ paddingBottom: "max(14px, env(safe-area-inset-bottom))" }}
        >
          <PlaybackBar
            onQueueOpen={() => setQueueOpen(true)}
            onScanOpen={() => setScannerOpen(true)}
            onPickFiles={openFilePicker}
          />
        </div>
      )}

      {/* ── OVERLAYS ─────────────────────────────────────────────────────── */}
      <DropOverlay isDragging={isDragging} />
      <QueuePanel open={queueOpen} onClose={() => setQueueOpen(false)} />
      <FolderScanner open={scannerOpen} onClose={() => setScannerOpen(false)} />
    </div>
  );
}

/* ── Empty state — monochrome ────────────────────────────────────────────── */
function EmptyState({ onOpen }: { onOpen: () => void }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 24,
        padding: "0 32px",
        textAlign: "center",
      }}
      className="animate-fade-slide-up"
    >
      <div style={{ position: "relative" }}>
        {/* Subtle white glow — no colour */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "50%",
            background:
              "radial-gradient(circle, rgba(255,255,255,0.06) 0%, transparent 70%)",
            filter: "blur(20px)",
            transform: "scale(1.5)",
          }}
        />
        <VinylSVG size={156} className="relative animate-float" />
      </div>

      <div>
        <h2
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 28,
            fontWeight: 700,
            color: "rgba(255,255,255,0.88)",
            margin: 0,
          }}
        >
          Music-Player, ReImagined
        </h2>
        <p
          style={{
            fontSize: 13,
            color: "rgba(255,255,255,0.35)",
            marginTop: 8,
            lineHeight: 1.6,
          }}
        >
          Free and open-source, built for those who enjoy music.{" "}
          <a
            href="https://github.com/praTeek271/lumen---music-player"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: "rgba(255,255,255,0.35)",
              textDecoration: "underline",
            }}
          >
            GitHub
          </a>
        </p>
      </div>

      <button
        onClick={onOpen}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 24px",
          borderRadius: 12,
          cursor: "pointer",
          background: "rgba(255,255,255,0.10)",
          border: "1px solid rgba(255,255,255,0.18)",
          color: "rgba(255,255,255,0.85)",
          fontSize: 13,
          fontWeight: 600,
          backdropFilter: "blur(12px)",
          transition: "background 0.15s, transform 0.1s",
        }}
        onMouseEnter={(e) =>
          (e.currentTarget.style.background = "rgba(255,255,255,0.16)")
        }
        onMouseLeave={(e) =>
          (e.currentTarget.style.background = "rgba(255,255,255,0.10)")
        }
        onMouseDown={(e) => (e.currentTarget.style.transform = "scale(0.97)")
        }
        onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")
        }
      >
        <Plus size={15} />
        Add Music
      </button>

      <p style={{ fontSize: 11, color: "rgba(255,255,255,0.18)" }}>
        or drag &amp; drop audio files anywhere
      </p>
    </div>
  );
}

export interface ScanResult {
  folderName: string;
  fileCount: number;
  files: File[];
  handles: FileSystemFileHandle[];
  isPlaylist?: boolean;
}

/** Parse an M3U/M3U8 playlist and return filenames in order. */
function parseM3U(text: string): string[] {
  const basenames: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    // Extract just the filename from any absolute/relative path
    const basename = line.split(/[\\/]/).pop() ?? '';
    if (basename) basenames.push(basename);
  }
  return basenames;
}
