// components/VinylSVG.tsx
// Generic vinyl record SVG used as album art placeholder

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
      {/* Outer vinyl */}
      <circle cx="100" cy="100" r="98" fill="#1a1a2e" stroke="#2a2a4e" strokeWidth="2" />
      {/* Grooves */}
      {[85, 72, 60, 50, 40].map((r) => (
        <circle key={r} cx="100" cy="100" r={r} fill="none" stroke="#252540" strokeWidth="1.2" />
      ))}
      {/* Label */}
      <circle cx="100" cy="100" r="32" fill="#0f0f1e" />
      <circle cx="100" cy="100" r="28" fill="url(#labelGrad)" />
      {/* Center hole */}
      <circle cx="100" cy="100" r="5" fill="#0a0a14" />
      {/* Sheen */}
      <ellipse cx="70" cy="60" rx="20" ry="10" fill="white" opacity="0.04" transform="rotate(-30 70 60)" />

      <defs>
        <radialGradient id="labelGrad" cx="40%" cy="40%">
          <stop offset="0%" stopColor="#7c3aed" />
          <stop offset="60%" stopColor="#4c1d95" />
          <stop offset="100%" stopColor="#2d1166" />
        </radialGradient>
      </defs>
    </svg>
  );
}
