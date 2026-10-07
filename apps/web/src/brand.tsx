/**
 * Product brand (design spec section 2). One place for the name, so a change after the legal
 * check (spec 2.1: trademark and domain clearance still open) touches only this file and
 * apps/api/src/brand.ts.
 *
 * The name is always lowercase, in every language. The endorsement line is not translated yet
 * (spec 2.3: open).
 */
export const BRAND_NAME = 'parallax';
export const BRAND_BY = 'by Azerconnect Group';
export const BRAND_FULL = `${BRAND_NAME} ${BRAND_BY}`;

/** Two viewpoints joined to one star (spec 2.2). Lines follow the text colour; the star is gold. */
export function Mark({ size = 28, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 28 28"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path
        d="M6 23 14 6l8 17"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx="6"
        cy="23"
        r="3.2"
        fill="var(--c-card, #fff)"
        stroke="currentColor"
        strokeWidth="2"
      />
      <circle
        cx="22"
        cy="23"
        r="3.2"
        fill="var(--c-card, #fff)"
        stroke="currentColor"
        strokeWidth="2"
      />
      <circle cx="14" cy="6" r="3.6" fill="var(--c-star, #F5C461)" />
    </svg>
  );
}

/** The lockup: mark, wordmark, endorsement line. `compact` drops the endorsement (spec 6.2.1). */
export function Brand({ compact = false, size = 28 }: { compact?: boolean; size?: number }) {
  return (
    <span
      className="inline-flex items-center gap-2.5"
      aria-label={compact ? BRAND_NAME : BRAND_FULL}
    >
      <Mark size={size} className="text-link" />
      <span
        aria-hidden="true"
        className="text-[22px] font-extrabold leading-none tracking-[-0.03em] text-ink"
      >
        {BRAND_NAME}
      </span>
      {!compact && (
        <span aria-hidden="true" className="hidden text-[13px] font-semibold text-ink-3 sm:inline">
          {BRAND_BY}
        </span>
      )}
    </span>
  );
}
