/**
 * A wavy pastel backdrop for the connection screen's brand panel.
 *
 * Several smooth wave bands, each a step further from pink towards lilac, stack down
 * the panel so the colour undulates rather than shifting in a single straight sweep.
 * The lightest (pink) tones sit at the top behind the wordmark, keeping the
 * deep-purple ink legible. Purely decorative, so hidden from the accessibility tree.
 */
export function Waves() {
  return (
    <svg
      className="pointer-events-none absolute inset-0 size-full"
      viewBox="0 0 256 600"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <rect width="256" height="600" fill="#fcd4ea" />
      <path
        fill="#f4ccf1"
        d="M0,150 C48,120 92,122 128,150 C170,182 210,180 256,150 L256,600 L0,600 Z"
      />
      <path
        fill="#e7c7f6"
        d="M0,290 C40,258 102,266 140,292 C184,322 218,316 256,288 L256,600 L0,600 Z"
      />
      <path
        fill="#d5bdf9"
        d="M0,405 C58,376 96,380 132,406 C178,438 214,434 256,408 L256,600 L0,600 Z"
      />
      <path
        fill="#c4b1fb"
        d="M0,505 C44,478 106,484 142,506 C184,530 220,524 256,500 L256,600 L0,600 Z"
      />
    </svg>
  )
}
