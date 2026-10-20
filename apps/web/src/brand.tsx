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
/**
 * The waiting scene's café name (Stage 2, S2-FE11). Brand/Legal must clear it before the first UAT
 * build that shows it (S2-FE15); a rename touches only this constant.
 */
export const SCENE_NAME = 'coffeebay';

/** Two viewpoints joined to one star (spec 2.2). Lines follow the text colour; the star is gold. */
export function Mark({
  size = 28,
  className = '',
  fill = 'var(--c-card, #fff)',
  star = 'var(--c-star, #F5C461)',
}: {
  size?: number;
  className?: string;
  fill?: string;
  star?: string;
}) {
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
      <circle cx="6" cy="23" r="3.2" fill={fill} stroke="currentColor" strokeWidth="2" />
      <circle cx="22" cy="23" r="3.2" fill={fill} stroke="currentColor" strokeWidth="2" />
      <circle cx="14" cy="6" r="3.6" fill={star} />
    </svg>
  );
}

/** The lockup: mark, wordmark, endorsement line. `compact` drops the endorsement (spec 6.2.1). */
export function Brand({
  compact = false,
  size = 28,
  onBrand = false,
}: {
  compact?: boolean;
  size?: number;
  /** On the navy header band: white wordmark, gold star. */
  onBrand?: boolean;
}) {
  return (
    <span
      className="inline-flex items-center gap-2.5"
      aria-label={compact ? BRAND_NAME : BRAND_FULL}
    >
      <Mark
        size={size}
        className={onBrand ? 'text-on-brand' : 'text-link'}
        fill={onBrand ? 'var(--c-brand)' : undefined}
        star={onBrand ? '#F5C461' : undefined}
      />
      <span
        aria-hidden="true"
        className={`text-[22px] font-extrabold leading-none tracking-[-0.03em] ${onBrand ? 'text-on-brand' : 'text-ink'}`}
      >
        {BRAND_NAME}
      </span>
      {!compact && (
        <span
          aria-hidden="true"
          className={`hidden text-[13px] font-semibold sm:inline ${onBrand ? 'text-on-brand/80' : 'text-ink-3'}`}
        >
          {BRAND_BY}
        </span>
      )}
    </span>
  );
}
