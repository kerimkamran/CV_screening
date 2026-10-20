/**
 * Stage 2 strings (new and renamed). Spread LAST in az.ts, so where a sentence also exists in an
 * older file this wording wins. Azerbaijani wording here still needs the native review (S2-FE15).
 */
export const AZ_STAGE2: Record<string, string> = {
  // One status vocabulary (S2-BE1). Same keys as CV_STATUS_LABEL in @cv/shared.
  'Not sent': 'Göndərilməyib',
  'Sending…': 'Göndərilir…',
  'Waiting to send': 'Göndərilmə gözlənilir',
  'Could not send': 'Göndərmək alınmadı',
  'Not accepted': 'Qəbul edilmədi',
  'Already in this vacancy': 'Bu vakansiyada artıq var',
  'Vacancy full': 'Vakansiya doludur',
  'Being analyzed': 'Təhlil olunur',
  Stopped: 'Dayandırılıb',
  'Analysis failed': 'Təhlil alınmadı',
  'No readable text': 'Oxunan mətn yoxdur',
  'Needs a human look': 'İnsan baxışı tələb edir',
  Analyzed: 'Təhlil olunub',
  'Not analyzed for the current criteria': 'Cari meyarlar üçün təhlil olunmayıb',
  Erased: 'Silinib',

  // Upload codes (UPLOAD_CODE_MESSAGE)
  'Not a CV file type': 'CV fayl növü deyil',
  'Old Word format: save it as .docx or PDF': 'Köhnə Word formatı: .docx və ya PDF kimi saxlayın',
  'The file is empty': 'Fayl boşdur',
  'Over {n} MB': '{n} MB-dan böyükdür',
  'The ZIP could not be opened': 'ZIP faylı açıla bilmədi',
  'A file inside the ZIP could not be read': 'ZIP daxilindəki fayl oxuna bilmədi',
  'The ZIP is over {n} MB': 'ZIP {n} MB-dan böyükdür',
  'The ZIP holds more than {n} files': 'ZIP-də {n} fayldan çox var',
  'Unsafe file path': 'Təhlükəli fayl yolu',
  'An archive inside the ZIP is not opened': 'ZIP daxilindəki arxiv açılmır',
  'Unusually compressed, not opened': 'Qeyri-adi sıxılıb, açılmadı',
  'No CVs found in this ZIP': 'Bu ZIP-də CV tapılmadı',
  'This vacancy holds at most {n} CVs': 'Bu vakansiyada ən çox {n} CV ola bilər',
  'The text could not be read': 'Mətn oxuna bilmədi',
  'The server could not process this file': 'Server bu faylı emal edə bilmədi',
};
