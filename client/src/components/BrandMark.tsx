/** 32px rounded brand mark (rx=7, brand green fill) with a code-brackets glyph. */
export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" style={{ flexShrink: 0 }}>
      <rect width="32" height="32" rx="7" fill="var(--mantine-color-brand-8)" />
      <path
        d="M12.5 10.5 7 16l5.5 5.5M19.5 10.5 25 16l-5.5 5.5"
        fill="none"
        stroke="var(--mantine-color-white)"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
