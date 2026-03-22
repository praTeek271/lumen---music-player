'use client';
// components/RestoringSkeleton.tsx
// A single 3D card shown while the player is recovering the queue after a page reload.
// Matches the exact card geometry from CoverFlow (same glass shell, 15px frame, 1:1 art area).
// The art area and text lines pulse with a shimmer animation.

const CARD_W   = 280;
const CARD_H   = 360;
const FRAME    = 15;
const ART_SIZE = CARD_W - FRAME * 2;   // 250px

export function RestoringSkeleton() {
  return (
    <div
      className="relative flex items-center justify-center select-none"
      style={{
        height:            `clamp(320px, 48vw, ${CARD_H + 60}px)`,
        perspective:       '1200px',
        perspectiveOrigin: '50% 46%',
      }}
    >
      {/* Floating card — same transform as the active (center) card in CoverFlow */}
      <div
        style={{
          width:     CARD_W,
          height:    CARD_H,
          transform: 'translateZ(80px) scale(1)',
          animation: 'skeletonFloat 3s ease-in-out infinite',
        }}
      >
        {/* ── Gray frosted glass shell — identical to CoverFlow card ── */}
        <div
          className="relative w-full h-full rounded-3xl flex flex-col overflow-hidden"
          style={{
            background:           'rgba(80, 80, 80, 0.35)',
            backdropFilter:       'blur(40px) saturate(140%)',
            WebkitBackdropFilter: 'blur(40px) saturate(140%)',
            border:               '1px solid rgba(255,255,255,0.22)',
            boxShadow:            '0 32px 80px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.08)',
          }}
        >
          {/* ── Album art placeholder — 15px framed, 1:1 square ── */}
          <div
            style={{
              margin:       `${FRAME}px ${FRAME}px 0`,
              width:        ART_SIZE,
              height:       ART_SIZE,
              borderRadius: 14,
              overflow:     'hidden',
              flexShrink:   0,
              position:     'relative',
            }}
          >
            {/* Shimmer base */}
            <div
              className="absolute inset-0"
              style={{ background: 'rgba(255,255,255,0.06)' }}
            />
            {/* Shimmer sweep */}
            <div
              className="absolute inset-0"
              style={{ animation: 'shimmerSweep 1.8s ease-in-out infinite' }}
            />

            {/* Centered vinyl outline icon */}
            <div className="absolute inset-0 flex items-center justify-center">
              <SkeletonVinyl size={ART_SIZE * 0.52} />
            </div>
          </div>

          {/* ── Text lines below frame ── */}
          <div
            style={{
              flex:        1,
              display:     'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              paddingLeft:  FRAME + 2,
              paddingRight: FRAME + 2,
              paddingTop:   10,
              gap:          8,
            }}
          >
            {/* Title line */}
            <div
              style={{
                height:       12,
                width:        '72%',
                borderRadius: 6,
                background:   'rgba(255,255,255,0.10)',
                animation:    'shimmerSweep 1.8s ease-in-out infinite 0.1s',
                position:     'relative',
                overflow:     'hidden',
              }}
            >
              <div className="absolute inset-0" style={{ animation: 'shimmerSweep 1.8s ease-in-out infinite' }} />
            </div>
            {/* Artist line */}
            <div
              style={{
                height:       9,
                width:        '48%',
                borderRadius: 5,
                background:   'rgba(255,255,255,0.07)',
                position:     'relative',
                overflow:     'hidden',
              }}
            >
              <div className="absolute inset-0" style={{ animation: 'shimmerSweep 1.8s ease-in-out infinite 0.25s' }} />
            </div>
          </div>
        </div>
      </div>

      {/* Status text below card */}
      <div
        className="absolute text-center pointer-events-none"
        style={{ bottom: 0 }}
      >
        <p
          style={{
            fontSize:      12,
            color:         'rgba(255,255,255,0.35)',
            letterSpacing: '0.06em',
            animation:     'breathe 2s ease-in-out infinite',
          }}
        >
          Restoring your queue…
        </p>
      </div>

      <style>{`
        @keyframes shimmerSweep {
          0%   { background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.10) 50%, transparent 100%); background-size: 200% 100%; background-position: -100% 0; }
          100% { background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.10) 50%, transparent 100%); background-size: 200% 100%; background-position: 100% 0; }
        }
        @keyframes skeletonFloat {
          0%, 100% { transform: translateZ(80px) translateY(0px); }
          50%       { transform: translateZ(80px) translateY(-8px); }
        }
        @keyframes breathe {
          0%, 100% { opacity: 0.4; }
          50%       { opacity: 0.8; }
        }
      `}</style>
    </div>
  );
}

/** Minimal vinyl outline SVG — matches the VinylSVG shape but as a faint outline only */
function SkeletonVinyl({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <circle cx="50" cy="50" r="46" fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth="1.5" />
      <circle cx="50" cy="50" r="36" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="1" />
      <circle cx="50" cy="50" r="26" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="1" />
      <circle cx="50" cy="50" r="16" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
      <circle cx="50" cy="50" r="4"  fill="rgba(255,255,255,0.12)" />
    </svg>
  );
}
