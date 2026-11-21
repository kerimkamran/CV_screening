/**
 * Stage 2 strings (new and renamed). Spread LAST in az.ts, so where a sentence also exists in an
 * older file this wording wins. Azerbaijani wording here still needs the native review (S2-FE15).
 */
export const AZ_STAGE2: Record<string, string> = {
  'CV pages': 'CV səhifələri',
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
  'Too many files in the ZIP': 'ZIP-də fayl sayı həddi aşır',
  'Over the size limit': 'Ölçü həddini aşır',
  'The ZIP is larger than the limit': 'ZIP həddən böyükdür',
  "Couldn't open this ZIP file": 'Bu ZIP faylı açıla bilmədi',
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
  'Add a ZIP': 'ZIP əlavə edin',
  'Add at least one CV.': 'Ən azı bir CV əlavə edin.',
  'All files are sent. You can close this page: {assistant} keeps reading.':
    'Bütün fayllar göndərildi. Bu səhifəni bağlaya bilərsən: {assistant} oxumağa davam edir.',
  'All ready': 'Hamısı hazırdır',
  'All {n}': 'Hamısı {n}',
  'All {n} CVs are ready, {name}. Enjoy your coffee.':
    '{name}, bütün {n} CV hazırdır. Qəhvənin dadını çıxarın.',
  'All {n} CVs are ready. Enjoy your coffee.': 'Bütün {n} CV hazırdır. Qəhvənin dadını çıxarın.',
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
  'Go grab a coffee and relax.': 'Özünüzə bir qəhvə götürün və dincəlin.',
  'Hey {name}, go grab a coffee and relax.':
    'Salam, {name}! Özünüzə bir qəhvə götürün və dincəlin.',
  'Hey {name}, this only takes a minute or two.': 'Salam, {name}! Bu, bir-iki dəqiqə çəkəcək.',
  'Latest upload': 'Son yükləmə',
  'Latest upload only': 'Yalnız son yükləmə',
  'Needs attention {n}': 'Diqqət tələb edir {n}',
  'No CVs in this vacancy yet.': 'Bu vakansiyada hələ CV yoxdur.',
  'Nothing to show here.': 'Burada göstəriləcək bir şey yoxdur.',
  'Now brewing': 'İndi dəmlənir',
  'Only {room} more CVs fit in this vacancy. The last {n} will not be sent.':
    'Bu vakansiyaya yalnız {room} CV də sığır. Sonuncu {n} göndərilməyəcək.',
  'PDF, DOCX, TXT or MD files, a whole folder, or a ZIP of CVs':
    'PDF, DOCX, TXT və ya MD faylları, bütöv qovluq və ya CV-lərin ZIP faylı',
  'PDF, DOCX, TXT or MD files, or a ZIP of CVs':
    'PDF, DOCX, TXT və ya MD faylları, yaxud CV-lərin ZIP faylı',
  Progress: 'Gedişat',
  'Remove all files that need attention': 'Diqqət tələb edən bütün faylları çıxarın',
  'Retry failed ({n})': 'Uğursuzları təkrarlayın ({n})',
  'See results': 'Nəticələr',
  'See results so far': 'İndiyədək olan nəticələr',
  'Sending files: {sent} of {total}. Keep this page open until they are all sent.':
    'Fayllar göndərilir: {sent} / {total}. Hamısı göndərilənə qədər bu səhifəni açıq saxlayın.',
  'Sent {sent} of {total}': 'Göndərildi: {sent} / {total}',
  'Show all {n} files': 'Bütün {n} faylı göstərin',
  'Show only the files that need attention': 'Yalnız diqqət tələb edən faylları göstərin',
  'Show the waiting screen': 'Gözləmə ekranını göstərin',
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
  '{assistant} is reading your {n} CVs for you.': '{assistant} {n} CV-ni sizin üçün oxuyur.',
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
    'Hələ təhlil olunmuş CV yoxdur. Vakansiyaya CV əlavə edin və “Ən uyğununu tapın” seçin.',
  'Keys: J and K move, S shortlist, M maybe, N not now, Enter opens the CV.':
    'Düymələr: J və K hərəkət edir, S qısa siyahı, M bəlkə, N indi yox, Enter CV-ni açır.',
  Original: 'Orijinal',
  'This CV was erased. Its file and its text are gone.':
    'Bu CV silinib. Faylı və mətni artıq yoxdur.',
  'Show the text instead': 'Əvəzinə mətni göstərin',
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
  Download: 'Yükləyin',
  'Close full screen': 'Tam ekranı bağlayın',
  'Full screen': 'Tam ekran',
  'Open in new tab': 'Yeni vərəqdə açın',
  'This PDF is password-protected, so its pages cannot be shown.':
    'Bu PDF parolla qorunur, ona görə səhifələri göstərilə bilmir.',
  'This PDF could not be shown as pages.': 'Bu PDF səhifələr kimi göstərilə bilmədi.',
  'The original file is no longer available.': 'Orijinal fayl artıq mövcud deyil.',
  'The original cannot be shown as pages.': 'Orijinal səhifələr kimi göstərilə bilmir.',
  'Scanned image without text.': 'Mətnsiz skan edilmiş şəkil.',
  Fit: 'Sığdır',
  'Fit one page to the height': 'Bir səhifəni hündürlüyə sığdırın',
  'The browser blocked the new tab. Use Download instead.':
    'Brauzer yeni vərəqi blokladı. Əvəzində “Yüklə” düyməsindən istifadə edin.',
  'CV view': 'CV görünüşü',
  'This CV is being analyzed.': 'Bu CV təhlil olunur.',
  'The result appears here by itself. You can read the CV meanwhile.':
    'Nəticə burada özü görünəcək. Bu arada CV-ni oxuya bilərsiniz.',
  'The analysis of this CV did not finish.': 'Bu CV-nin təhlili başa çatmadı.',
  'Retrying…': 'Yenidən cəhd edilir…',
  'Retry the analysis': 'Təhlili yenidən cəhd edin',
  'Read the CV and decide yourself.': 'CV-ni oxuyun və özünüz qərar verin.',
  'This vacancy is archived, so decisions are off.':
    'Bu vakansiya arxivdədir, ona görə qərarlar bağlıdır.',
  'Note saved.': 'Qeyd saxlanıldı.',
  'Withdraw consent?': 'Razılıq geri götürülsün?',
  'This deletes what was read from the pages. Withdraw consent?':
    'Bu, səhifələrdən oxunanları silir. Razılığı geri götürürsünüz?',
  'Withdraw consent': 'Razılığı geri götürün',
  'Revoke this link? Everyone who has it loses access at once.':
    'Bu link ləğv edilsin? Ona sahib olan hər kəs girişi dərhal itirir.',
  'Sort the list': 'Siyahını sıralayın',
  ', sorted ascending': ', artan sıra ilə',
  ', sorted descending': ', azalan sıra ilə',
  'Copying did not work. Select the text in the box and copy it.':
    'Kopyalamaq alınmadı. Qutudakı mətni seçib kopyalayın.',
  'The analysis was stopped before this CV.': 'Təhlil bu CV-yə çatmamış dayandırılıb.',
  'Open the vacancy to continue': 'Davam etmək üçün vakansiyanı açın',
  'Hide in CV': 'CV-də gizlədin',
  'Show in CV': 'CV-də göstərin',
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
  'Match {n}%': 'Uyğunluq {n}%',
  'Keys: J and K move, X selects, S shortlist, M maybe, N not now, Enter opens the CV.':
    'Düymələr: J və K hərəkət edir, X seçir, S qısa siyahı, M bəlkə, N indi yox, Enter CV-ni açır.',
  'Preparing…': 'Hazırlanır…',
  'Download CVs': 'CV-ləri endirin',
  'Up to 500 CVs per download. Narrow the list.': 'Bir endirmədə ən çox 500 CV. Siyahını daraldın.',
  // The sentences the server sends when a download is refused (downloads.controller.ts).
  'Up to 500 CVs per download.': 'Bir endirmədə ən çox 500 CV ola bilər.',
  'None of the chosen CVs can be downloaded.':
    'Seçilmiş CV-lərin heç birini endirmək mümkün deyil.',
  'Up to 1 GB per download. Choose fewer CVs.':
    'Bir endirmədə ən çox 1 GB ola bilər. Daha az CV seçin.',
  'All {n} shown are selected.': 'Göstərilən {n} CV-nin hamısı seçilib.',
  'Select all {n} in this list': 'Bu siyahıdakı {n} CV-nin hamısını seçin',
  'All {n} in this list are selected.': 'Bu siyahıdakı {n} CV-nin hamısı seçilib.',
  'Select all': 'Hamısını seçin',
  'Downloading 1 CV ({size}) as one ZIP.': '1 CV ({size}) bir ZIP faylı kimi endirilir.',
  'Downloading {n} CVs ({size}) as one ZIP.': '{n} CV ({size}) bir ZIP faylı kimi endirilir.',
  'the CV was erased': 'CV silinib',
  'not found or not yours to see': 'tapılmadı və ya sizə açıq deyil',
  'a CV': 'bir CV',
  'and {n} more': 'və daha {n}',
  '{n} left out:': '{n} daxil edilmədi:',
  'Where the requirements are in the CV': 'Tələblərin CV-də yeri',
  '{requirement}, page {n}': '{requirement}, səhifə {n}',
  '{n} must-haves were not found in the CV.': '{n} vacib tələb CV-də tapılmadı.',
  '1 must-have was not found in the CV.': '1 vacib tələb CV-də tapılmadı.',
  'Next CV after a key decision': 'Düymə ilə qərardan sonra növbəti CV',
  'That was the last CV in this list.': 'Bu siyahıdakı son CV idi.',
  'No decisions were made with the keys in this review.': 'Bu baxışda düymələrlə qərar verilməyib.',
  'Decided in this review:': 'Bu baxışda verilən qərarlar:',
  'Start again from the first CV': 'Birinci CV-dən yenidən başlayın',

  // Stage 3, bulk-upload hardening (S3-UP-01..09). Wording table of the Stage 3 plan, section 16.4.
  Cancelled: 'Ləğv edilib',
  'One upload takes up to {max} files. The last {n} will not be sent.':
    'Bir yükləməyə ən çox {max} fayl sığır. Sonuncu {n} göndərilməyəcək.',
  'Not in this upload': 'Bu yükləməyə daxil deyil',
  'Started. {sent} files are being sent. {n} were left out.':
    'Başladı. {sent} fayl göndərilir. {n} fayl kənarda qaldı.',
  'about {n} CVs': 'təxminən {n} CV',
  'About {n} CVs chosen; {room} more fit in this vacancy. CVs that do not fit are marked “Vacancy full” after sending.':
    'Təxminən {n} CV seçilib; bu vakansiyaya daha {room} CV sığır. Sığmayan CV-lər göndərildikdən sonra “Vakansiya doludur” kimi işarələnir.',
  'Choose CV files or ZIPs': 'CV fayllarını və ya ZIP-ləri seçin',
  'Stop sending files': 'Göndərməni dayandırın',
  'Sending stopped. {sent} files were sent; {n} were not sent.':
    'Göndərmə dayandırıldı. {sent} fayl göndərildi; {n} fayl göndərilmədi.',
  'Could not tell the server to stop. Try again.':
    'Dayandırma barədə serverə bildirmək alınmadı. Yenidən cəhd edin.',
  'Download report': 'Hesabatı endirin',
  'Download the report of this upload (CSV)': 'Bu yükləmənin hesabatını endirin (CSV)',
  'Stop analysis': 'Təhlili dayandırın',
};
