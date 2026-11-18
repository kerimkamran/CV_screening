import type { Page } from '@playwright/test';

// What the app prints for a date (apps/web/src/dates.ts): English from the browser's en-GB
// formatter, Azerbaijani from the app's own month names and a 24-hour clock. Computed in the page
// so the time zone is the browser's, as it is for the app.
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

type Lang = 'en' | 'az';

/** "27 okt 2026" / "27 Oct 2026" (short) or "27 oktyabr 2026" / "27 October 2026" (long). */
export function appDay(page: Page, iso: string, lang: Lang, style: 'long' | 'short' = 'short') {
  return page.evaluate(
    ([d, l, st, longM, shortM]) => {
      const x = new Date(d as string);
      return l === 'az'
        ? `${x.getDate()} ${(st === 'long' ? (longM as string[]) : (shortM as string[]))[x.getMonth()]} ${x.getFullYear()}`
        : x.toLocaleDateString('en-GB', {
            day: 'numeric',
            month: st as 'long' | 'short',
            year: 'numeric',
          });
    },
    [iso, lang, style, AZ_LONG, AZ_SHORT] as const,
  );
}

/** "15 noyabr 2026, 06:00" in AZ; the browser's en-GB date and time in English. */
export function appDayAndTime(page: Page, iso: string, lang: Lang) {
  return page.evaluate(
    ([d, l, longM]) => {
      const x = new Date(d as string);
      const two = (n: number) => String(n).padStart(2, '0');
      return l === 'az'
        ? `${x.getDate()} ${(longM as string[])[x.getMonth()]} ${x.getFullYear()}, ${two(x.getHours())}:${two(x.getMinutes())}`
        : x.toLocaleString('en-GB');
    },
    [iso, lang, AZ_LONG] as const,
  );
}
