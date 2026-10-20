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

  // Upload card, batch panel and the coffeebay waiting screen (S2-FE7, FE8, FE11 to FE13)
  '1 analysis failed': '1 təhlil alınmadı',
  '1 file was not sent': '1 fayl göndərilmədi',
  'About {n}% of the CVs are read.': 'CV-lərin təxminən {n}%-i oxunub.',
  'Add a ZIP': 'ZIP əlavə et',
  'Add at least one CV.': 'Ən azı bir CV əlavə edin.',
  'All files are sent. You can close this page: {assistant} keeps reading.':
    'Bütün fayllar göndərildi. Bu səhifəni bağlaya bilərsən: {assistant} oxumağa davam edir.',
  'All ready': 'Hamısı hazırdır',
  'All {n}': 'Hamısı {n}',
  'All {n} CVs are ready, {name}. Enjoy your coffee.':
    '{name}, bütün {n} CV hazırdır. Qəhvənin dadını çıxar.',
  'All {n} CVs are ready. Enjoy your coffee.': 'Bütün {n} CV hazırdır. Qəhvənin dadını çıxar.',
  'Analyzed {done} of {total}': 'Təhlil olundu: {done} / {total}',
  CVs: 'CV',
  'CVs are read by the AI provider your administrator has chosen.':
    'CV-ləri administratorun seçdiyi süni intellekt provayderi oxuyur.',
  'Choose a ZIP of CVs': 'CV-lərin ZIP faylını seçin',
  'Choose a folder of CVs': 'CV qovluğu seçin',
  'Choose the files that were not sent': 'Göndərilməyən faylları seçin',
  Details: 'Ətraflı',
  'Drop CVs here': 'CV-ləri bura sürüşdürün',
  'Files in this upload': 'Bu yükləmədəki fayllar',
  'Go grab a coffee and relax.': 'Özünə bir qəhvə götür və dincəl.',
  'Hey {name}, go grab a coffee and relax.': 'Salam, {name}! Özünə bir qəhvə götür və dincəl.',
  'Hey {name}, this only takes a minute or two.': 'Salam, {name}! Bu, bir-iki dəqiqə çəkəcək.',
  'Latest upload': 'Son yükləmə',
  'Latest upload only': 'Yalnız son yükləmə',
  'Needs attention {n}': 'Diqqət tələb edir {n}',
  'No CVs in this vacancy yet.': 'Bu vakansiyada hələ CV yoxdur.',
  'Nothing to show here.': 'Burada göstəriləcək bir şey yoxdur.',
  'Now brewing': 'İndi dəmlənir',
  'Only {room} more CVs fit in this vacancy. The last {n} will not be sent.':
    'Bu vakansiyaya yalnız {room} CV də sığır. Sonuncu {n} göndərilməyəcək.',
  'PDF, DOCX or TXT files, a whole folder, or a ZIP of CVs':
    'PDF, DOCX və ya TXT faylları, bütöv qovluq və ya CV-lərin ZIP faylı',
  'PDF, DOCX or TXT files, or a ZIP of CVs':
    'PDF, DOCX və ya TXT faylları, yaxud CV-lərin ZIP faylı',
  Progress: 'Gedişat',
  'Remove all files that need attention': 'Diqqət tələb edən bütün faylları çıxar',
  'Retry failed ({n})': 'Uğursuzları təkrarla ({n})',
  'See results': 'Nəticələr',
  'See results so far': 'İndiyədək olan nəticələr',
  'Sending files: {sent} of {total}. Keep this page open until they are all sent.':
    'Fayllar göndərilir: {sent} / {total}. Hamısı göndərilənə qədər bu səhifəni açıq saxla.',
  'Sent {sent} of {total}': 'Göndərildi: {sent} / {total}',
  'Show all {n} files': 'Bütün {n} faylı göstər',
  'Show only the files that need attention': 'Yalnız diqqət tələb edən faylları göstər',
  'Show the waiting screen': 'Gözləmə ekranını göstər',
  'Soft sound when ready': 'Hazır olanda yumşaq səs',
  'Started. The CVs are being read.': 'Başladı. CV-lər oxunur.',
  'The folder is very large, so only the first {n} files were read. Choose a smaller folder for the rest.':
    'Qovluq çox böyükdür, buna görə yalnız ilk {n} fayl oxundu. Qalanı üçün daha kiçik qovluq seçin.',
  'This is taking a little longer than usual. {assistant} keeps going, and you can leave this page.':
    'Bu, adi haldan bir az uzun çəkir. {assistant} davam edir, bu səhifədən çıxa bilərsən.',
  'This only takes a minute or two.': 'Bu, bir-iki dəqiqə çəkəcək.',
  'When you start, your browser may ask to show a notification when the CVs are ready.':
    'Başlayanda brauzer CV-lər hazır olduqda bildiriş göstərməyə icazə istəyə bilər.',
  'You chose {n} CVs. Up to {rec} per upload is recommended so results arrive sooner. You can still send all of them.':
    '{n} CV seçdiniz. Nəticələr tez gəlsin deyə hər yükləmədə ən çox {rec} CV tövsiyə olunur. Yenə də hamısını göndərə bilərsiniz.',
  '{assistant} is reading your {n} CVs for you.': '{assistant} {n} CV-ni sənin üçün oxuyur.',
  '{assistant}: your CVs are ready': '{assistant}: CV-lərin hazırdır',
  '{n} CV': '{n} CV',
  '{n} CV queued.': '{n} CV növbəyə qoyuldu.',
  '{n} CVs': '{n} CV',
  '{n} CVs queued.': '{n} CV növbəyə qoyuldu.',
  '{n} analyses failed': '{n} təhlil alınmadı',
  '{n} file': '{n} fayl',
  '{n} files': '{n} fayl',
  '{n} files are not sent yet. Choose them again and only those are sent.':
    '{n} fayl hələ göndərilməyib. Onları yenidən seçin, yalnız onlar göndəriləcək.',
  '{n} files were not sent': '{n} fayl göndərilmədi',
  '{n} need a human look': '{n} nəfər insan baxışı tələb edir',
  '{n} need attention': '{n} fayl diqqət tələb edir',
  '{n} of the chosen files did not match a file that is waiting, so they were not sent.':
    'Seçilmiş faylların {n} ədədi gözləyən heç bir fayla uyğun gəlmədi, buna görə göndərilmədi.',
  '{n} ready': '{n} hazırdır',
  '{n} repeat left out.': '{n} təkrar çıxarıldı.',
  '{n} repeats left out.': '{n} təkrar çıxarıldı.',
  '{n} system file left out.': '{n} sistem faylı çıxarıldı.',
  '{n} system files left out.': '{n} sistem faylı çıxarıldı.',
  '{ready} of {total} CVs are ready to review': '{total} CV-dən {ready} ədədi baxış üçün hazırdır',
  '{ready} of {total} CVs are ready, {name}.': '{name}, {total} CV-dən {ready} ədədi hazırdır.',
  '{ready} of {total} CVs are ready.': '{total} CV-dən {ready} ədədi hazırdır.',
  '{used} of {limit} CVs used in this vacancy':
    'Bu vakansiyada {limit} CV-dən {used} ədədi istifadə olunub',
  '✓ Ready · parallax': '✓ Hazırdır · parallax',
  'about {m} minute left': 'təxminən {m} dəqiqə qalıb',
  'about {m} minutes left': 'təxminən {m} dəqiqə qalıb',
  // The review screen, the CV pane and the lists (S2-FE2 to FE5)
  'This CV is not available to you, or it no longer exists.':
    'Bu CV sizin üçün əlçatan deyil və ya artıq mövcud deyil.',
  'Ranked CVs': 'Sıralanmış CV-lər',
  'All CVs': 'Bütün CV-lər',
  'A CV without a result is marked on its own page.':
    'Nəticəsi olmayan CV öz səhifəsində qiymətləndirilir.',
  'No analyzed CVs yet. Add CVs to a vacancy and choose “Find the best fit”.':
    'Hələ təhlil olunmuş CV yoxdur. Vakansiyaya CV əlavə edin və “Ən uyğununu tap” seçin.',
  'Keys: J and K move, S shortlist, M maybe, N not now, Enter opens the CV.':
    'Düymələr: J və K hərəkət edir, S seçmə siyahısı, M bəlkə, N indi yox, Enter CV-ni açır.',
  Original: 'Orijinal',
  'This CV was erased. Its file and its text are gone.':
    'Bu CV silinib. Faylı və mətni artıq yoxdur.',
  'Show the text instead': 'Əvəzinə mətni göstər',
  'Loading the pages…': 'Səhifələr yüklənir…',
  'The pages of this Word file are not available. The text below was read from the file; the original can be downloaded.':
    'Bu Word faylının səhifələri əlçatan deyil. Aşağıdakı mətn fayldan oxunub; orijinalı yükləmək olar.',
  'This is a plain text file, so it has no pages.':
    'Bu sadə mətn faylıdır, ona görə səhifələri yoxdur.',
  'No text could be read from this file.': 'Bu fayldan mətn oxunmadı.',
  'The lines found are marked here. The original pages are under Original.':
    'Tapılan sətirlər burada işarələnib. Orijinal səhifələr “Orijinal” altındadır.',
  CV: 'CV',
  '{n} pages': '{n} səhifə',
  Zoom: 'Miqyas',
  'Zoom out': 'Kiçilt',
  'Zoom in': 'Böyüt',
  Download: 'Yüklə',
  'Close full screen': 'Tam ekranı bağla',
  'Full screen': 'Tam ekran',
  'CV view': 'CV görünüşü',
  'This CV is being analyzed.': 'Bu CV təhlil olunur.',
  'The result appears here by itself. You can read the CV meanwhile.':
    'Nəticə burada özü görünəcək. Bu arada CV-ni oxuya bilərsiniz.',
  'The analysis of this CV did not finish.': 'Bu CV-nin təhlili başa çatmadı.',
  'Retrying…': 'Yenidən cəhd edilir…',
  'Retry the analysis': 'Təhlili yenidən cəhd et',
  'Read the CV on the left and decide yourself.': 'CV-ni solda oxuyun və özünüz qərar verin.',
  'The analysis was stopped before this CV.': 'Təhlil bu CV-yə çatmamış dayandırılıb.',
  'Open the vacancy to continue': 'Davam etmək üçün vakansiyanı açın',
  'Hide in CV': 'CV-də gizlət',
  'Show in CV': 'CV-də göstər',
  'Nothing to show in the CV.': 'CV-də göstəriləcək bir şey yoxdur.',
  'Previous CV (K)': 'Əvvəlki CV (K)',
  '‹ Previous CV': '‹ Əvvəlki CV',
  'CV {a} of {b}': 'CV {a} / {b}',
  'Next CV (J)': 'Növbəti CV (J)',
  'Next CV ›': 'Növbəti CV ›',
  'CV {a} of {b}: {name}': 'CV {a} / {b}: {name}',
  Analysis: 'Təhlil',
  'Only the first part of this CV is shown.': 'Bu CV-nin yalnız ilk hissəsi göstərilir.',
  'The pages of this Word file are being prepared. They appear here by themselves; the text below was read from the file.':
    'Bu Word faylının səhifələri hazırlanır. Onlar burada özü görünəcək; aşağıdakı mətn fayldan oxunub.',
  'These pages were made from the Word file, so the layout can differ a little.':
    'Bu səhifələr Word faylından hazırlanıb, ona görə düzülüş bir qədər fərqli ola bilər.',
};
