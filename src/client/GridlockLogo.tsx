import React from 'react';
import overclockLogoUrl from './assets/overclock-logo.png';

/**
 * Renders the full-color OVERCLOCK transparent PNG wordmark with a matching
 * multi-spectrum neon glow behind the letters (Cyan -> Emerald -> Amber -> Crimson).
 */
export function OverclockLogo({
  className = 'w-56 sm:w-72 h-auto',
  label = 'OVERCLOCK',
  glow = true,
}: {
  className?: string;
  label?: string;
  glow?: boolean;
}) {
  return (
    <div className={`relative inline-flex items-center justify-center select-none ${className}`}>
      {glow && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-1 inset-y-2 rounded-full opacity-65 blur-xl"
          style={{
            background:
              'linear-gradient(90deg, rgba(0,240,255,0.48) 0%, rgba(0,255,136,0.42) 38%, rgba(255,165,0,0.45) 70%, rgba(255,42,85,0.5) 100%)',
          }}
        />
      )}

      <img
        src={overclockLogoUrl}
        alt={label}
        draggable={false}
        className={`relative z-10 w-full h-auto object-contain ${
          glow
            ? 'drop-shadow-[0_0_10px_rgba(0,240,255,0.38)] drop-shadow-[0_0_18px_rgba(255,80,60,0.22)]'
            : 'drop-shadow-[0_0_6px_rgba(0,240,255,0.3)]'
        }`}
      />
    </div>
  );
}

// Keep GridlockLogo alias for backwards compatibility
export const GridlockLogo = OverclockLogo;
