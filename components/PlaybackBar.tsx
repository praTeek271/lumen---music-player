'use client';
// components/PlaybackBar.tsx
//
// Layout: 3 sections using CSS grid (left / center / right)
//   [control]  ←  left-aligned, gap 18px between buttons
//   [player]   ←  center, max-width 50vw, fixed to middle
//   [features] ←  right-aligned, gap 18px between buttons
//
// Key fix: the 3-dot menu is rendered via a React Portal (document.body),
// so it is NEVER clipped by overflow:hidden on any ancestor.
// It positions itself absolutely relative to the button using getBoundingClientRect.

import { useCallback, useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  SkipBack, SkipForward, Play, Pause,
  ListMusic, Volume2, VolumeX, Repeat, Repeat1,
} from 'lucide-react';
import { LuEllipsis, LuFolderSearch, LuMusic, LuTrash2 } from 'react-icons/lu';
import { usePlayer } from '@/lib/playerStore';
import { VinylSVG } from './VinylSVG';
import { formatTime } from '@/lib/metaParser';

function cap(str: string, max: number) {
  return str.length > max ? str.slice(0, max) + '…' : str;
}

interface PlaybackBarProps {
  onQueueOpen: () => void;
  onScanOpen:  () => void;
  onPickFiles: () => void;
}

export function PlaybackBar({ onQueueOpen, onScanOpen, onPickFiles }: PlaybackBarProps) {
  const { state, dispatch, toggle, next, prev, seek, clearAll } = usePlayer();
  const { queue, currentIndex, isPlaying, progress, currentTime, duration, volume, repeat } = state;

  const track     = queue[currentIndex];
  const nextTrack = queue[currentIndex + 1] ?? null;

  const progressRef  = useRef<HTMLDivElement>(null);
  const volTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dotsButtonRef = useRef<HTMLButtonElement>(null);

  const [volOpen,       setVolOpen]       = useState(false);
  const [queueTooltip,  setQueueTooltip]  = useState(false);
  const [dotsOpen,      setDotsOpen]      = useState(false);
  // Portal menu position — computed from button's bounding rect
  const [menuPos, setMenuPos] = useState({ bottom: 0, left: 0 });
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  /* ── Volume timer ─────────────────────────────────────────────── */
  const resetVolTimer = useCallback(() => {
    if (volTimerRef.current) clearTimeout(volTimerRef.current);
    volTimerRef.current = setTimeout(() => setVolOpen(false), 1500);
  }, []);
  const openVol = useCallback(() => { setVolOpen(true); resetVolTimer(); }, [resetVolTimer]);
  useEffect(() => () => { if (volTimerRef.current) clearTimeout(volTimerRef.current); }, []);

  /* ── Open dots menu: measure button position → portal ────────── */
  const openDotsMenu = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (dotsOpen) { setDotsOpen(false); return; }
    const rect = dotsButtonRef.current?.getBoundingClientRect();
    if (rect) {
      setMenuPos({
        // Position above the button; window.innerHeight - rect.top = distance from bottom
        bottom: window.innerHeight - rect.top + 8,
        left:   rect.left + rect.width / 2,
      });
    }
    setDotsOpen(true);
  }, [dotsOpen]);

  /* ── Close dots on outside click ─────────────────────────────── */
  useEffect(() => {
    if (!dotsOpen) return;
    const id = setTimeout(() => {
      window.addEventListener('pointerdown', () => setDotsOpen(false), { once: true });
    }, 10);
    return () => clearTimeout(id);
  }, [dotsOpen]);

  /* ── Seek ─────────────────────────────────────────────────────── */
  const onProgressPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const bar = progressRef.current;
    if (!bar) return;
    bar.setPointerCapture(e.pointerId);
    const update = (ev: PointerEvent) => {
      const r = bar.getBoundingClientRect();
      seek(Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)));
    };
    const up = () => {
      bar.removeEventListener('pointermove', update as EventListener);
      bar.removeEventListener('pointerup', up);
    };
    update(e.nativeEvent);
    bar.addEventListener('pointermove', update as EventListener);
    bar.addEventListener('pointerup', up);
  }, [seek]);

  /* ── Volume drag ──────────────────────────────────────────────── */
  const onVolPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const bar = e.currentTarget;
    bar.setPointerCapture(e.pointerId);
    const update = (ev: PointerEvent) => {
      const r = bar.getBoundingClientRect();
      dispatch({ type: 'SET_VOLUME', volume: Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) });
      resetVolTimer();
    };
    const up = () => {
      bar.removeEventListener('pointermove', update as EventListener);
      bar.removeEventListener('pointerup', up);
    };
    update(e.nativeEvent);
    bar.addEventListener('pointermove', update as EventListener);
    bar.addEventListener('pointerup', up);
  }, [dispatch, resetVolTimer]);

  if (!queue.length || !track) return null;

  /* ── Default thumbnail ────────────────────────────────────────── */
  const DefaultThumb = ({ size }: { size: number }) => (
    <div style={{
      width: '100%', height: '100%',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(135deg, #78350f 0%, #451a03 100%)',
    }}>
      <VinylSVG size={size} spinning={isPlaying} />
    </div>
  );

  /* ── Portal menu ──────────────────────────────────────────────── */
  const menuItems = [
    { icon: <LuFolderSearch size={14} />, label: 'Scan Folder', action: () => { setDotsOpen(false); onScanOpen(); } },
    { icon: <LuMusic        size={14} />, label: 'Add Files',   action: () => { setDotsOpen(false); onPickFiles(); } },
    { icon: <LuTrash2       size={14} />, label: 'Clear Queue', danger: true, action: () => { setDotsOpen(false); clearAll(); } },
  ];

  const portalMenu = mounted && dotsOpen ? createPortal(
    <div
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position:  'fixed',
        bottom:    menuPos.bottom,
        left:      menuPos.left,
        transform: 'translateX(-50%)',
        zIndex:    9999,
        minWidth:  168,
        background:     'rgba(16, 10, 32, 0.97)',
        backdropFilter: 'blur(40px) saturate(180%)',
        WebkitBackdropFilter: 'blur(40px) saturate(180%)',
        border:    '1px solid rgba(255,255,255,0.14)',
        borderRadius: 14,
        boxShadow: '0 -4px 24px rgba(0,0,0,0.4), 0 8px 40px rgba(0,0,0,0.6)',
        animation: 'menuPopUp 0.18s cubic-bezier(0.16,1,0.3,1) both',
        overflow:  'hidden',
      }}
    >
      {menuItems.map((item, idx) => (
        <button
          key={item.label}
          onClick={item.action}
          style={{
            display:       'flex',
            alignItems:    'center',
            gap:           10,
            width:         '100%',
            padding:       '11px 16px',
            background:    'transparent',
            border:        'none',
            borderBottom:  idx < menuItems.length - 1 ? '1px solid rgba(255,255,255,0.07)' : 'none',
            cursor:        'pointer',
            fontSize:      13,
            textAlign:     'left',
            color: item.danger ? 'rgba(252,165,165,0.92)' : 'rgba(255,255,255,0.82)',
            transition:    'background 0.15s ease',
            borderRadius:  0,
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.07)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
        >
          {item.icon}
          {item.label}
        </button>
      ))}
      {/* Downward-pointing caret */}
      <div style={{
        position:   'absolute',
        bottom:     -6,
        left:       '50%',
        transform:  'translateX(-50%) rotate(45deg)',
        width:      10, height: 10,
        background: 'rgba(16,10,32,0.97)',
        border:     '1px solid rgba(255,255,255,0.14)',
        borderTop:  'none', borderLeft: 'none',
      }} />
    </div>,
    document.body
  ) : null;

  return (
    <>
      {/* ══════════════════════════════════════════════════════════════
          OUTER PILL — 3-column CSS grid
          left (control) | center (player, max 50vw) | right (features)
      ══════════════════════════════════════════════════════════════ */}
      <div
        style={{
          display:     'grid',
          gridTemplateColumns: '1fr minmax(0, 50vw) 1fr',
          alignItems:  'center',
          margin:      '0 10px',
          gap:         12,
          padding:     '6px 12px',
          borderRadius: 30,
          background:   'rgba(255,255,255,0.18)',
          backdropFilter:       'blur(4px) saturate(200%)',
          WebkitBackdropFilter: 'blur(4px) saturate(200%)',
          border:    '1px solid rgba(255,255,255,0.28)',
          boxShadow: '0 4px 32px rgba(0,0,0,0.30), inset 0 1px 0 rgba(255,255,255,0.30)',
          backgroundImage: 'radial-gradient(ellipse 80% 60% at 50% 0%, rgba(255,255,255,0.20) 0%, transparent 75%)',
        }}
      >

        {/* ══════════════════════════════════════════════════════════
            SECTION 1 — CONTROLS  (left-aligned)
            Prev / Play-Pause / Next  with 18px gap
        ══════════════════════════════════════════════════════════ */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: `space-evenly` , gap: 8, paddingRight: 15 }}>
          
            <button
            onClick={prev}
            aria-label="Previous"
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'opacity 0.15s', opacity: 0.85 }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '0.85')}
          >
            <SkipBack size={18} color="white" fill="white" />
          </button>

          <button
            onClick={toggle}
            aria-label={isPlaying ? 'Pause' : 'Play'}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'opacity 0.15s', opacity: 0.95 }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '0.95')}
          >
            {isPlaying
              ? <Pause size={20} color="white" fill="white" />
              : <Play  size={20} color="white" fill="white" style={{ transform: 'translateX(1px)' }} />}
          </button>

          <button
            onClick={next}
            aria-label="Next"
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'opacity 0.15s', opacity: 0.85 }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '0.85')}
          >
            <SkipForward size={18} color="white" fill="white" />
          </button>
          
        </div>

        {/* ══════════════════════════════════════════════════════════
            SECTION 2 — NESTED MINI-PLAYER  (center, max 50vw)
            Flat bottom + flush progress bar as animated border
            overflow:visible on the wrapper so the portal can escape,
            but the inner bar itself still clips its contents properly.
        ══════════════════════════════════════════════════════════ */}
        <div style={{ position: 'relative', width: '100%' }}>
          {/* The visible bar */}
          <div
            style={{
              display:      'flex',
              alignItems:   'center',
              gap:          8,
              height:       60,
              paddingLeft:  10,
              paddingRight: 8,
              borderRadius: '10px 10px 0 0',
              background:   'rgba(0,0,0,0.22)',
              border:       '1px solid rgba(255,255,255,0.10)',
              borderBottom: 'none',
              overflow:     'hidden',  // clips thumb + text, NOT the portal menu
              position:     'relative',
            }}
          >
            {/* Thumbnail 28×28 */}
            <div style={{ flexShrink: 0, width: 28, height: 28, borderRadius: 7, overflow: 'hidden' }}>
              {track.coverUrl
                ? <img src={track.coverUrl} alt={track.title} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                : <DefaultThumb size={18} />}
            </div>

            {/* Title + Artist */}
            <div style={{ flex: 1, minWidth: 0, paddingBottom: 1 }}>
              <p style={{ margin: 0, fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,0.92)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.2 }}>
                {track.title}
              </p>
              <p style={{ margin: 0, fontSize: 9, color: 'rgba(255,255,255,0.50)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.3 }}>
                {track.artist}
              </p>
            </div>

            {/* Time */}
            <p style={{ margin: 0, flexShrink: 0, fontSize: 8, color: 'rgba(255,255,255,0.30)', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
              {formatTime(currentTime)}/{formatTime(duration)}
            </p>

            {/* 3-dot button — opens portal menu above */}
            <button
              ref={dotsButtonRef}
              onClick={openDotsMenu}
              aria-label="Options"
              style={{
                flexShrink: 0,
                background: 'none', border: 'none', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 22, height: 22, padding: 0,
                color: 'rgba(255,255,255,0.55)',
                transition: 'color 0.15s',
                borderRadius: 4,
              }}
              onMouseEnter={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.9)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.55)')}
            >
              <LuEllipsis size={13} />
            </button>

            {/* Progress bar — flush bottom edge */}
            <div
              ref={progressRef}
              onPointerDown={onProgressPointerDown}
              title={`${formatTime(currentTime)} / ${formatTime(duration)}`}
              style={{
                position: 'absolute', inset: 'auto 0 0 0',
                height:   2, cursor: 'pointer',
              }}
            >
              {/* Track */}
              <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.12)' }} />
              {/* Fill */}
              <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: `${progress * 100}%`, background: 'rgba(255,255,255,0.80)', transition: 'width 0.25s linear' }} />
            </div>
          </div>
        </div>

        {/* ══════════════════════════════════════════════════════════
            SECTION 3 — FEATURES  (right-aligned)
            Queue tooltip | expanding volume  with 18px gap
        ══════════════════════════════════════════════════════════ */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-evenly', gap: 8 , paddingLeft: 15 }}>

          {/* Repeat button — cycles: none → all → one */}
          <button
            onClick={() => dispatch({ type: 'CYCLE_REPEAT' })}
            aria-label={`Repeat: ${repeat}`}
            title={repeat === 'none' ? 'Repeat off' : repeat === 'all' ? 'Repeat all' : 'Repeat one'}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: 4, position: 'relative',
              opacity: repeat === 'none' ? 0.45 : 1,
              transition: 'opacity 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
            onMouseLeave={e => (e.currentTarget.style.opacity = repeat === 'none' ? '0.45' : '1')}
          >
            {repeat === 'one'
              ? <Repeat1 size={17} color="white" />
              : <Repeat  size={17} color={repeat === 'all' ? 'white' : 'rgba(255,255,255,0.75)'} />}
            {/* Active dot indicator */}
            {repeat !== 'none' && (
              <span style={{
                position: 'absolute', bottom: 0, left: '50%',
                transform: 'translateX(-50%)',
                width: 4, height: 4, borderRadius: '50%',
                background: 'white',
              }} />
            )}
          </button>

          {/* Queue button + Next-Up tooltip */}
          <div
            style={{ position: 'relative' }}
            onMouseEnter={() => setQueueTooltip(true)}
            onMouseLeave={() => setQueueTooltip(false)}
          >
            <button
              onClick={onQueueOpen}
              aria-label="Queue"
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: 4,
                opacity:       volOpen ? 0 : 0.75,
                pointerEvents: volOpen ? 'none' : 'auto',
                transform:     volOpen ? 'scale(0.6)' : 'scale(1)',
                transition:    'opacity 0.25s, transform 0.25s',
              }}
              onMouseEnter={e => { if (!volOpen) (e.currentTarget as HTMLElement).style.opacity = '1'; }}
              onMouseLeave={e => { if (!volOpen) (e.currentTarget as HTMLElement).style.opacity = '0.75'; }}
            >
              <ListMusic size={17} color="white" />
            </button>

            {/* Next-Up tooltip */}
            {queueTooltip && nextTrack && !volOpen && (
              <div
                style={{
                  position:   'absolute',
                  bottom:     'calc(100% + 10px)',
                  right:      0,
                  width:      192,
                  background: 'rgba(16,10,32,0.97)',
                  backdropFilter: 'blur(32px)',
                  WebkitBackdropFilter: 'blur(32px)',
                  border:     '1px solid rgba(255,255,255,0.13)',
                  borderRadius: 14,
                  boxShadow:  '0 -4px 24px rgba(0,0,0,0.35), 0 16px 48px rgba(0,0,0,0.55)',
                  animation:  'menuPopUp 0.18s ease both',
                  pointerEvents: 'none',
                  zIndex:     200,
                  overflow:   'hidden',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px' }}>
                  <div style={{ flexShrink: 0, width: 32, height: 32, borderRadius: 8, overflow: 'hidden' }}>
                    {nextTrack.coverUrl
                      ? <img src={nextTrack.coverUrl} alt={nextTrack.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #78350f, #451a03)' }}><VinylSVG size={22} /></div>}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ margin: '0 0 2px', fontSize: 9, color: 'rgba(255,255,255,0.30)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Next Up</p>
                    <p style={{ margin: 0, fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.90)', whiteSpace: 'nowrap' }}>{cap(nextTrack.title, 15)}</p>
                    <p style={{ margin: 0, fontSize: 10, color: 'rgba(255,255,255,0.45)', whiteSpace: 'nowrap' }}>{cap(nextTrack.artist, 15)}</p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Volume — icon expands to slider on hover */}
          <div
            style={{
              display: 'flex', alignItems: 'center',
              width:      volOpen ? 120 : 28,
              overflow:   'hidden',
              transition: 'width 0.35s cubic-bezier(0.16,1,0.3,1)',
            }}
            onMouseEnter={openVol}
            onMouseMove={resetVolTimer}
          >
            <button
              onClick={() => { if (!volOpen) openVol(); else { dispatch({ type: 'SET_VOLUME', volume: volume > 0 ? 0 : 0.8 }); resetVolTimer(); } }}
              aria-label="Volume"
              style={{
                flexShrink: 0,
                background: 'none', border: 'none', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: 4, opacity: 0.75, transition: 'opacity 0.15s',
              }}
              onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
              onMouseLeave={e => (e.currentTarget.style.opacity = '0.75')}
            >
              {volume === 0
                ? <VolumeX size={17} color="white" />
                : <Volume2 size={17} color="white" />}
            </button>

            {/* Slider */}
            <div style={{ flex: 1, minWidth: 0, paddingRight: 4, opacity: volOpen ? 1 : 0, transition: 'opacity 0.2s ease' }}>
              <div
                style={{ position: 'relative', height: 3, background: 'rgba(255,255,255,0.20)', borderRadius: 99, cursor: 'pointer' }}
                onPointerDown={onVolPointerDown}
                className="group"
              >
                <div style={{ position: 'absolute', inset: 0, left: 0, right: `${(1 - volume) * 100}%`, background: 'rgba(255,255,255,0.88)', borderRadius: 99 }} />
                <div style={{
                  position: 'absolute', top: '50%', transform: 'translateY(-50%)',
                  left: `calc(${volume * 100}% - 5px)`,
                  width: 10, height: 10, borderRadius: '50%',
                  background: 'white', boxShadow: '0 0 4px rgba(0,0,0,0.4)',
                }} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Portal menu rendered into document.body — never clipped */}
      {portalMenu}

      <style>{`
        @keyframes menuPopUp {
          from { opacity: 0; transform: translateX(-50%) translateY(6px) scale(0.96); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0)   scale(1);    }
        }
      `}</style>
    </>
  );
}
