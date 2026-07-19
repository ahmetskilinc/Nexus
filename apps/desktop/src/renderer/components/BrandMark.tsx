/// The Nexus brand mark: a rounded "cloud" squircle — the app's silhouette —
/// enclosing a terminal prompt (a `>` chevron + cursor), signalling a coding
/// agent. Ported from the GPUI spike's cloud-terminal glyph and filled with the
/// coral primary gradient. Colors come from CSS tokens so it re-themes with the
/// rest of the app; the prompt is stroked in `--color-primary-foreground` for contrast.
export function BrandMark({
  size = 28,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      role="img"
      aria-label="Nexus"
      className={className}
    >
      <defs>
        <linearGradient
          id="nexus-brand-grad"
          x1="4"
          y1="3.5"
          x2="20"
          y2="20.5"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="var(--brand-grad-from)" />
          <stop offset="1" stopColor="var(--brand-grad-to)" />
        </linearGradient>
      </defs>
      <path
        d="M12 3.5C16 3.5 20.5 4 20.5 12C20.5 20 16 20.5 12 20.5C8 20.5 3.5 20 3.5 12C3.5 4 8 3.5 12 3.5Z"
        fill="url(#nexus-brand-grad)"
      />
      <path
        d="M8.5 9.5L11 12L8.5 14.5"
        stroke="var(--color-primary-foreground)"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12.75 14.5H15.5"
        stroke="var(--color-primary-foreground)"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
