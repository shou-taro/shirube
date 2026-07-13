/**
 * The decorative backdrop for the connection screen's brand panel.
 *
 * Two layers, both purely decorative (hidden from the accessibility tree):
 *
 * 1. Irregular pastel-lilac wave bands — each a step darker than the last — stack
 *    down the panel so the colour undulates from light at the top to deep lilac at
 *    the bottom. Their amplitude, phase and spacing are uneven and a turbulence
 *    displacement warps the edges, so the flow reads as organic rather than a
 *    regular ripple. Paths overrun the 0–256 viewBox on both sides so the
 *    displacement never exposes a gap at the panel edges.
 * 2. A faint node graph — shirube's signpost motif — with one waypoint picked out in
 *    the brand colour, echoing the logo and the ER map the app is really about.
 *
 * The light tones and the clear top-left corner keep the deep-purple wordmark legible.
 */
export function HeroBackdrop() {
  return (
    <svg
      className="pointer-events-none absolute inset-0 size-full"
      viewBox="0 0 256 600"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <defs>
        {/* Noise warps the wave edges into an irregular, hand-poured wobble. */}
        <filter id="hero-wobble" x="-25%" y="-25%" width="150%" height="150%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.009 0.015"
            numOctaves="4"
            seed="17"
            result="noise"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="noise"
            scale="38"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>

      <rect width="256" height="600" fill="#ece7fe" />
      <g filter="url(#hero-wobble)">
        <path
          fill="#ddd4fc"
          d="M-20,158 C36,104 88,152 146,140 C196,130 232,170 276,148 L276,620 L-20,620 Z"
        />
        <path
          fill="#cbbcfa"
          d="M-20,300 C50,232 120,302 178,290 C222,281 248,308 276,274 L276,620 L-20,620 Z"
        />
        <path
          fill="#b7a4f8"
          d="M-20,398 C24,364 86,448 152,414 C200,390 242,432 276,398 L276,620 L-20,620 Z"
        />
        <path
          fill="#a68ef5"
          d="M-20,518 C58,474 120,530 158,504 C202,476 244,522 276,494 L276,620 L-20,620 Z"
        />
      </g>

      {/* Signpost motif: a faint constellation of nodes with one lilac waypoint. */}
      <g stroke="#4c3f92" strokeWidth="1.4" opacity="0.28">
        <path
          fill="none"
          d="M66,250 L150,224 M66,250 L104,330 M150,224 L196,306 M104,330 L196,306 M104,330 L150,410 M104,330 L58,392 M196,306 L150,410 M58,392 L150,410"
        />
        <circle cx="66" cy="250" r="3.5" fill="#efeafe" />
        <circle cx="104" cy="330" r="3.5" fill="#efeafe" />
        <circle cx="196" cy="306" r="3.5" fill="#efeafe" />
        <circle cx="150" cy="410" r="3.5" fill="#efeafe" />
        <circle cx="58" cy="392" r="3.5" fill="#efeafe" />
      </g>
      {/* The "you are here" waypoint, a touch more present, in the brand lilac. */}
      <circle cx="150" cy="224" r="5" fill="#8b6cf0" opacity="0.55" />
    </svg>
  )
}
