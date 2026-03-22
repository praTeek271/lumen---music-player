'use client';
// app/page.tsx — Immersive Player
//
// Background design:
//  - Dominant RGB extracted via canvas 16×16 downsample
//  - Injected as CSS var(--dominant-rgb) into a radial gradient
//  - Glowing light from center → deep #080808 at edges
//  - 1-second CSS transition between track changes (fluid breathing effect)

import { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, Download, ChevronLeft, ChevronRight } from 'lucide-react';

import { usePlayer }     from '@/lib/playerStore';
import { useDragDrop }   from '@/hooks/useDragDrop';

import { CoverFlow }          from '@/components/CoverFlow';
import { PlaybackBar }        from '@/components/PlaybackBar';
import { QueuePanel }         from '@/components/QueuePanel';
import { FolderScanner }      from '@/components/FolderScanner';
import { DropOverlay }        from '@/components/DropOverlay';
import { VinylSVG }           from '@/components/VinylSVG';
import { RestoringSkeleton }  from '@/components/RestoringSkeleton';

/* ── Canvas color extractor → dominant RGB tuple ─────────────────────────── */
function extractRGB(src: string): Promise<[number, number, number]> {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = c.height = 16;
        const ctx = c.getContext('2d');
        if (!ctx) { resolve([160, 100, 40]); return; }
        ctx.drawImage(img, 0, 0, 16, 16);
        const d = ctx.getImageData(0, 0, 16, 16).data;
        let r = 0, g = 0, b = 0;
        for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
        const n = d.length / 4;
        // Boost saturation so the glow reads clearly
        const boost = 1.45;
        resolve([
          Math.min(255, Math.round((r / n) * boost)),
          Math.min(255, Math.round((g / n) * boost)),
          Math.min(255, Math.round((b / n) * boost)),
        ]);
      };
      img.onerror = () => resolve([160, 100, 40]);
      img.src = src;
    } catch {
      resolve([160, 100, 40]);
    }
  });
}

/* ── PWA install prompt ───────────────────────────────────────────────────── */
function useInstallPrompt() {
  const [prompt, setPrompt] = useState<Event | null>(null);
  useEffect(() => {
    const h = (e: Event) => { e.preventDefault(); setPrompt(e); };
    window.addEventListener('beforeinstallprompt', h);
    return () => window.removeEventListener('beforeinstallprompt', h);
  }, []);
  const install = useCallback(async () => {
    if (!prompt) return;
    (prompt as any).prompt();
    await (prompt as any).userChoice;
    setPrompt(null);
  }, [prompt]);
  return { canInstall: !!prompt, install };
}

/* ════════════════════════════════════════════════════════════════════════════ */

export default function ImmersivePlayer() {
  const { state, next, prev, toggle, addFiles } = usePlayer();
  const { queue, currentIndex, isPlaying, restoring } = state;

  const { isDragging }       = useDragDrop();
  const { canInstall, install } = useInstallPrompt();

  const [queueOpen,   setQueueOpen]   = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);

  // Native file picker — used by PlaybackBar's 3-dot "Add Files" option
  const openFilePicker = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = 'audio/*,.mp3,.flac,.ogg,.wav,.aac,.m4a,.opus,.wma,.aiff';
    input.onchange = (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (files?.length) addFiles(files);
    };
    input.click();
  }, [addFiles]);

  /* Dominant RGB stored as "r,g,b" for CSS var injection */
  const [dominantRGB, setDominantRGB] = useState('140, 90, 30');
  const bgRef = useRef<HTMLDivElement>(null);

  const currentTrack = queue[currentIndex];

  /* ── Extract dominant color → inject into CSS custom property ────── */
  useEffect(() => {
    if (!currentTrack?.coverUrl) {
      setDominantRGB('140, 90, 30');
      return;
    }
    extractRGB(currentTrack.coverUrl).then(([r, g, b]) => {
      setDominantRGB(`${r}, ${g}, ${b}`);
    });
  }, [currentTrack?.coverUrl, currentTrack?.id]);

  /* ── Keyboard shortcuts ───────────────────────────────────────────── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;
      if (e.code === 'ArrowRight') { e.preventDefault(); next(); }
      if (e.code === 'ArrowLeft')  { e.preventDefault(); prev(); }
      if (e.code === 'Space')      { e.preventDefault(); toggle(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, prev, toggle]);

  return (
    /*
      The CSS var --dominant-rgb drives the radial background glow.
      The 1s transition on background is handled by the inner AmbientBg div.
    */
    <div
      ref={bgRef}
      className="relative w-full h-full flex flex-col overflow-hidden"
      style={
        { '--dominant-rgb': dominantRGB } as React.CSSProperties
      }
    >
      {/* ── AMBIENT BACKGROUND ─────────────────────────────────────────── */}
      <AmbientBg dominantRGB={dominantRGB} isPlaying={isPlaying} />

      {/* ── TOP BAR ────────────────────────────────────────────────────── */}
      <header className="relative z-10 flex items-center justify-between px-5 pt-5 pb-0 safe-top flex-shrink-0">
        <div>
          <h1
            className="text-white/90 text-lg font-semibold tracking-tight"
            style={{ fontFamily: 'var(--font-display)', textShadow: '0 1px 12px rgba(0,0,0,0.5)' }}
          >
            LUMEN
          </h1>
          <p className="text-white/30 text-xs">
            {queue.length > 0
              ? `${queue.length} track${queue.length !== 1 ? 's' : ''}`
              : 'No music'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {canInstall && (
            <button
              onClick={install}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs border transition-all hover:bg-white/8"
              style={{ color: 'rgba(255,255,255,0.55)', borderColor: 'rgba(255,255,255,0.14)' }}
            >
              <Download size={11} />
              Install
            </button>
          )}
          <button
            onClick={() => setScannerOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs border transition-all hover:bg-white/8 active:scale-95"
            style={{ color: 'rgba(255,255,255,0.55)', borderColor: 'rgba(255,255,255,0.14)' }}
          >
            <Plus size={12} />
            Add Music
          </button>
        </div>
      </header>

      {/* ── MAIN STAGE ─────────────────────────────────────────────────── */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center overflow-hidden">
        {restoring ? (
          <RestoringSkeleton />
        ) : queue.length === 0 ? (
          <EmptyState onOpen={() => setScannerOpen(true)} />
        ) : (
          <>
            <div className="absolute inset-y-0 left-0 z-20 hidden md:flex items-center pl-4">
              <button onClick={prev} className="w-10 h-10 flex items-center justify-center rounded-full transition-all hover:bg-white/10 active:scale-90" style={{ background: 'rgba(0,0,0,0.22)', backdropFilter: 'blur(8px)', color: 'rgba(255,255,255,0.55)' }}>
                <ChevronLeft size={20} />
              </button>
            </div>
            <div className="absolute inset-y-0 right-0 z-20 hidden md:flex items-center pr-4">
              <button onClick={next} className="w-10 h-10 flex items-center justify-center rounded-full transition-all hover:bg-white/10 active:scale-90" style={{ background: 'rgba(0,0,0,0.22)', backdropFilter: 'blur(8px)', color: 'rgba(255,255,255,0.55)' }}>
                <ChevronRight size={20} />
              </button>
            </div>
            <CoverFlow />
          </>
        )}
      </main>

      {/* ── PLAYBACK PILL ──────────────────────────────────────────────── */}
      {(queue.length > 0 || restoring) && (
        <div
          className="relative z-10 flex-shrink-0 px-3"
          style={{ paddingBottom: 'max(14px, env(safe-area-inset-bottom))' }}
        >
          <PlaybackBar
            onQueueOpen={() => setQueueOpen(true)}
            onScanOpen={() => setScannerOpen(true)}
            onPickFiles={openFilePicker}
          />
        </div>
      )}

      {/* ── OVERLAYS ────────────────────────────────────────────────────── */}
      <DropOverlay  isDragging={isDragging} />
      <QueuePanel   open={queueOpen}    onClose={() => setQueueOpen(false)} />
      <FolderScanner open={scannerOpen} onClose={() => setScannerOpen(false)} />
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   AMBIENT BACKGROUND
   Radial glow from center using dominant album color → deep #080808 edges.
   CSS transition: 1s ease (fluid breathing between tracks)
────────────────────────────────────────────────────────────────────────── */
function AmbientBg({ dominantRGB, isPlaying }: { dominantRGB: string; isPlaying: boolean }) {
  // Glow intensity: slightly stronger when playing
  const glowOpacity = isPlaying ? 0.80 : 0.52;

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden>

      {/* Base black */}
      <div className="absolute inset-0" style={{ background: '#080808' }} />

      {/* Radial color glow from center — transitions over 1s */}
      <div
        className="absolute inset-0"
        style={{
          // rgba(var,0.8) fades to transparent so the black base shows at edges
          background: `radial-gradient(ellipse 75% 65% at 50% 42%,
            rgba(${dominantRGB}, ${glowOpacity}) 0%,
            rgba(${dominantRGB}, ${glowOpacity * 0.45}) 38%,
            rgba(${dominantRGB}, 0.08) 62%,
            transparent 80%)`,
          transition: 'background 1s ease',
        }}
      />

      {/* Subtle second layer — slightly offset for depth */}
      <div
        className="absolute inset-0"
        style={{
          background: `radial-gradient(ellipse 55% 50% at 52% 55%,
            rgba(${dominantRGB}, ${glowOpacity * 0.3}) 0%,
            transparent 65%)`,
          transition: 'background 1s ease',
          mixBlendMode: 'screen',
        }}
      />

      {/* Dark vignette — keeps edges and text readable */}
      <div
        className="absolute inset-0"
        style={{
          background: 'radial-gradient(ellipse 100% 100% at 50% 50%, transparent 30%, rgba(0,0,0,0.68) 100%)',
        }}
      />

      {/* Bottom darkening for pill bar legibility */}
      <div
        className="absolute inset-x-0 bottom-0"
        style={{
          height: '30%',
          background: 'linear-gradient(to top, rgba(0,0,0,0.78) 0%, transparent 100%)',
        }}
      />

      {/* Top fade */}
      <div
        className="absolute inset-x-0 top-0"
        style={{
          height: '15%',
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.45) 0%, transparent 100%)',
        }}
      />
    </div>
  );
}

/* ── Empty state ─────────────────────────────────────────────────────────── */
function EmptyState({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="flex flex-col items-center gap-7 px-8 text-center animate-fade-slide-up">
      <div className="relative">
        {/* Glow behind vinyl */}
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background: 'radial-gradient(circle, rgba(160,100,40,0.5) 0%, transparent 70%)',
            filter: 'blur(28px)',
            transform: 'scale(1.4)',
          }}
        />
        <VinylSVG size={164} className="relative animate-float" />
      </div>

      <div>
        <h2
          className="text-white text-3xl font-bold tracking-tight"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Your Stage Awaits
        </h2>
        <p className="text-white/38 text-sm mt-2 leading-relaxed max-w-xs">
          Drop audio files here, scan a music folder, or pick individual tracks to begin.
        </p>
      </div>

      <button
        onClick={onOpen}
        className="flex items-center gap-2 px-7 py-3.5 rounded-2xl text-white font-semibold text-sm transition-all active:scale-95 hover:scale-105"
        style={{
          background:     'rgba(255,255,255,0.13)',
          backdropFilter: 'blur(20px)',
          border:         '1px solid rgba(255,255,255,0.20)',
          boxShadow:      '0 8px 32px rgba(0,0,0,0.35)',
        }}
      >
        <Plus size={16} />
        Add Music
      </button>

      <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.20)' }}>
        or drag &amp; drop audio files anywhere on this page
      </p>
    </div>
  );
}
