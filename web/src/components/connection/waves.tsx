/**
 * A wavy pastel backdrop for the connection screen's brand panel.
 *
 * Several pastel bands — each a step further from pink towards lilac — stack down the
 * panel so the colour undulates from top to bottom. The bands are deliberately
 * uneven (varying amplitude, phase and spacing) and a gentle turbulence displacement
 * warps their edges, so the result reads as organic and marble-like rather than a
 * regular ripple. The pink tones stay at the top behind the wordmark, keeping the
 * deep-purple ink legible. Purely decorative, so hidden from the accessibility tree.
 *
 * Paths overrun the 0–256 viewBox on both sides so the displacement never exposes a
 * gap at the panel edges.
 */
export function Waves() {
  return (
    <svg
      className="pointer-events-none absolute inset-0 size-full"
      viewBox="0 0 256 600"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <defs>
        {/* Low-frequency noise warps the wave edges into an irregular, hand-poured
            wobble instead of clean parallel curves. */}
        <filter id="wave-wobble" x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.006 0.011"
            numOctaves="3"
            seed="9"
            result="noise"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="noise"
            scale="24"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>
      <rect width="256" height="600" fill="#fcd4ea" />
      <g filter="url(#wave-wobble)">
        <path
          fill="#f4ccf1"
          d="M-20,150 C40,116 92,130 150,150 C200,167 236,138 276,158 L276,620 L-20,620 Z"
        />
        <path
          fill="#e7c7f6"
          d="M-20,298 C58,246 122,286 176,300 C214,310 246,299 276,282 L276,620 L-20,620 Z"
        />
        <path
          fill="#d5bdf9"
          d="M-20,404 C30,374 72,436 142,418 C192,405 236,432 276,402 L276,620 L-20,620 Z"
        />
        <path
          fill="#c4b1fb"
          d="M-20,512 C52,484 112,522 152,504 C196,485 236,518 276,498 L276,620 L-20,620 Z"
        />
      </g>
    </svg>
  )
}
