/** Azerbaijani for the evaluation report, the share panel and the shared report (design spec 6.5, 13). */
export const AZ_REPORT: Record<string, string> = {
  // Report
  'The report could not be prepared. {error}': 'Hesabatı hazırlamaq mümkün olmadı. {error}',
  'Try again': 'Yenidən cəhd edin',
  'Preparing the report…': 'Hesabat hazırlanır…',
  'No resumes yet, so there is nothing to report.':
    'Hələ CV yoxdur, ona görə hesabat üçün heç nə yoxdur.',
  'Read by {provider} ({model}).': 'Oxuyan: {provider} ({model}).',
  'the AI provider': 'süni intellekt provayderi',
  '{n} years': '{n} il',
  'Evaluation report': 'Qiymətləndirmə hesabatı',
  'Report date {date} · {read} read, {scored} scored, {need} need a human look':
    'Hesabat tarixi {date} · {read} oxundu, {scored} qiymətləndirildi, {need} üçün insan baxışı lazımdır',
  '{read} of {total} read, this report will update.':
    '{total} CV-dən {read} oxunub, bu hesabat yenilənəcək.',
  'Stopped at {read} of {total}. Files not read are listed under Data quality.':
    '{total} CV-dən {read} oxunduqdan sonra dayandırıldı. Oxunmayan fayllar “Məlumatın keyfiyyəti” bölməsində göstərilir.',
  'No AI provider is active, so resumes wait in the queue. An administrator can set one up under Admin → AI models.':
    'Aktiv süni intellekt provayderi yoxdur, ona görə CV-lər növbədə gözləyir. Administrator bunu Admin → Süni intellekt modelləri bölməsində quraşdıra bilər.',
  'A shared link is offered when the scan is done. {read} of {total} read so far.':
    'Skan bitəndə paylaşım linki təklif olunur. İndiyədək {total} CV-dən {read} oxunub.',
  'No candidate has been scored yet, so there is nothing to share.':
    'Hələ heç bir namizəd qiymətləndirilməyib, ona görə paylaşmaq üçün heç nə yoxdur.',
  'The role': 'Vakansiya',
  'Must-have ({n})': 'Vacib tələblər ({n})',
  'Nice-to-have ({n})': 'Üstünlüklər ({n})',
  None: 'Yoxdur',
  'Experience asked for: {years}.': 'Tələb olunan təcrübə: {years}.',
  'Not counted: {list}.': 'Nəzərə alınmayanlar: {list}.',
  'Requirements changed during this scan: version {version} was frozen on {date}.':
    'Tələblər bu skan zamanı dəyişdi: {version} versiyası {date} tarixində dondurulub.',
  'How it was scored': 'Necə qiymətləndirildi',
  'Scored against requirements version {version}, frozen {date}.':
    'Qiymətləndirmə tələblərin {version} versiyasına görə aparılıb, {date} tarixində dondurulub.',
  'Scored against requirements version {version}.':
    'Qiymətləndirmə tələblərin {version} versiyasına görə aparılıb.',
  'AI suggests, a human decides.': 'Süni intellekt təklif edir, qərarı insan verir.',
  'A missing must-have lowers the match; it never hides anyone.':
    'Çatışmayan vacib tələb uyğunluğu azaldır, amma heç kimi gizlətmir.',
  'Match bands: Strong 80 and up, Good 70 to 79, Partial 50 to 69, Limited under 50. These cut-offs have not been calibrated yet.':
    'Uyğunluq səviyyələri: Güclü 80 və yuxarı, Yaxşı 70–79, Qismən 50–69, Məhdud 50-dən aşağı. Bu hədlər hələ kalibrlənməyib.',
  'The match': 'Uyğunluq',
  'Candidates by match': 'Uyğunluğa görə namizədlər',
  'No strong match in this batch.': 'Bu dəstdə güclü uyğunluq yoxdur.',
  'Candidates, best match first': 'Namizədlər, ən uyğun olan birinci',
  'No candidate has been scored yet.': 'Hələ heç bir namizəd qiymətləndirilməyib.',
  'No candidate could be scored. See “Not read” below.':
    'Heç bir namizədi qiymətləndirmək mümkün olmadı. Aşağıdakı “Oxunmayanlar” bölməsinə baxın.',
  'Showing all {n} scored': 'Hamısı göstərilir: {n} qiymətləndirilmiş namizəd',
  'Showing {top} of {n} scored': 'Göstərilir: {top} / {n} qiymətləndirilmiş namizəd',
  'Show only the top {top}': 'Yalnız ilk {top} namizədi göstər',
  'Show all {n}': 'Hamısını göstər ({n})',
  'Data quality': 'Məlumatın keyfiyyəti',
  'Every file was read.': 'Bütün fayllar oxunub.',
  'Not read ({n})': 'Oxunmayanlar ({n})',
  'These files were not scored and are not hidden: open the originals to review them.':
    'Bu fayllar qiymətləndirilməyib və gizlədilməyib: onlara baxmaq üçün orijinalları açın.',
  'Changes and decisions': 'Dəyişikliklər və qərarlar',
  'Requirements version {version} frozen on {date}.':
    'Tələblərin {version} versiyası {date} tarixində donduruldu.',
  '{change}, by {by} on {date}.': '{change}, {by} tərəfindən, {date}.',
  'Requirements set back to the original': 'Tələblər ilkin vəziyyətə qaytarıldı',
  '{requirement}: {from} to {to}': '{requirement}: {from} → {to}',
  'The original ranking is available in the app.': 'İlkin sıralamanı tətbiqdə görmək olar.',
  'Recruiter decision, separate from the AI match.':
    'Rekruterin qərarı, süni intellektin uyğunluq qiymətindən ayrıdır.',
  '{name}: {outcome} by {by} on {date} ({reason}).':
    '{name}: {outcome}, qərar verən {by}, {date} ({reason}).',
  '{name}: {outcome} by {by} on {date}.': '{name}: {outcome}, qərar verən {by}, {date}.',
  'Run {id} · scan started {date} · report date {today}':
    'Qiymətləndirmə {id} · skan {date} tarixində başlayıb · hesabat tarixi {today}',
  'prepared for {name}': '{name} üçün hazırlanıb',
  'Candidates appear as numbers; names stay out of the report.':
    'Namizədlər nömrə ilə göstərilir; adlar hesabata daxil edilmir.',
  '{found} of {total} must-haves found': '{total} vacib tələbdən {found} tapıldı',
  Skills: 'Bacarıqlar',
  'Loading the reason…': 'Əsaslandırma yüklənir…',
  'The reason could not be loaded.': 'Əsaslandırmanı yükləmək mümkün olmadı.',
  'For: {requirement}': 'Tələb: {requirement}',
  'page {n}': 'səhifə {n}',
  'Not found in this CV. Searched for: {text}': 'Bu CV-də tapılmadı. Axtarılan: {text}',
  'Hide details': 'Təfərrüatları gizlət',
  'Show details': 'Təfərrüatları göstər',

  // Shared report
  'Preparing your report…': 'Hesabatınız hazırlanır…',
  'This report is no longer available. Ask the recruiter for a new link.':
    'Bu hesabat artıq əlçatan deyil. Rekruterdən yeni link istəyin.',
  'Reports shared with me': 'Mənimlə paylaşılan hesabatlar',
  "You don't have access to this report. Ask the recruiter.":
    'Bu hesabata girişiniz yoxdur. Rekruterdən xahiş edin.',
  'The report could not be opened. {message}': 'Hesabatı açmaq mümkün olmadı. {message}',
  'Shared evaluation report': 'Paylaşılmış qiymətləndirmə hesabatı',
  'Evaluation report · shared with you': 'Qiymətləndirmə hesabatı · sizinlə paylaşılıb',
  'Snapshot of {date} · {read} read, {scored} scored, {need} need a human look':
    '{date} tarixli anlıq görüntü · {read} oxundu, {scored} qiymətləndirildi, {need} üçün insan baxışı lazımdır',
  'Shared by {by} · this link works until {date}':
    'Paylaşan: {by} · bu link {date} tarixinədək işləyir',
  'This is a snapshot, not a live page. Candidate data stays inside Azerconnect Group: please do not forward this report.':
    'Bu, anlıq görüntüdür, canlı səhifə deyil. Namizəd məlumatları Azerconnect Group daxilində qalır: xahiş edirik, bu hesabatı başqasına göndərməyin.',
  'Scores may differ slightly if the screening is run again.':
    'Skrininq yenidən aparılarsa, ballar bir qədər fərqlənə bilər.',
  '{text}, by {by} on {date}.': '{text}, {by} tərəfindən, {date}.',
  '{label}: {outcome} by {by} on {date}.': '{label}: {outcome}, qərar verən {by}, {date}.',
  'Reason: {reason}': 'Səbəb: {reason}',
  'Run {id} · report date {date} · created by {by}.':
    'Qiymətləndirmə {id} · hesabat tarixi {date} · hazırlayan: {by}.',
  'Candidate data stays inside Azerconnect Group.':
    'Namizəd məlumatları Azerconnect Group daxilində qalır.',
  'Real names are shown only for candidates the recruiter showed or shortlisted.':
    'Həqiqi adlar yalnız rekruterin göstərdiyi və ya qısa siyahıya saldığı namizədlər üçün göstərilir.',
  'Quotes from CVs were left out.': 'CV-lərdən sitatlar çıxarılıb.',
  'Score {score} of 100': '100 üzərindən {score} bal',
  'Loading…': 'Yüklənir…',
  'Nothing has been shared with you, or the links have expired. Ask the recruiter for a new link.':
    'Sizinlə heç nə paylaşılmayıb və ya linklərin müddəti bitib. Rekruterdən yeni link istəyin.',
  'Shared by {by} on {date} · works until {until}':
    'Paylaşan: {by}, {date} · {until} tarixinədək işləyir',

  // Share panel
  'Could not copy. Select the link and copy it by hand.':
    'Kopyalamaq mümkün olmadı. Linki seçib əl ilə kopyalayın.',
  'Share this report': 'Bu hesabatı paylaşın',
  Close: 'Bağla',
  'Share as a link': 'Link kimi paylaş',
  'A login-only link to a snapshot taken now. Only the people you name can open it.':
    'İndi çəkilmiş anlıq görüntüyə giriş tələb edən link. Yalnız adını çəkdiyiniz şəxslər aça bilər.',
  'The link is ready. Send it to the people you named; they sign in to open it.':
    'Link hazırdır. Onu adını çəkdiyiniz şəxslərə göndərin; açmaq üçün hesablarına daxil olacaqlar.',
  'Report link': 'Hesabat linki',
  Copied: 'Kopyalandı',
  'Copy link': 'Linki kopyala',
  'Share with someone else': 'Başqası ilə paylaş',
  'Who can open it': 'Kim aça bilər',
  'People with an account. They must sign in.': 'Hesabı olan şəxslər. Daxil olmalıdırlar.',
  'Search by name or e-mail': 'Ad və ya e-poçtla axtarın',
  'Chosen people': 'Seçilmiş şəxslər',
  'Remove {name}': '{name} adlı şəxsi sil',
  'People found': 'Tapılan şəxslər',
  'No one found.': 'Heç kim tapılmadı.',
  'Link works for': 'Linkin müddəti',
  '{n} days': '{n} gün',
  'Include real names, only for candidates you showed or shortlisted.':
    'Həqiqi adları daxil et, yalnız göstərdiyiniz və ya qısa siyahıya saldığınız namizədlər üçün.',
  'Real names will be visible to the people you choose.':
    'Həqiqi adlar seçdiyiniz şəxslərə görünəcək.',
  'Include quotes from the CVs.': 'CV-lərdən sitatları daxil et.',
  'Quotes are text from resumes and count as personal data.':
    'Sitatlar CV-lərdən götürülmüş mətndir və şəxsi məlumat sayılır.',
  'Preparing…': 'Hazırlanır…',
  'Create link': 'Link yarat',
  'Shared so far': 'İndiyədək paylaşılanlar',
  'Snapshot of {date}': '{date} tarixli anlıq görüntü',
  'works until {date}': '{date} tarixinədək işləyir',
  expired: 'müddəti bitib',
  revoked: 'ləğv edilib',
  Revoke: 'Ləğv et',
  'For {names}.': 'Kimlər üçün: {names}.',
  'no one': 'heç kim',
  'Real names included.': 'Həqiqi adlar daxildir.',
  'Pseudonyms only.': 'Yalnız təxəllüslər.',
  'Quotes included.': 'Sitatlar daxildir.',
  'No quotes.': 'Sitat yoxdur.',
  'Opened {n} time': '{n} dəfə açılıb',
  'Opened {n} times': '{n} dəfə açılıb',
  'Not opened yet.': 'Hələ açılmayıb.',
  '{by} {outcome}, {date}': '{by} {outcome}, {date}',

  // Open-log outcomes (ShareReport OUTCOME_TEXT)
  opened: 'açıb',
  'tried to open, not on the list': 'açmağa çalışıb, siyahıda yoxdur',
  'tried to open after it expired': 'müddəti bitdikdən sonra açmağa çalışıb',
  'tried to open after it was revoked': 'ləğv edildikdən sonra açmağa çalışıb',

  // Labels built from constants (BAND_LABEL, KIND_LABEL, OUTCOME, KIND_NAME)
  Strong: 'Güclü',
  Good: 'Yaxşı',
  Partial: 'Qismən',
  Limited: 'Məhdud',
  'Needs a human look': 'İnsan baxışı lazımdır',
  Found: 'Tapıldı',
  'Partly found': 'Qismən tapıldı',
  'Not found': 'Tapılmadı',
  Shortlisted: 'Qısa siyahıya salındı',
  Maybe: 'Bəlkə',
  'Not now': 'İndi yox',
  'Must-have': 'Vacib tələb',
  'Nice-to-have': 'Üstünlük',
  Ignore: 'Nəzərə alınmır',

  // Reasons a file was not read (unreadReason in @cv/shared)
  'Stopped before it was read': 'Oxunmamış dayandırıldı',
  'Scan only: no readable text in the file': 'Yalnız skan: faylda oxunan mətn yoxdur',
  'Damaged or locked file': 'Zədələnmiş və ya kilidli fayl',
  'Could not be scored. Try again from the Table tab':
    'Qiymətləndirmək mümkün olmadı. Cədvəl nişanından yenidən cəhd edin',
  'No readable text in the file': 'Faylda oxunan mətn yoxdur',
};
