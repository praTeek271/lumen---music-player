'use client';
// components/VinylSVG.tsx — Monochrome vinyl record SVG

interface VinylSVGProps {
  size?: number;
  className?: string;
  spinning?: boolean;
}

export function VinylSVG({ size = 200, className = '', spinning = false }: VinylSVGProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 200 200"
      xmlns="http://www.w3.org/2000/svg"
      className={`${spinning ? 'animate-spin-slower' : ''} ${className}`}
    >
      {/* Outer vinyl — dark charcoal */}
      <circle cx="100" cy="100" r="98" fill="#1a1a1a" stroke="#2e2e2e" strokeWidth="1.5" />
      {/* Grooves — subtle lighter rings */}
      {[85, 72, 60, 50, 40].map((r) => (
        <circle key={r} cx="100" cy="100" r={r} fill="none" stroke="#2a2a2a" strokeWidth="1.2" />
      ))}
      {/* Label area */}
      <circle cx="100" cy="100" r="32" fill="#111111" />
      <circle cx="100" cy="100" r="28" fill="url(#labelGradMono)" />
      {/* Center hole */}
      <circle cx="100" cy="100" r="5" fill="#0a0a0a" />
      {/* Sheen highlight */}
      <ellipse cx="70" cy="60" rx="20" ry="10" fill="white" opacity="0.04" transform="rotate(-30 70 60)" />

      <defs>
        <radialGradient id="labelGradMono" cx="40%" cy="40%">
          <stop offset="0%"   stopColor="#555555" />
          <stop offset="60%"  stopColor="#333333" />
          <stop offset="100%" stopColor="#1a1a1a" />
        </radialGradient>
      </defs>
    </svg>
  );
}
