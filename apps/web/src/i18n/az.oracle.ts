/**
 * Stage 3, Oracle import and bulk upload (plan 16.4, the Wording table): English sentence -> Azerbaijani.
 * Every line is taken word for word from the Wording table. Lines marked [check] there wait for the
 * native reviewer (check C1); they are listed in docs/stage-3/az-review.md.
 */
export const AZ_ORACLE: Record<string, string> = {
  // admin.title
  'Oracle import': 'Oracle idxalı',
  // admin.unavailable
  'Oracle import is not available in this environment.': 'Oracle idxalı bu mühitdə əlçatan deyil.',
  // admin.state.not_connected
  'Not connected': 'Qoşulmayıb',
  // admin.state.off
  Off: 'Söndürülüb',
  // admin.intro
  'Connect once. Recruiters can then bring the CVs of an Oracle vacancy into a vacancy here.':
    'Bir dəfə qoşulun. Bundan sonra işə götürənlər Oracle vakansiyasının CV-lərini buradakı vakansiyaya gətirə bilər.',
  // admin.address
  'Oracle API address': 'Oracle API ünvanı',
  // admin.address.hint
  'Paste the address of your Oracle site. A full link is fine: only the address is kept.':
    'Oracle saytınızın ünvanını yapışdırın. Tam link də olar: yalnız ünvan saxlanılır.',
  // admin.address.example
  'Example: {example}': 'Nümunə: {example}',
  // admin.user
  'User name': 'İstifadəçi adı',
  // admin.account.hint
  'The Oracle account made for this connection. The password is encrypted on the server and never shown again.':
    'Bu bağlantı üçün yaradılmış Oracle hesabı. Parol serverdə şifrələnir və bir daha göstərilmir.',
  // admin.password.saved_hint
  'A password is saved. Leave empty to keep it.':
    'Parol saxlanılıb. Onu saxlamaq üçün boş buraxın.',
  // admin.notice_box
  'Applicants on our Oracle career site are told that AI assists screening.':
    'Oracle karyera saytımızda müraciət edənlərə müraciətlərin yoxlanılmasında süni intellektin kömək etdiyi bildirilir.',
  // admin.activate
  Activate: 'Aktivləşdirin',
  // admin.activating
  'Activating…': 'Aktivləşdirilir…',
  // admin.advanced
  Advanced: 'Əlavə ayarlar',
  // admin.need.address
  'Paste the Oracle API address.': 'Oracle API ünvanını yapışdırın.',
  // admin.need.user
  'Type the user name.': 'İstifadəçi adını yazın.',
  // admin.need.password
  'Type the password.': 'Parolu yazın.',
  // admin.need.notice_box
  'Tick the box to confirm that applicants are told.':
    'Müraciət edənlərə bildirildiyini təsdiqləmək üçün qutunu işarələyin.',
  // result.ok
  'Active. Signed in to Oracle, and the account can see vacancies.':
    'Aktivdir. Oracle-a giriş alındı və hesab vakansiyaları görür.',
  // result.auth_failed
  'Sign-in failed. Oracle did not accept this user name and password.':
    'Giriş alınmadı. Oracle bu istifadəçi adını və parolu qəbul etmədi.',
  // result.empty_scope
  'Connected, but this account sees no vacancies. Ask the Oracle team to give it access to Recruiting, then try again.':
    'Qoşuldu, amma bu hesab heç bir vakansiya görmür. Oracle komandasından hesaba Recruiting üzrə icazə verməsini xahiş edin, sonra yenidən cəhd edin.',
  // result.unreachable
  'The address could not be reached. Check it and try again.':
    'Ünvana qoşulmaq alınmadı. Onu yoxlayın və yenidən cəhd edin.',
  // result.not_oracle_address
  'This is not an Oracle address. It must start with https:// and end in {suffix}.':
    'Bu, Oracle ünvanı deyil. Ünvan https:// ilə başlamalı və {suffix} ilə bitməlidir.',
  // admin.status.since
  'Active since {when}': '{when} tarixindən aktivdir',
  // admin.status.check_ok
  'Last check OK, {when}': 'Son yoxlama uğurlu oldu, {when}',
  // admin.status.check_failed
  'Last check failed, {when}. New imports wait until this is fixed.':
    'Son yoxlama alınmadı, {when}. Bu düzələnə qədər yeni idxal başlamır.',
  // admin.row.address
  Address: 'Ünvan',
  // admin.row.password_saved
  'password saved {when}': 'parol saxlanılıb: {when}',
  // admin.row.notice
  Notice: 'Bildiriş',
  // admin.row.notice_by
  'confirmed by {name}, {when} · covers applications from {date}':
    '{name} təsdiqləyib, {when} · {date} tarixindən sonrakı müraciətlərə aiddir',
  // admin.row.notice_all
  'confirmed by {name}, {when} · covers every application':
    '{name} təsdiqləyib, {when} · bütün müraciətlərə aiddir',
  // admin.test
  'Test again': 'Yenidən yoxlayın',
  // admin.testing
  'Testing…': 'Yoxlanılır…',
  // admin.replace
  'Replace password': 'Parolu dəyişin',
  // admin.save_test
  'Save and test': 'Yadda saxlayın və yoxlayın',
  // admin.replace.hint
  'The new password is tested first. The saved one stays in use unless the test passes.':
    'Yeni parol əvvəlcə yoxlanılır. Yoxlama uğurlu olmasa, saxlanılmış parol istifadədə qalır.',
  // admin.off.confirm
  'Turn off the Oracle import? Imports that are running are cancelled. CVs already imported stay.':
    'Oracle idxalı söndürülsün? Davam edən idxallar ləğv olunur. Artıq idxal edilmiş CV-lər qalır.',
  // admin.off.done
  'Turned off. Recruiters no longer see the Oracle field.':
    'Söndürüldü. İşə götürənlər artıq Oracle sahəsini görmür.',
  // refusal.test_limit
  'You can test once every 5 minutes. Try again shortly.':
    'Yoxlamanı 5 dəqiqədə bir dəfə etmək olar. Bir azdan yenidən cəhd edin.',
  // admin.expiry.field
  'Password expires on': 'Parolun bitmə tarixi',
  // admin.expiry.hint
  'Optional. A reminder shows on this card from 14 days before that date.':
    'Məcburi deyil. Bu tarixdən 14 gün əvvəl bu kartda xatırlatma görünür.',
  // admin.expiry.soon
  'The Oracle password expires on {date}. Replace it before then.':
    'Oracle parolunun müddəti {date} tarixində bitir. Ondan əvvəl dəyişin.',
  // admin.expiry.passed
  'The Oracle password expired on {date}. Replace it now.':
    'Oracle parolunun müddəti {date} tarixində bitib. Onu indi dəyişin.',
  // runs.heading
  Imports: 'İdxallar',
  // runs.empty
  'No imports yet.': 'Hələ idxal olmayıb.',
  // runs.col.started_by
  'Started by': 'Başladan',
  // runs.col.state
  State: 'Vəziyyət',
  // runs.col.step
  Step: 'Mərhələ',
  // runs.col.counts
  Counts: 'Saylar',
  // runs.col.progress
  'Last progress': 'Son irəliləyiş',
  // runs.col.started
  Started: 'Başlama vaxtı',
  // runs.col.reason
  Reason: 'Səbəb',
  // runs.state.queued
  Queued: 'Növbədədir',
  // runs.state.running
  Running: 'İcra olunur',
  // runs.state.awaiting_confirm
  'Waiting for the recruiter': 'İşə götürənin cavabı gözlənilir',
  // runs.state.completed
  Completed: 'Tamamlanıb',
  // runs.step.listing
  'Reading the list': 'Siyahı oxunur',
  // runs.step.fetching
  'Fetching CVs': 'CV-lər gətirilir',
  // runs.counts
  '{listed} listed · {fetched} fetched': 'Siyahıda: {listed} · Gətirilib: {fetched}',
  // runs.stalled
  'No progress for {n} minutes': '{n} dəqiqədir irəliləyiş yoxdur',
  // runs.abandon
  Abandon: 'Dayandırın',
  // runs.abandon.confirm
  'Abandon this import? CVs already copied stay. The recruiter can press Refresh to fetch the rest.':
    'Bu idxal dayandırılsın? Artıq köçürülmüş CV-lər qalır. İşə götürən qalanlarını gətirmək üçün “Yeniləyin” düyməsini basa bilər.',
  // link.heading
  'Or bring them from Oracle': 'Və ya Oracle-dan gətirin',
  // link.field
  'Oracle vacancy ID': 'Oracle vakansiya nömrəsi',
  // link.hint
  'The number of the vacancy in Oracle Recruiting.': 'Vakansiyanın Oracle Recruiting-dəki nömrəsi.',
  // link.button
  'Import CVs from Oracle': 'CV-ləri Oracle-dan idxal edin',
  // link.looking
  'Looking in Oracle…': 'Oracle-da axtarılır…',
  // link.need.id
  'Type the Oracle vacancy ID.': 'Oracle vakansiya nömrəsini yazın.',
  // link.linked.id
  'Oracle vacancy ID {ref}': 'Oracle vakansiya nömrəsi: {ref}',
  // link.linked.by
  'linked {when} by {name}': 'əlaqələndirilib: {when}, {name}',
  // link.unlink
  Unlink: 'Əlaqəni silin',
  // link.unlink.confirm
  'Unlink Oracle vacancy {ref}? CVs already imported stay in this vacancy.':
    'Oracle vakansiyası {ref} ilə əlaqə silinsin? Artıq idxal edilmiş CV-lər bu vakansiyada qalır.',
  // link.unlink.ask_lead
  'To change it now, ask a team lead.': 'İndi onu dəyişmək üçün komanda rəhbərinə deyin.',
  // link.needs_approval
  'The link must be approved by a team lead.': 'Əlaqəni komanda rəhbəri təsdiqləməlidir.',
  // dialog.title
  'Import CVs from Oracle?': 'CV-lər Oracle-dan idxal edilsin?',
  // dialog.title.refresh
  'Refresh from Oracle?': 'Oracle-dan yenilənsin?',
  // dialog.text
  'About {n} applications. Their CVs will be copied and analyzed by AI. Room for {r}.':
    'Təxminən {n} müraciət. Onların CV-ləri köçürüləcək və süni intellektlə təhlil olunacaq. {r} CV üçün yer var.',
  // dialog.text.refresh
  'About {n} applications in Oracle now. New CVs will be copied and analyzed by AI; CVs already here are not copied again. Room for {r}.':
    'Hazırda Oracle-da təxminən {n} müraciət var. Yeni CV-lər köçürüləcək və süni intellektlə təhlil olunacaq; burada olan CV-lər yenidən köçürülmür. {r} CV üçün yer var.',
  // dialog.oldest_first
  'More applications than fit: the oldest come first.':
    'Müraciətlər yerdən çoxdur: ən köhnə müraciətlər birinci götürülür.',
  // dialog.start
  Start: 'Başlayın',
  // strip.title
  'Oracle vacancy {ref}': 'Oracle vakansiyası {ref}',
  // strip.state.importing
  Importing: 'İdxal gedir',
  // strip.state.waiting
  'Waiting for you': 'Cavabınız gözlənilir',
  // strip.listing
  'Reading the application list from Oracle… {n} read so far.':
    'Oracle-dan müraciətlərin siyahısı oxunur… İndiyədək {n} oxunub.',
  // strip.leave
  'You can leave this page. The import continues.':
    'Bu səhifədən çıxa bilərsiniz. İdxal davam edir.',
  // stop.import
  'Cancel import': 'İdxalı ləğv edin',
  // strip.fetched
  'Fetched {sent} of {total}': 'Gətirildi: {sent} / {total}',
  // wait.oracle_unavailable
  'Oracle is not answering. The import waits and tries again by itself.':
    'Oracle cavab vermir. İdxal gözləyir və özü yenidən cəhd edəcək.',
  // wait.capacity_unavailable
  'The service is busy. The import waits and goes on by itself.':
    'Xidmət yüklüdür. İdxal gözləyir və özü davam edəcək.',
  // wait.storage_low
  'Storage room is low. The import waits and tries again by itself.':
    'Yaddaşda yer azdır. İdxal gözləyir və özü yenidən cəhd edəcək.',
  // wait.oracle_budget
  "Today's limit of calls to Oracle is used up. The import waits and goes on by itself tomorrow.":
    'Oracle-a bu günkü sorğu limiti bitib. İdxal gözləyir və sabah özü davam edəcək.',
  // wait.unknown
  'The import is waiting. It goes on by itself.': 'İdxal gözləyir. Özü davam edəcək.',
  // pause.above_estimate
  'Oracle has more applications than the estimate you confirmed (about {n}). Nothing is copied yet.':
    'Oracle-da təsdiqlədiyiniz təxmindən (təxminən {n}) çox müraciət var. Hələ heç nə köçürülməyib.',
  // pause.above_room
  'There are more new CVs than this vacancy has room for. Nothing is copied yet.':
    'Yeni CV-lər bu vakansiyadakı yerdən çoxdur. Hələ heç nə köçürülməyib.',
  // count.in_oracle
  '{n} applications in Oracle': 'Oracle-da {n} müraciət',
  // count.new
  '{n} new CVs': '{n} yeni CV',
  // count.copied
  '{n} CVs copied': '{n} CV köçürüldü',
  // count.already
  '{n} already here': '{n} artıq buradadır',
  // count.withheld
  '{n} erased earlier, not brought back': '{n} əvvəllər silinib, geri gətirilmir',
  // count.left_out
  '{n} left out: not active, or applied before the AI notice date':
    '{n} kənarda qaldı: aktiv deyil və ya süni intellekt bildirişinin tarixindən əvvəl müraciət edib',
  // count.left_out.internal
  '{n} left out: not active, an internal applicant, or applied before the AI notice date':
    '{n} kənarda qaldı: aktiv deyil, daxili namizəddir və ya süni intellekt bildirişinin tarixindən əvvəl müraciət edib',
  // count.no_file
  '{n} without a CV file': '{n} müraciətdə CV faylı yoxdur',
  // count.not_copied
  '{n} not copied (see the report)': '{n} köçürülmədi (hesabata baxın)',
  // pause.room
  'Room for {r}. The oldest applications come first; {n} will not fit.':
    '{r} CV üçün yer var. Ən köhnə müraciətlər birinci götürülür; {n} CV sığmayacaq.',
  // pause.room_fits
  'Room for {r}.': '{r} CV üçün yer var.',
  // pause.deadline
  'If nobody answers by {time}, the import is cancelled and nothing is copied.':
    'Saat {time} olana qədər cavab verilməsə, idxal ləğv olunur və heç nə köçürülmür.',
  // pause.continue
  Continue: 'Davam edin',
  // strip.last_refreshed
  'Last refreshed {when} by {name}': 'Son yeniləmə: {when}, {name}',
  // strip.counts_heading
  '{copied} CVs copied of {total} applications': '{total} müraciətdən {copied} CV köçürüldü',
  // strip.reminder
  'Last refreshed {n} days ago. Refresh to see who has applied or withdrawn since.':
    'Son yeniləmədən {n} gün keçib. O vaxtdan kimin müraciət etdiyini və ya müraciətini geri götürdüyünü görmək üçün yeniləyin.',
  // strip.gone
  '{n} imported applicants are no longer active in Oracle.':
    'İdxal edilmiş {n} namizəd artıq Oracle-da aktiv deyil.',
  // empty.no_applications
  'Oracle shows no applications for this vacancy. If you expect some, ask an administrator to check what the Oracle account is allowed to see.':
    'Oracle bu vakansiya üzrə heç bir müraciət göstərmir. Müraciət olmalıdırsa, administratordan Oracle hesabının nələri görə bildiyini yoxlamağı xahiş edin.',
  // empty.no_cv_file
  'Oracle has {n} applications for this vacancy, but none has a CV file that can be read here. The CV may be only on the candidate profile in Oracle.':
    'Oracle-da bu vakansiya üzrə {n} müraciət var, amma heç birində burada oxuna bilən CV faylı yoxdur. CV yalnız namizədin Oracle profilində ola bilər.',
  // empty.nothing_new
  'Nothing new in Oracle since the last refresh.':
    'Son yeniləmədən bəri Oracle-da yeni heç nə yoxdur.',
  // cancel.confirm
  'Cancel the import? CVs already copied stay and are analyzed. The rest are not copied.':
    'İdxal ləğv edilsin? Artıq köçürülmüş CV-lər qalır və təhlil olunur. Qalanları köçürülmür.',
  // cancel.keep
  'Keep importing': 'İdxala davam edin',
  // cancel.done
  'Import cancelled.': 'İdxal ləğv edildi.',
  // strip.copied_before
  '{n} CVs were copied before that.': 'Ondan əvvəl {n} CV köçürülmüşdü.',
  // strip.archived
  'The import stopped because the vacancy was archived. Restore the vacancy, then refresh.':
    'Vakansiya arxivə salındığı üçün idxal dayandı. Vakansiyanı bərpa edin, sonra yeniləyin.',
  // run_error.oracle_unavailable
  'Oracle did not answer for 2 hours, so the import stopped. Try Refresh later.':
    'Oracle 2 saat cavab vermədi, ona görə idxal dayandı. Sonra yenidən yeniləyin.',
  // run_error.sign_in
  'Sign-in to Oracle failed, so the import stopped. Ask an administrator to check the Oracle connection.':
    'Oracle-a giriş alınmadı, ona görə idxal dayandı. Administratordan Oracle bağlantısını yoxlamağı xahiş edin.',
  // run_error.storage_low
  'There is not enough storage room for these CVs, so nothing was copied. Tell an administrator.':
    'Bu CV-lər üçün yaddaşda kifayət qədər yer yoxdur, ona görə heç nə köçürülmədi. Administratora bildirin.',
  // run_error.capacity_unavailable
  'The service was too busy for 2 hours, so the import stopped. Try Refresh later.':
    'Xidmət 2 saat həddən artıq yüklü oldu, ona görə idxal dayandı. Sonra yenidən yeniləyin.',
  // run_error.did_not_finish
  'The import stopped 5 times without moving on. Tell an administrator before you try again.':
    'İdxal irəliləmədən 5 dəfə dayandı. Yenidən cəhd etməzdən əvvəl administratora bildirin.',
  // run_error.not_confirmed
  'Nobody answered within 2 hours, so the import was cancelled. Nothing was copied.':
    '2 saat ərzində cavab verilmədi, ona görə idxal ləğv edildi. Heç nə köçürülmədi.',
  // run_error.vacancy_gone
  'Oracle no longer has this vacancy. Check the ID in Oracle.':
    'Bu vakansiya artıq Oracle-da yoxdur. Nömrəni Oracle-da yoxlayın.',
  // run_error.actor_revoked
  'The import stopped because the person who started it can no longer change this vacancy.':
    'İdxalı başladan şəxs artıq bu vakansiyanı dəyişə bilmədiyi üçün idxal dayandı.',
  // run_error.schema_changed
  'Oracle answered in a form this version does not understand. Tell an administrator.':
    'Oracle bu versiyanın anlamadığı formada cavab verdi. Administratora bildirin.',
  // run_error.switched_off
  'The Oracle import was switched off, so the import was cancelled.':
    'Oracle idxalı söndürüldüyü üçün idxal ləğv edildi.',
  // run_error.abandoned
  'An administrator stopped this import.': 'Bu idxalı administrator dayandırdı.',
  // run_error.unknown
  'The import did not finish. Try Refresh, or tell an administrator.':
    'İdxal başa çatmadı. Yeniləməyə cəhd edin və ya administratora bildirin.',
  // refusal.not_found
  'No Oracle vacancy has this ID. Check the number and try again.':
    'Oracle-da bu nömrə ilə vakansiya yoxdur. Nömrəni yoxlayın və yenidən cəhd edin.',
  // refusal.linked_elsewhere
  'This Oracle vacancy is already linked to another vacancy here.':
    'Bu Oracle vakansiyası artıq buradakı başqa vakansiya ilə əlaqələndirilib.',
  // refusal.lookup_limit
  'Too many lookups. Wait a minute and try again.':
    'Çox axtarış edildi. Bir dəqiqə gözləyin və yenidən cəhd edin.',
  // refusal.oracle_down
  'Oracle is not answering. Try again in a few minutes.':
    'Oracle cavab vermir. Bir neçə dəqiqədən sonra yenidən cəhd edin.',
  // refusal.sign_in
  'Sign-in to Oracle failed. Ask an administrator to check the Oracle connection.':
    'Oracle-a giriş alınmadı. Administratordan Oracle bağlantısını yoxlamağı xahiş edin.',
  // refusal.not_active
  'The Oracle import is switched off. Tell an administrator.':
    'Oracle idxalı söndürülüb. Administratora bildirin.',
  // refusal.retention_off
  'Automatic erasing of old CVs is off. An administrator must turn it on under Data retention before CVs can be imported.':
    'Köhnə CV-lərin avtomatik silinməsi söndürülüb. CV-ləri idxal etməzdən əvvəl administrator onu “Məlumatın saxlanma müddəti” bölməsində aktiv etməlidir.',
  // refusal.too_soon
  'You can refresh again at {time}.': 'Saat {time} olanda yenidən yeniləyə bilərsiniz.',
  // refusal.already_running
  'An import is already running for this vacancy.': 'Bu vakansiya üçün idxal artıq davam edir.',
  // refusal.notice_missing
  'An administrator has not yet confirmed that Oracle applicants are told about AI.':
    'Administrator Oracle üzrə müraciət edənlərə süni intellekt barədə bildirildiyini hələ təsdiqləməyib.',
  // refusal.budget
  "Today's limit of calls to Oracle is used up. Try again tomorrow.":
    'Oracle-a bu günkü sorğu limiti bitib. Sabah yenidən cəhd edin.',
  // refusal.ai_not_eu
  'CVs from Oracle can be analyzed only by an AI model hosted in the EU. Ask an administrator to check AI models.':
    'Oracle-dan gələn CV-lər yalnız Aİ-də yerləşən süni intellekt modeli ilə təhlil oluna bilər. Administratordan “Süni intellekt modelləri” bölməsini yoxlamağı xahiş edin.',
  // batch.heading
  'Latest import from Oracle': 'Oracle-dan son idxal',
  // batch.waiting
  'Fetching CVs from Oracle: {sent} of {total}. You can leave this page: the import continues.':
    'CV-lər Oracle-dan gətirilir: {sent} / {total}. Bu səhifədən çıxa bilərsiniz: idxal davam edir.',
  // batch.details_heading
  'Applications in this import': 'Bu idxaldakı müraciətlər',
  // batch.row
  'Oracle application {n}': 'Oracle müraciəti {n}',
  // batch.row.waiting
  'Waiting to be fetched': 'Gətirilməsi gözlənilir',
  // status.not_fetched
  'Not fetched': 'Gətirilmədi',
  // status.cancelled
  Cancelled: 'Ləğv edilib',
  // code.source_unavailable
  'Oracle did not answer': 'Oracle cavab vermədi',
  // code.source_gone
  'No longer in Oracle': 'Artıq Oracle-da yoxdur',
  // code.superseded
  'Replaced by a newer import': 'Daha yeni idxalla əvəz olunub',
  // code.crash_limit
  'Failed twice, so it was left out': 'İki dəfə alınmadı, ona görə kənarda qaldı',
  // admin.adv.heading
  'Optional settings': 'Məcburi olmayan ayarlar',
  // admin.adv.sign_in
  'Sign-in method': 'Giriş üsulu',
  // admin.adv.sign_in.password
  'User name and password': 'İstifadəçi adı və parol',
  // admin.adv.sign_in.oauth
  'OAuth (client ID and secret)': 'OAuth (müştəri ID-si və gizli açar)',
  // admin.adv.token_address
  'Token address': 'Token ünvanı',
  // admin.adv.client_id
  'Client ID': 'Müştəri ID-si (Client ID)',
  // admin.adv.client_secret
  'Client secret': 'Gizli açar (Client secret)',
  // admin.adv.categories
  'Oracle file categories that count as a CV (separate with commas)':
    'CV sayılan Oracle fayl kateqoriyaları (vergüllə ayırın)',
  // admin.adv.link_policy
  'A team lead approves each link': 'Hər əlaqəni komanda rəhbəri təsdiqləyir',
  // admin.adv.require_eu_ai
  'Only use an AI company that processes in the EU':
    'Yalnız məlumatı Aİ-də emal edən süni intellekt şirkətindən istifadə edin',
  // admin.adv.require_eu_ai.hint
  'The data protection officer (DPO) decides this. Every change is recorded.':
    'Bu barədə qərarı məlumatların mühafizəsi üzrə məsul şəxs (DPO) verir. Hər dəyişiklik qeydə alınır.',
  // admin.adv.gone
  'When an applicant is gone from Oracle': 'Namizəd artıq Oracle-da olmadıqda',
  // admin.adv.gone.flag
  'Flag for review': 'Baxış üçün işarələyin',
  // admin.adv.gone.erase
  'Erase the CV here': 'Buradakı CV-ni silin',
  // admin.adv.save
  Save: 'Yadda saxlayın',
  // Server sentences outside the table (same style).
  'Fill in every field.': 'Bütün sahələri doldurun.',
  'Activate first.': 'Əvvəlcə aktivləşdirin.',
  'This import is not waiting for you.': 'Bu idxal sizin cavabınızı gözləmir.',
};
