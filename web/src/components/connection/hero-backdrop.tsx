/**
 * The decorative backdrop for the connection screen's brand panel.
 *
 * Irregular pastel-lilac wave bands — each a step darker than the last — stack down
 * the panel so the colour undulates from light at the top to deep lilac at the
 * bottom. Their amplitude, phase and spacing are uneven so the flow feels organic,
 * but the curves themselves stay smooth. The light tones and the clear top-left
 * corner keep the deep-purple wordmark legible.
 *
 * Paths overrun the 0–256 viewBox on both sides so a stray edge never shows at the
 * panel borders. Purely decorative, so hidden from the accessibility tree.
 */
export function HeroBackdrop() {
  return (
    <svg
      className="pointer-events-none absolute inset-0 size-full"
      viewBox="0 0 256 600"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <rect width="256" height="600" fill="#ece7fe" />
      <path
        fill="#ddd4fc"
        d="M-20,158 C40,108 92,150 150,138 C202,127 236,168 276,146 L276,620 L-20,620 Z"
      />
      <path
        fill="#cbbcfa"
        d="M-20,302 C52,236 122,300 182,288 C224,280 250,306 276,276 L276,620 L-20,620 Z"
      />
      <path
        fill="#b7a4f8"
        d="M-20,404 C34,362 92,442 156,412 C204,389 244,428 276,398 L276,620 L-20,620 Z"
      />
      <path
        fill="#a68ef5"
        d="M-20,520 C60,470 122,528 160,502 C206,472 246,520 276,492 L276,620 L-20,620 Z"
      />
    </svg>
  )
}
