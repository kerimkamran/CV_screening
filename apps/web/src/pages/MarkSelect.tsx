import type { Mark } from '@cv/shared';
import { useT } from '../i18n';
import { MARK_STYLE, MARKS, markName } from '../pool';

/** The decision control: a compact pill that is a real drop-down, so it works by keyboard and on phones. */
export function MarkSelect({
  value,
  label,
  disabled,
  onChange,
  size = 'sm',
}: {
  value: Mark;
  /** Who this is for, read out by screen readers. */
  label: string;
  disabled?: boolean;
  onChange: (m: Mark) => void;
  size?: 'sm' | 'md';
}) {
  const t = useT();
  return (
    <select
      aria-label={t('Decision for {name}', { name: label })}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as Mark)}
      onClick={(e) => e.stopPropagation()}
      className={`cursor-pointer rounded-full border font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-70 ${size === 'md' ? 'px-3 py-1.5 text-sm' : 'px-2.5 py-0.5 text-xs'} ${MARK_STYLE[value]}`}
    >
      {MARKS.map((m) => (
        <option key={m} value={m}>
          {markName(m)}
        </option>
      ))}
    </select>
  );
}
