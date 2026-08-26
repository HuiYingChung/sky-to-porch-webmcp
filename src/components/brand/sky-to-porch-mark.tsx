/**
 * src/components/brand/sky-to-porch-mark.tsx
 *
 * ADR-0050: the Sky to Porch mark, "Data at home" — the owner's pick from
 * three candidate directions. A satellite pass above the roofline, and the
 * data living inside the house rather than up in the sky, which is the
 * product's whole claim in one figure.
 *
 * Drawn entirely in `currentColor`, so one file serves both themes and the
 * surrounding text color governs it. Decorative by default: every place that
 * renders it also states "Sky to Porch" in text, so the mark is aria-hidden
 * unless a caller supplies its own label.
 */

export interface SkyToPorchMarkProps {
  /** Rendered square size in px. */
  size?: number;
  /** Accessible name. Omit where adjacent text already names the product. */
  title?: string;
}

export function SkyToPorchMark({ size = 24, title }: SkyToPorchMarkProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      fill="none"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
      data-testid="brand-mark"
      style={{ display: "block", flexShrink: 0 }}
    >
      {/* satellite pass */}
      <path
        d="M8 17 Q32 5 56 17"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <circle cx="32" cy="11" r="3.2" fill="currentColor" />
      {/* home */}
      <path
        d="M10 37 L32 21 L54 37 V56 H10 Z"
        stroke="currentColor"
        strokeWidth="3.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* the data, indoors */}
      <rect x="19" y="47" width="6" height="7" rx="1" fill="currentColor" />
      <rect x="29" y="43" width="6" height="11" rx="1" fill="currentColor" />
      <rect x="39" y="39" width="6" height="15" rx="1" fill="currentColor" />
    </svg>
  );
}
