/**
 * A generated marble texture for the connection screen's brand panel.
 *
 * `feTurbulence` produces fractal noise that `feDisplacementMap` smears a lilac
 * gradient with, breaking the smooth gradient into organic swirls; a second,
 * higher-frequency turbulence layer is thresholded into thin darker veins. Together
 * they read as chaotic, stone-like marble rather than a clean gradient. Purely
 * decorative, so it is hidden from the accessibility tree.
 */
export function Marble() {
  return (
    <svg
      className="pointer-events-none absolute inset-0 size-full"
      viewBox="0 0 256 600"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <defs>
        {/* The colour spine: light at the top-left (behind the logo) deepening to a
            rich violet at the bottom-right. */}
        <linearGradient id="marble-base" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f7f2ff" />
          <stop offset="30%" stopColor="#d0c0fc" />
          <stop offset="62%" stopColor="#9d7bf2" />
          <stop offset="100%" stopColor="#6c4cdf" />
        </linearGradient>
        {/* Smear the gradient into swirls. */}
        <filter id="marble-swirl" x="-25%" y="-25%" width="150%" height="150%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.009 0.013"
            numOctaves="4"
            seed="12"
            result="noise"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="noise"
            scale="86"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
        {/* Thin darker veins for the marble grain. */}
        <filter id="marble-veins" x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence
            type="turbulence"
            baseFrequency="0.022 0.03"
            numOctaves="2"
            seed="5"
            result="veins"
          />
          <feColorMatrix
            in="veins"
            type="matrix"
            values="0 0 0 0 0.24  0 0 0 0 0.16  0 0 0 0 0.44  0 0 0 -1.6 1.15"
          />
        </filter>
      </defs>
      <rect width="256" height="600" fill="url(#marble-base)" filter="url(#marble-swirl)" />
      <rect width="256" height="600" filter="url(#marble-veins)" opacity="0.32" />
    </svg>
  )
}
