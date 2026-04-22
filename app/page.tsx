"use client";
// app/page.tsx — LUMEN Immersive Player
//
// Background zones:
//  • Behind CoverFlow  → album-art dominant-colour radial gradient (cinematic)
//  • Queue panel       → deep black monochrome glass (clean)
//  • Empty / top bar   → pure black monochrome

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Plus,
  Download,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Maximize2,
  Minimize2,
} from "lucide-react";

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
import { BackgroundPaths } from "@/components/ui/background-paths";

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

/* ── Detect mobile landscape: width > height AND height < 600 px ─────────── */
function useIsLandscapeMobile() {
  const [isLandscape, setIsLandscape] = useState(false);
  useEffect(() => {
    const check = () =>
      setIsLandscape(
        window.innerWidth > window.innerHeight && window.innerHeight < 600,
      );
    check();
    window.addEventListener("resize", check);
    window.addEventListener("orientationchange", check);
    return () => {
      window.removeEventListener("resize", check);
      window.removeEventListener("orientationchange", check);
    };
  }, []);
  return isLandscape;
}

/* ── Fullscreen intent overlay ───────────────────────────────────────────── */
// Shown for 3 s when the auto-hide timer wants to enter fullscreen.
// Tap → confirm (calls requestFullscreen inside a native touchend = valid gesture).
// Any swipe or timeout → cancel.
function FsPromptOverlay({
  onConfirm,
  onCancel,
}: {
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const divRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = divRef.current;
    if (!el) return;
    let sx = 0,
      sy = 0;
    const onStart = (e: TouchEvent) => {
      sx = e.touches[0].clientX;
      sy = e.touches[0].clientY;
    };
    const onEnd = (e: TouchEvent) => {
      const dx = Math.abs(e.changedTouches[0].clientX - sx);
      const dy = Math.abs(e.changedTouches[0].clientY - sy);
      if (dx > 20 || dy > 20) {
        onCancel(); // swipe → dismiss without fullscreen
      } else {
        onConfirm(); // tap inside touchend handler = valid gesture context
      }
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchend", onEnd);
    const timer = setTimeout(onCancel, 3000);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchend", onEnd);
      clearTimeout(timer);
    };
  }, [onConfirm, onCancel]);

  return (
    <div
      ref={divRef}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9990,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.50)",
        WebkitBackdropFilter: "blur(3px)",
        backdropFilter: "blur(3px)",
      }}
      aria-label="Tap to enter fullscreen"
    >
      {/* Expanding ripple rings */}
      <div
        style={{
          position: "relative",
          width: 72,
          height: 72,
          marginBottom: 22,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              width: "100%",
              height: "100%",
              borderRadius: "50%",
              border: "1.5px solid rgba(255,255,255,0.40)",
              animation: `fsRipple 2s ease-out ${i * 0.65}s infinite`,
            }}
          />
        ))}
        <Maximize2
          size={22}
          style={{ color: "rgba(255,255,255,0.82)", position: "relative" }}
        />
      </div>

      <p
        style={{
          color: "rgba(255,255,255,0.88)",
          fontSize: 15,
          fontWeight: 600,
          margin: 0,
          letterSpacing: "0.01em",
        }}
      >
        Tap for fullscreen
      </p>
      <p
        style={{ color: "rgba(255,255,255,0.36)", fontSize: 12, marginTop: 6 }}
      >
        Swipe to dismiss
      </p>
    </div>
  );
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

  // ── Landscape mobile: bar auto-hide / swipe-to-reveal ─────────────────
  const isLandscapeMobile = useIsLandscapeMobile();
  const [barVisible, setBarVisible] = useState(true);
  const barAutoHideRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const barInactivityRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const swipeTouchRef = useRef<{ x: number; y: number } | null>(null);
  const [showFsOverlay, setShowFsOverlay] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

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

  // Auto-hide bar 1.5 s after entering landscape; restore immediately on exit
  useEffect(() => {
    if (barAutoHideRef.current) clearTimeout(barAutoHideRef.current);
    if (barInactivityRef.current) clearTimeout(barInactivityRef.current);
    if (isLandscapeMobile) {
      setBarVisible(true);
      // Step 1: hide bar after 1.5 s
      // Step 2: 3 s after bar hides, arm fullscreen (only when music is playing)
      barAutoHideRef.current = setTimeout(() => {
        setBarVisible(false);
        if (queue.length > 0) {
          barInactivityRef.current = setTimeout(() => {
            if (
              !document.fullscreenElement &&
              !(document as any).webkitFullscreenElement
            )
              setShowFsOverlay(true);
          }, 3000);
        }
      }, 1500);

      return () => {
        if (barAutoHideRef.current) clearTimeout(barAutoHideRef.current);
        if (barInactivityRef.current) clearTimeout(barInactivityRef.current);
        setShowFsOverlay(false);
      };
    } else {
      // Exit fullscreen when leaving landscape
      try {
        const isFs =
          document.fullscreenElement ||
          (document as any).webkitFullscreenElement;
        if (isFs) {
          if (document.exitFullscreen) document.exitFullscreen();
          else if ((document as any).webkitExitFullscreen)
            (document as any).webkitExitFullscreen();
        }
      } catch {
        /* ignore */
      }
      setShowFsOverlay(false);
      setBarVisible(true);
    }
    return () => {
      if (barAutoHideRef.current) clearTimeout(barAutoHideRef.current);
    };
  }, [isLandscapeMobile, queue.length]);

  // Restart 3 s inactivity timer whenever user touches any button on the bar
  const resetBarInactivity = useCallback(() => {
    if (!isLandscapeMobile) return;
    if (barInactivityRef.current) clearTimeout(barInactivityRef.current);
    barInactivityRef.current = setTimeout(() => {
      setBarVisible(false);
      // Arm fullscreen 3 s after inactivity hide too (only with music)
      if (queue.length > 0) {
        setTimeout(() => {
          if (
            !document.fullscreenElement &&
            !(document as any).webkitFullscreenElement
          )
            setShowFsOverlay(true);
        }, 3000);
      }
    }, 3000);
  }, [isLandscapeMobile, queue.length]);

  // Sync isFullscreen state with the actual Fullscreen API
  useEffect(() => {
    const onChange = () =>
      setIsFullscreen(
        !!(
          document.fullscreenElement ||
          (document as any).webkitFullscreenElement
        ),
      );
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
    };
  }, []);

  // Called by FsPromptOverlay.onConfirm — native touchend on the overlay element
  // is the valid gesture context that makes requestFullscreen() work.
  const triggerFullscreen = useCallback(() => {
    setShowFsOverlay(false);
    try {
      const el = document.documentElement as any;
      const isFs =
        document.fullscreenElement || (document as any).webkitFullscreenElement;
      if (!isFs) {
        if (el.requestFullscreen) el.requestFullscreen();
        else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
      }
    } catch {
      /* no-op */
    }
  }, []);

  // Fallback manual toggle via the header button
  const toggleFullscreen = useCallback(() => {
    try {
      const isFs =
        document.fullscreenElement || (document as any).webkitFullscreenElement;
      if (isFs) {
        if (document.exitFullscreen) document.exitFullscreen();
        else if ((document as any).webkitExitFullscreen)
          (document as any).webkitExitFullscreen();
      } else {
        const el = document.documentElement as any;
        if (el.requestFullscreen) el.requestFullscreen();
        else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
      }
    } catch {
      /* no-op */
    }
  }, []);

  // Track touch start position for swipe-up detection (page-level)
  const onPageTouchStart = useCallback((e: React.TouchEvent) => {
    swipeTouchRef.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
    };
  }, []);

  // Swipe up anywhere → reveal bar (landscape + bar hidden only)
  const onPageTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (!swipeTouchRef.current) return;
      const dx = e.changedTouches[0].clientX - swipeTouchRef.current.x;
      const dy = e.changedTouches[0].clientY - swipeTouchRef.current.y;
      swipeTouchRef.current = null;
      if (
        isLandscapeMobile &&
        !barVisible &&
        dy < -40 &&
        Math.abs(dy) > Math.abs(dx)
      ) {
        setBarVisible(true);
        resetBarInactivity();
      }
    },
    [isLandscapeMobile, barVisible, resetBarInactivity],
  );

  return (
    <div
      className="relative w-full h-full flex flex-col overflow-hidden"
      style={{ background: "#0a0a0a" }}
      onTouchStart={onPageTouchStart}
      onTouchEnd={onPageTouchEnd}
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

      {/* ── TOP BAR — slides up out of view in landscape when bar hidden ── */}
      <header
        className="relative z-10 flex items-center justify-between px-5 pt-5 pb-0 safe-top flex-shrink-0"
        style={{
          transition: "transform 0.45s cubic-bezier(0.16, 1, 0.3, 1)",
          transform:
            isLandscapeMobile && !barVisible
              ? "translateY(-110%)"
              : "translateY(0)",
        }}
      >
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

          {/* Fullscreen toggle — always-visible fallback */}
          <button
            onClick={toggleFullscreen}
            title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            style={{
              width: 28,
              height: 28,
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
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
            {isFullscreen ? <Minimize2 size={11} /> : <Maximize2 size={11} />}
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
      {/* In landscape-mobile: fixed at bottom, slides out; portrait: normal flow */}
      {(queue.length > 0 || restoring) && (
        <div
          className="z-20 px-3"
          style={{
            ...(isLandscapeMobile
              ? { position: "fixed", bottom: 0, left: 0, right: 0 }
              : { position: "relative", flexShrink: 0 }),
            paddingBottom: "max(14px, env(safe-area-inset-bottom))",
            transition: "transform 0.45s cubic-bezier(0.16, 1, 0.3, 1)",
            transform:
              isLandscapeMobile && !barVisible
                ? "translateY(110%)"
                : "translateY(0)",
          }}
          onPointerDown={resetBarInactivity}
        >
          <PlaybackBar
            onQueueOpen={() => setQueueOpen(true)}
            onScanOpen={() => setScannerOpen(true)}
            onPickFiles={openFilePicker}
          />
        </div>
      )}

      {/* ── Swipe-up hint shown when bar is hidden in landscape ───────────── */}
      {isLandscapeMobile && !barVisible && (queue.length > 0 || restoring) && (
        <div
          className="fixed bottom-3 left-1/2 z-10 pointer-events-none"
          style={{ transform: "translateX(-50%)" }}
        >
          <ChevronUp
            size={18}
            className="animate-bounce"
            style={{ color: "rgba(255,255,255,0.30)" }}
          />
        </div>
      )}

      {/* ── Fullscreen prompt overlay — only when not already in fullscreen ── */}
      {showFsOverlay && !isFullscreen && (
        <FsPromptOverlay
          onConfirm={triggerFullscreen}
          onCancel={() => setShowFsOverlay(false)}
        />
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
    // absolute inset-0 so the component actually fills <main> and
    // BackgroundPaths' absolute inset-0 has a real bounding box to fill
    <div
      className="absolute inset-0 flex flex-col items-center justify-center animate-fade-slide-up"
      style={{ padding: "0 32px", textAlign: "center" }}
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
          background: "rgba(255, 255, 255, 0.5)",
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
        onMouseDown={(e) => (e.currentTarget.style.transform = "scale(0.97)")}
        onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
      >
        <Plus size={15} />
        Add Music
      </button>

      <p style={{ fontSize: 11, color: "rgba(255,255,255,0.18)" }}>
        or drag &amp; drop audio files anywhere
      </p>

      {/* Animated flowing paths — only visible when queue is empty */}
      <BackgroundPaths />
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
    if (!line || line.startsWith("#")) continue;
    // Extract just the filename from any absolute/relative path
    const basename = line.split(/[\\/]/).pop() ?? "";
    if (basename) basenames.push(basename);
  }
  return basenames;
}
