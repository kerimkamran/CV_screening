/**
 * Azerbaijani for the Results screen, the candidate card, the candidate page, the requirements
 * drawer, the shortlist export and the band-change lines. Keys are the exact English sentences used
 * in the code; {placeholders} stay unchanged.
 */
export const AZ_RESULTS: Record<string, string> = {
  // Labels used from tables (the extraction test cannot see these)
  Strong: 'Güclü',
  Good: 'Yaxşı',
  Partial: 'Qismən',
  Limited: 'Məhdud',
  'Needs a human look': 'İnsan baxışı lazımdır',
  Found: 'Tapıldı',
  'Partly found': 'Qismən tapıldı',
  'Not found': 'Tapılmadı',
  Shortlisted: 'Qısa siyahıda',
  Maybe: 'Bəlkə',
  'Not now': 'İndi yox',
  Shortlist: 'Qısa siyahıya alın',
  'Must-have': 'Vacib tələb',
  'Nice-to-have': 'Üstünlük',
  Ignore: 'Nəzərə almayın',
  mandatory: 'vacib tələb',
  preferred: 'üstünlük',
  informational: 'məlumat üçün',
  disqualifier: 'kənarlaşdırma qaydası',
  high: 'yüksək',
  medium: 'orta',
  low: 'aşağı',

  // Results
  'Copied.': 'Köçürüldü.',
  'Your browser did not allow copying. Use the CSV instead.':
    'Brauzeriniz köçürməyə icazə vermədi. Əvəzinə CSV faylından istifadə edin.',
  'Back to the original ranking.': 'İlkin sıralamaya qayıdıldı.',
  'Checking what this would change…': 'Bunun nəyi dəyişəcəyi yoxlanılır…',
  'What if “{text}” were nice-to-have: {line} Nothing changes until you choose it below.':
    '“{text}” üstünlük olsaydı: {line} Aşağıda seçməyincə heç nə dəyişmir.',
  'Loading…': 'Yüklənir…',
  'No resumes yet. Start a screening from': 'Hələ CV yoxdur. Skanı buradan başladın:',
  'New screening': 'Yeni skan',
  ', or upload on the Table tab.': ', yaxud Cədvəl bölməsindən yükləyin.',
  'No AI provider is active, so resumes wait in the queue. An administrator can set one up under Admin → AI models.':
    'Aktiv süni intellekt provayderi yoxdur, ona görə CV-lər növbədə gözləyir. Administrator onu Admin → Süni intellekt modelləri bölməsində qura bilər.',
  'Your constellation': 'Sizin bürcünüz',
  'Select a star. Brighter means a better fit.':
    'Ulduz seçin. Daha parlaq ulduz daha yaxşı uyğunluq deməkdir.',
  Requirements: 'Tələblər',
  '({n} changed)': '({n} dəyişdirilib)',
  '{n} resume in this scan': 'Bu skanda {n} CV',
  '{n} resumes in this scan': 'Bu skanda {n} CV',
  '{n} failed (see Table)': '{n} uğursuz oldu (Cədvələ baxın)',
  'The ranking uses your requirement changes ({n}).':
    'Sıralamada tələblərdə etdiyiniz dəyişikliklər nəzərə alınır ({n}).',
  'Back to original': 'İlkin vəziyyətə qayıdın',
  'Sending {sent} of {total} files. You can start looking now: the rest appear here as they are read.':
    'Fayllar göndərilir: {sent} / {total}. İndi baxmağa başlaya bilərsiniz: qalanları oxunduqca burada görünəcək.',
  'Some files could not be sent.': 'Bəzi faylları göndərmək mümkün olmadı.',
  '{read} of {total} read. You can leave this page: the scan continues and is kept in Past scans.':
    'Oxunan: {read} / {total}. Bu səhifədən çıxa bilərsiniz: skan davam edir və Keçmiş skanlarda saxlanılır.',
  'Stop the scan': 'Skanı dayandırın',
  'Resumes read': 'Oxunmuş CV-lər',
  '{ready} ready, {pending} being read, {human} need a look':
    '{ready} hazırdır, {pending} oxunur, {human} üçün baxış lazımdır',
  '{n} skipped,': '{n} fayl buraxıldı,',
  'hide which': 'hansıları gizlədin',
  'see which': 'hansıları göstərin',
  'Stopped at {read} of {total}. What was scored is kept.':
    'Dayandırıldı: {read} / {total}. Qiymətləndirilənlər saxlanılır.',
  'Continue reading the other {n}': 'Qalan {n} CV-nin oxunmasını davam etdirin',
  '{read} read, {scored} scored, {human} need a human look':
    '{read} oxunub, {scored} qiymətləndirilib, {human} üçün insan baxışı lazımdır',
  'Candidates by match': 'Namizədlər uyğunluğa görə',
  'No strong match in this batch. These are the best matches found; none of them reached Strong.':
    'Bu qrupda güclü uyğunluq yoxdur. Bunlar tapılan ən yaxşı uyğunluqlardır; heç biri “Güclü” səviyyəyə çatmadı.',
  'Focus on skills is on.': 'Bacarıqlara fokus rejimi açıqdır.',
  'Names stay hidden unless you reveal one.': 'Siz göstərməyincə adlar gizli qalır.',
  'Turn off': 'Söndürün',
  'Reveal all names': 'Bütün adları göstərin',
  Confirm: 'Təsdiq',
  'Names are hidden to keep the first look about skills. Show all?':
    'İlk baxış bacarıqlara yönəlsin deyə adlar gizlədilib. Hamısı göstərilsin?',
  'Show all': 'Hamısını göstərin',
  Cancel: 'Ləğv edin',
  'Names are hidden on screen, not removed from the file.':
    'Adlar yalnız ekranda gizlədilir, fayldan silinmir.',
  'Want a first look about skills only?':
    'İlk baxışın yalnız bacarıqlara yönəlməsini istəyirsiniz?',
  'Try Focus on skills': 'Bacarıqlara fokus rejimini yoxlayın',
  'My marks': 'İşarələrim',
  '{a} shortlisted · {b} maybe · {c} not now': '{a} qısa siyahıda · {b} bəlkə · {c} indi yox',
  'They never change the match or the order.': 'Onlar uyğunluğu və sıranı heç vaxt dəyişmir.',
  'Copy shortlist': 'Qısa siyahını köçürün',
  'Download CSV': 'CSV yükləyin',
  'Star map': 'Ulduz xəritəsi',
  'Hide star map': 'Ulduz xəritəsini gizlədin',
  'Show star map': 'Ulduz xəritəsini göstərin',
  'Score {n}': 'Bal: {n}',
  'Star map, a picture of the ranked list below. {n} stars, best first:':
    'Ulduz xəritəsi aşağıdakı sıralanmış siyahının şəklidir. {n} ulduz, ən yaxşısı birinci:',
  '; and more': '; və digərləri',
  'Use the arrow keys to move between stars and Enter to select one.':
    'Ulduzlar arasında keçmək üçün ox düymələrindən, seçmək üçün Enter düyməsindən istifadə edin.',
  'Showing top {n} of {total}.': 'Ən yaxşı {n} göstərilir (cəmi {total}).',
  'Show top {n} only': 'Yalnız ən yaxşı {n} göstərin',
  "A star's place on the map has no meaning beyond its rank.":
    'Ulduzun xəritədəki yeri sıradan başqa heç nə bildirmir.',
  Candidates: 'Namizədlər',
  'Show {n} more ({m} not shown)': '{n} daha göstərin ({m} göstərilməyib)',
  'Limited ({n}): fewer of the requirements found. Nobody is rejected.':
    'Məhdud ({n}): tələblərin daha azı tapıldı. Heç kim rədd edilmir.',
  'Missed by one must-have ({n})': 'Bir vacib tələbi ödəməyənlər ({n})',
  'Not found: {text}': 'Tapılmadı: {text}',
  'Needs a human look ({n})': 'İnsan baxışı lazımdır ({n})',
  'These could not be scored. Open the original and read it yourself.':
    'Bunları qiymətləndirmək mümkün olmadı. Orijinalı açıb özünüz oxuyun.',
  'screening failed': 'yoxlama alınmadı',
  'a knockout rule matched': 'kənarlaşdırma qaydası işlədi',
  'no readable text': 'oxunaqlı mətn yoxdur',
  Open: 'Açın',
  'Retry on the Table tab': 'Cədvəl bölməsində yenidən cəhd edin',

  // Candidate card
  'My mark: {mark}': 'Mənim işarəm: {mark}',
  'Hide name': 'Adı gizlədin',
  'Reveal name': 'Adı göstərin',
  'Score {n} of 100. A sorting aid, not a decision.':
    'Bal: 100 üzərindən {n}. Bu, yalnız çeşidləmə üçün köməkdir, qərar deyil.',
  '{text}: {kind}. Show the proof': '{text}: {kind}. Sübutu göstərin',
  'Loading the reasons…': 'Səbəblər yüklənir…',
  'The reasons could not be loaded.': 'Səbəbləri yükləmək mümkün olmadı.',
  Why: 'Səbəb',
  'Proof for {text}': 'Sübut: {text}',
  'page {n}': 'səhifə {n}',
  'Not found in this CV. Searched for: {text}.': 'Bu CV-də tapılmadı. Axtarılan: {text}.',
  'No quote was kept for this requirement.': 'Bu tələb üçün sitat saxlanılmayıb.',
  'Ask {name} about this candidate': 'Bu namizəd barədə soruşun: {name}',
  'Open the full review and record a decision': 'Tam baxışı açın və qərar qeyd edin',
  'My mark (separate from the AI match)': 'Mənim işarəm (süni intellektin uyğunluğundan ayrıdır)',
  'Now:': 'İndi:',
  'Choose a mark': 'İşarə seçin',
  'One line, in your words': 'Öz sözlərinizlə bir sətir',
  'Why? At least 10 characters': 'Niyə? Ən azı 10 simvol',
  'I looked at the evidence, not only the band. "Not now" never hides this person.':
    'Yalnız səviyyəyə yox, sübuta da baxdım. “İndi yox” bu şəxsi heç vaxt gizlətmir.',
  'Save my mark': 'İşarəmi saxlayın',

  // Candidate page
  '← Back to results': '← Nəticələrə qayıdın',
  'uses your requirement changes': 'tələblərdə etdiyiniz dəyişikliklər nəzərə alınır',
  'uploaded {when}': 'yüklənib: {when}',
  'Name and email were extracted by the AI and may be wrong.':
    'Ad və e-poçt süni intellekt tərəfindən çıxarılıb və yanlış ola bilər.',
  'The name is hidden to keep the first look about skills.':
    'İlk baxış bacarıqlara yönəlsin deyə ad gizlədilib.',
  'Download original': 'Orijinalı yükləyin',
  'This candidate’s data has been erased. Only the decision record remains.':
    'Bu namizədin məlumatları silinib. Yalnız qərar qeydi qalıb.',
  'Screening failed: {error}': 'Yoxlama alınmadı: {error}',
  'No readable text could be extracted from this file (it may be a scan). Open the original and review it yourself; you can still record a decision.':
    'Bu fayldan oxunaqlı mətn çıxarmaq mümkün olmadı (skan ola bilər). Orijinalı açıb özünüz baxın; yenə də qərar qeyd edə bilərsiniz.',
  'Screening is still running. Refresh in a moment.':
    'Yoxlama hələ davam edir. Bir azdan səhifəni yeniləyin.',
  'Knockout rule matched.': 'Kənarlaşdırma qaydası işlədi.',
  'This CV was routed to you for review; nothing was rejected automatically.':
    'Bu CV baxış üçün sizə yönləndirildi; heç nə avtomatik rədd edilmədi.',
  'none of: {terms} found': 'bunlardan heç biri tapılmadı: {terms}',
  'found: {terms}': 'tapıldı: {terms}',
  'This CV contains text that looks like instructions to an AI. It has been routed to you for review. Read the original carefully.':
    'Bu CV-də süni intellektə verilən göstərişlərə bənzər mətn var. O, baxış üçün sizə yönləndirilib. Orijinalı diqqətlə oxuyun.',
  'AI summary': 'Süni intellektin xülasəsi',
  'Generated by {provider} / {model}. Check it against the CV.':
    'Hazırlayan: {provider} / {model}. CV ilə tutuşdurub yoxlayın.',
  'Criteria assessment (version {n})': 'Meyarlar üzrə qiymətləndirmə (versiya {n})',
  'weight {n}': 'çəki {n}',
  'AI confidence {level}': 'süni intellektin əminliyi: {level}',
  'The AI cited {n} quote(s) that do not appear in the CV; they were discarded.':
    'Süni intellekt CV-də olmayan {n} sitat göstərdi; onlar atıldı.',
  'How the score was calculated ({n} of 100, a sorting aid)':
    'Balın necə hesablandığı (100 üzərindən {n}, çeşidləmə üçün köməkdir)',
  'Score breakdown': 'Balın tərkibi',
  Criterion: 'Meyar',
  Weight: 'Çəki',
  Status: 'Vəziyyət',
  Points: 'Xal',
  Total: 'Cəmi',
  'CV text': 'CV mətni',
  'Focus on skills is on. The full text can carry names and personal details, so it waits behind a click. The proof for each requirement is shown on the left.':
    'Bacarıqlara fokus rejimi açıqdır. Tam mətndə ad və şəxsi məlumatlar ola bilər, ona görə o, bir kliklə açılır. Hər tələb üçün sübut solda göstərilir.',
  'Show the CV text': 'CV mətnini göstərin',
  'CV text (evidence highlighted)': 'CV mətni (sübutlar rənglə seçilib)',
  'This CV is very long; only the first part was read. Check the original.':
    'Bu CV çox uzundur; yalnız ilk hissəsi oxunub. Orijinalı yoxlayın.',
  'My mark': 'Mənim işarəm',
  'The match and the order are a recommendation. Only you decide, and your mark and note are recorded under your name. A mark never changes the match.':
    'Uyğunluq və sıra yalnız tövsiyədir. Qərarı yalnız siz verirsiniz; işarəniz və qeydiniz sizin adınızla saxlanılır. İşarə uyğunluğu heç vaxt dəyişmir.',
  'History ({n})': 'Tarixçə ({n})',
  'Erase this candidate’s file, extracted text and AI-extracted details? This cannot be undone. The decision record is kept.':
    'Bu namizədin faylı, çıxarılmış mətni və süni intellektin çıxardığı məlumatlar silinsin? Bu əməliyyatı geri qaytarmaq olmaz. Qərar qeydi saxlanılır.',
  'Erase candidate data': 'Namizəd məlumatlarını silin',

  // Requirements drawer
  'No changes since the first scan.': 'İlk skandan bəri dəyişiklik yoxdur.',
  '{n} change since the first scan.': 'İlk skandan bəri {n} dəyişiklik.',
  '{n} changes since the first scan.': 'İlk skandan bəri {n} dəyişiklik.',
  Close: 'Bağlayın',
  'Change what counts and the list re-ranks. No resume is read again. A missing must-have lowers the match; it never hides anyone.':
    'Nəyin vacib olduğunu dəyişin, siyahı yenidən sıralanacaq. Heç bir CV təkrar oxunmur. Çatışmayan vacib tələb uyğunluğu azaldır, amma heç kimi gizlətmir.',
  'changed (was {kind})': 'dəyişdirilib (əvvəl: {kind})',
  'Knockout rules ({n}) are not changed here. They only send a CV to a human look.':
    'Kənarlaşdırma qaydaları ({n}) burada dəyişdirilmir. Onlar CV-ni yalnız insan baxışına göndərir.',
  'History of changes': 'Dəyişikliklərin tarixçəsi',
  History: 'Tarixçə',
  '{requirement}: {from} to {to}': '{requirement}: {from} → {to}',

  // Shortlist export and band moves
  '{found} of {total}': '{found} / {total}',
  '{i}. {name} ({band}, must-haves found {found}) {note}':
    '{i}. {name} ({band}, tapılan vacib tələblər: {found}) {note}',
  Candidate: 'Namizəd',
  Match: 'Uyğunluq',
  'Must-haves found': 'Tapılan vacib tələblər',
  'My note': 'Qeydim',
  '{from} to {to}': '{from} → {to}',
  'No candidate changed band. The order may have changed.':
    'Heç bir namizədin səviyyəsi dəyişmədi. Sıra dəyişmiş ola bilər.',
  '{n} from {move}': '{n} nəfər ({move})',
  '{n} candidate changed band: {moves}.': '{n} namizədin səviyyəsi dəyişdi: {moves}.',
  '{n} candidates changed band: {moves}.': '{n} namizədin səviyyəsi dəyişdi: {moves}.',
};
