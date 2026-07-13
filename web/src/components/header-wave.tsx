/**
 * A wide, shallow wavy pastel wash for the top bar — the same pink-to-lilac motif as
 * the connection screen, echoed here as a single branded accent. Kept light so the
 * bar's text and controls stay readable on top. Purely decorative.
 */
export function HeaderWave() {
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox="0 0 1200 48"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <rect width="1200" height="48" fill="#fdf4fb" />
      <path
        fill="#f6ecfb"
        d="M0,16 C220,4 380,26 620,17 C840,9 1010,25 1200,14 L1200,48 L0,48 Z"
      />
      <path
        fill="#efe6fd"
        d="M0,28 C240,18 470,34 720,27 C940,21 1060,33 1200,25 L1200,48 L0,48 Z"
      />
      <path
        fill="#e7dcfc"
        d="M0,39 C260,31 480,45 740,39 C980,34 1080,43 1200,37 L1200,48 L0,48 Z"
      />
    </svg>
  )
}
