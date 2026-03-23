"use client";

import { motion } from "framer-motion";

function FloatingPaths({ position }: { position: number }) {
  // 36 cubic-bezier paths that sweep across the full 1440×900 canvas
  const paths = Array.from({ length: 36 }, (_, i) => {
    const startY = (i / 35) * 1000 - 50;
    const cp1Y = startY + position * (i % 2 === 0 ? -180 : 140);
    const cp2Y = startY + position * (i % 3 === 0 ? 160 : -120);
    const endY = startY + position * (i % 2 === 0 ? 60 : -60);
    return {
      id: i,
      d: `M-200 ${startY} C350 ${cp1Y} 1090 ${cp2Y} 1640 ${endY}`,
      // Subtle but visible — alternating brightness across the set
      opacity: 0.08 + (i % 6) * 0.025,
      width: 0.4 + (i % 5) * 0.18,
      // Stagger travel so they don't all animate in sync
      delay: i * 0.35,
      duration: 18 + (i % 7) * 4,
    };
  });

  return (
    <div className="absolute inset-0 pointer-events-none">
      <svg
        className="w-full h-full"
        viewBox="0 0 1440 900"
        fill="none"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden
      >
        {paths.map((path) => (
          <motion.path
            key={path.id}
            d={path.d}
            stroke="white"
            strokeWidth={path.width}
            // Draw 30 % of the path length — gives the traveling-dash look
            initial={{ pathLength: 0.3, pathOffset: 0, opacity: 0 }}
            animate={{
              pathOffset: [0, 0.7, 1],
              opacity: [0, path.opacity, path.opacity, 0],
            }}
            transition={{
              duration: path.duration,
              repeat: Infinity,
              ease: "linear",
              delay: path.delay,
              times: [0, 0.1, 0.9, 1],
            }}
          />
        ))}
      </svg>
    </div>
  );
}

export function BackgroundPaths({ className = "" }: { className?: string }) {
  return (
    <div
      className={`absolute inset-0 overflow-hidden pointer-events-none ${className}`}
      aria-hidden
    >
      <FloatingPaths position={1} />
      <FloatingPaths position={-1} />
    </div>
  );
}
