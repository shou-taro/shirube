/**
 * A wide, shallow wavy pastel band for the top bar — the same lilac wave motif as the
 * connection screen, echoed here as a single branded accent. A few distinct bands
 * (rather than a smooth gradient) keep it legible in the short bar; the tones stay
 * light so the bar's text and controls read on top. Purely decorative.
 *
 * @param fade - When set, the wave fades out towards the right, so it sits only behind
 *   the brand on the left rather than running the full width.
 */
export function HeaderWave({ fade = false }: { fade?: boolean }) {
  const maskImage = fade
    ? 'linear-gradient(to right, black 0%, black 22%, transparent 52%)'
    : undefined
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox="0 0 1200 48"
      preserveAspectRatio="none"
      aria-hidden="true"
      style={{ maskImage, WebkitMaskImage: maskImage }}
    >
      <rect width="1200" height="48" fill="#f1edfc" />
      <path
        fill="#e4dcfb"
        d="M0,22 C240,10 470,30 720,22 C940,15 1060,29 1200,19 L1200,48 L0,48 Z"
      />
      <path
        fill="#d7cbf9"
        d="M0,36 C260,28 480,44 740,37 C980,32 1080,42 1200,34 L1200,48 L0,48 Z"
      />
    </svg>
  )
}
