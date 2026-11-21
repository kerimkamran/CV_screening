/**
 * The name rules for files inside a ZIP of CVs (S3-UP-06, S3-UP-08). One copy, so the server's
 * reader and the browser's "about n CVs" estimate count the same names. The server never trusts the
 * browser's count; it applies these rules again to what it unpacks.
 */

/** Names the reader unpacks as CVs. */
export const ZIP_CV_NAME = /\.(pdf|docx|txt|md)$/i;

/** Archives inside a ZIP are never opened. */
export const ZIP_ARCHIVE_NAME = /\.(zip|rar|7z|gz|tgz|tar|bz2|xz)$/i;

/** Operating-system litter: folders, __MACOSX, .DS_Store, Thumbs.db, desktop.ini, Office locks. */
export function isZipLitter(path: string): boolean {
  const parts = path.replaceAll('\\', '/').split('/');
  const base = parts[parts.length - 1] ?? '';
  return (
    parts.includes('__MACOSX') ||
    base === '' ||
    base === '.DS_Store' ||
    base === 'Thumbs.db' ||
    base === 'desktop.ini' ||
    base.startsWith('~$') ||
    base.startsWith('._')
  );
}

/** True when a ZIP entry name would be taken in as a CV (not litter, not an archive, right type). */
export const isZipCvName = (path: string): boolean =>
  !isZipLitter(path) && !ZIP_ARCHIVE_NAME.test(path) && ZIP_CV_NAME.test(path);

/** At most this many entries of one ZIP are examined; the rest are reported in one row. */
export const MAX_ZIP_ENTRIES = 1000;
