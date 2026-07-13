/**
 * A wavy pastel-lilac wash for the top bar — the same lilac wave motif as the
 * connection screen, echoed here as a single branded accent. The whole bar sits on a
 * pastel-lilac base; a couple of distinct, deeper wave bands accent the brand on the
 * left and fade into that base towards the right, so the controls sit on a calm flat
 * tone. Kept light so the bar's text stays readable. Purely decorative.
 */
export function HeaderWave() {
  const bandMask = 'linear-gradient(to right, black 0%, black 26%, transparent 60%)'
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox="0 0 1200 48"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <rect width="1200" height="48" fill="#ece7fd" />
      <g style={{ maskImage: bandMask, WebkitMaskImage: bandMask }}>
        <path
          fill="#ddd2fb"
          d="M0,22 C240,10 470,30 720,22 C940,15 1060,29 1200,19 L1200,48 L0,48 Z"
        />
        <path
          fill="#cfc0f8"
          d="M0,36 C260,28 480,44 740,37 C980,32 1080,42 1200,34 L1200,48 L0,48 Z"
        />
      </g>
    </svg>
  )
}
