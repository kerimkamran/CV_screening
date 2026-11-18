import { locale } from './i18n';

// Dates and times in the language of the screen. English comes from the browser's own formatter
// (en-GB). Azerbaijani is written here, with its own month names and a 24-hour clock, so it reads the
// same in every browser: a browser without Azerbaijani data would print "M11" for November (I18-07).
const AZ_LONG = [
  'yanvar',
  'fevral',
  'mart',
  'aprel',
  'may',
  'iyun',
  'iyul',
  'avqust',
  'sentyabr',
  'oktyabr',
  'noyabr',
  'dekabr',
];
const AZ_SHORT = [
  'yan',
  'fev',
  'mar',
  'apr',
  'may',
  'iyn',
  'iyl',
  'avq',
  'sen',
  'okt',
  'noy',
  'dek',
];
const two = (n: number) => String(n).padStart(2, '0');
const isAz = () => locale() === 'az-AZ';

/** "10:58". */
export function clock(d: Date): string {
  return isAz()
    ? `${two(d.getHours())}:${two(d.getMinutes())}`
    : d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
}

/** "15 noyabr 2026" (long) or "15 noy 2026" (short); in English "15 November 2026" / "15 Nov 2026". */
export function day(d: Date, style: 'long' | 'short' = 'long'): string {
  return isAz()
    ? `${d.getDate()} ${(style === 'long' ? AZ_LONG : AZ_SHORT)[d.getMonth()]} ${d.getFullYear()}`
    : d.toLocaleDateString(locale(), { day: 'numeric', month: style, year: 'numeric' });
}

/** "15 noyabr 2026, 10:58"; in English the browser's date and time for en-GB. */
export function dayAndTime(d: Date): string {
  return isAz() ? `${day(d)}, ${clock(d)}` : d.toLocaleString(locale());
}
