/**
 * Azerbaijani text for the administration pages: Users, AI models, SenAI settings and
 * Data retention (Admin.tsx, Retention.tsx). Plain Azerbaijani, "siz" form, sentence case (spec 2.4).
 * Names, e-mail addresses, model ids and matter text stay as entered.
 */
export const AZ_ADMIN: Record<string, string> = {
  // Roles
  Recruiter: 'İşə götürən',
  'Recruiting lead': 'İşə götürmə rəhbəri',
  'Governance (read-only)': 'İdarəetmə (yalnız oxumaq)',
  Administrator: 'Administrator',
  'Report viewer only (no other access)': 'Yalnız hesabata baxan (başqa giriş yoxdur)',
  'Report viewer only': 'Yalnız hesabata baxan',

  // Add a user, invitation link
  'Add a user': 'İstifadəçi əlavə edin',
  Name: 'Ad',
  Role: 'Rol',
  'Create user': 'İstifadəçi yaradın',
  'The user gets an email with a one-time link to choose their own password. If email is not set up, or fails, you get the link to copy and send yourself.':
    'İstifadəçiyə öz parolunu seçmək üçün birdəfəlik link göndərilir. E-poçt qurulmayıbsa və ya göndərilmirsə, linki özünüz kopyalayıb göndərirsiniz.',
  'Credentials were emailed to {who}. You can also send an invitation link yourself.':
    'Giriş məlumatları {who} ünvanına e-poçtla göndərildi. Dəvət linkini özünüz də göndərə bilərsiniz.',
  'Email could not be sent (check the email settings).':
    'E-poçt göndərilmədi (e-poçt ayarlarını yoxlayın).',
  'Copy this link and send it to {who} by any channel. When they open it they choose their own password. The link has no time limit and works once. It is shown only once.':
    'Bu linki kopyalayın və {who} ünvanına istənilən kanalla göndərin. Linki açanda öz parolunu seçir. Linkin vaxt həddi yoxdur və yalnız bir dəfə işləyir. O, yalnız bir dəfə göstərilir.',
  'Invitation link': 'Dəvət linki',
  'Link copied.': 'Link kopyalandı.',
  'Your browser blocked copying. The link is selected above: press Ctrl+C (Cmd+C on Mac).':
    'Brauzer kopyalamağa icazə vermədi. Link yuxarıda seçilib: Ctrl+C basın (Mac-da Cmd+C).',

  // Users table
  Roles: 'Rollar',
  'Last seen': 'Son giriş',
  Actions: 'Əməliyyatlar',
  Disabled: 'Deaktiv edilib',
  Invited: 'Dəvət olunub',
  Active: 'Aktiv',
  '· two-step on': '· iki addımlı giriş aktivdir',
  'New invite link': 'Yeni dəvət linki',
  'Make a new invite link for {who}? Their earlier link stops working.':
    '{who} üçün yeni dəvət linki yaradılsın? Əvvəlki linki işləməyəcək.',
  'Make a new link': 'Yeni link yaradın',
  'Copy invite link': 'Dəvət linkini kopyalayın',
  'Reset password': 'Parolu sıfırlayın',
  'Reset the password of {who}? They are signed out everywhere and get a temporary password by email.':
    '{who} istifadəçisinin parolu sıfırlansın? O, hər yerdən çıxarılır və e-poçtla müvəqqəti parol alır.',
  'For someone who lost their phone and recovery codes':
    'Telefonunu və bərpa kodlarını itirən şəxs üçün',
  'Reset two-step': 'İki addımlı girişi sıfırlayın',
  'Remove two-step sign-in for {who}? They sign in with the password alone until they set it up again.':
    '{who} üçün iki addımlı giriş silinsin? O, yenidən qurana qədər yalnız parolla daxil olur.',
  Disable: 'Deaktiv edin',
  'Disable {who}? They are signed out and cannot sign in until the account is enabled again.':
    '{who} deaktiv edilsin? O, çıxarılır və hesab yenidən aktivləşdirilənə qədər daxil ola bilmir.',
  Enable: 'Aktiv edin',

  // AI models
  'Screening uses {provider} · {model}. You can switch to any other model below at any time; each assessment records the model that produced it.':
    'Seçim {provider} · {model} ilə aparılır. İstənilən vaxt aşağıdakı başqa modelə keçə bilərsiniz; hər qiymətləndirmə onu hazırlayan modeli qeyd edir.',
  'No model is active. Choose a company, choose a model, add the API key, then press "Use this". Until then uploaded CVs wait in the queue.':
    'Aktiv model yoxdur. Şirkət və model seçin, API açarını əlavə edin, sonra “İstifadə edin” düyməsini basın. O vaxta qədər yüklənən CV-lər növbədə gözləyir.',
  "Each company needs one API key; the key gives access to all of that company's models. Keys are encrypted on the server and are never shown again or sent to the browser. CV text is sent to the active company for assessment, so choose companies your data-protection review has approved.":
    'Hər şirkət üçün bir API açarı lazımdır; açar həmin şirkətin bütün modellərinə çıxış verir. Açarlar serverdə şifrələnir, bir daha göstərilmir və brauzerə göndərilmir. CV mətni qiymətləndirmə üçün aktiv şirkətə göndərilir, ona görə məlumatların qorunması üzrə yoxlamanızın təsdiqlədiyi şirkətləri seçin.',
  '{n} models available to this key.': 'Bu açar üçün {n} model əlçatandır.',
  'Showing the documented models.': 'Sənədləşdirilmiş modellər göstərilir.',
  'Saved. It is now chosen as the model for the assistant above. Press "Test connection", then "Save".':
    'Yadda saxlanıldı. İndi yuxarıdakı köməkçi üçün model kimi seçilib. “Bağlantını yoxlayın” düyməsini, sonra “Yadda saxlayın” düyməsini basın.',
  'Saved. Press "Test" on the model below, then "Use this" to make it the screening model.':
    'Yadda saxlanıldı. Aşağıdakı modeldə “Yoxlayın” düyməsini, sonra onu seçim modeli etmək üçün “İstifadə edin” düyməsini basın.',
  'Add a model': 'Model əlavə edin',
  '1. Company': '1. Şirkət',
  Company: 'Şirkət',
  '(key added)': '(açar əlavə edilib)',
  '2. Model': '2. Model',
  'All {name} models this key can use. Tick one or more.':
    'Bu açarın istifadə edə biləcəyi bütün {name} modelləri. Bir və ya bir neçəsini işarələyin.',
  '{name} models from its documentation. After you add the key, load the full list from {name} itself.':
    '{name} modelləri onun sənədlərindən götürülüb. Açarı əlavə etdikdən sonra tam siyahını birbaşa {name} şirkətindən yükləyin.',
  'Filter models': 'Modelləri süzün',
  Models: 'Modellər',
  'Nothing more to add.': 'Əlavə ediləcək başqa heç nə yoxdur.',
  'Add the API key first (step 3)': 'Əvvəlcə API açarını əlavə edin (3-cü addım)',
  'Load all {name} models': 'Bütün {name} modellərini yükləyin',
  'Other model ID': 'Başqa modelin identifikatoru',
  'For a model that is not in the list.': 'Siyahıda olmayan model üçün.',
  '3. API key': '3. API açarı',
  'API key': 'API açarı',
  'Key ending …{keyHint} is on file. Leave empty to keep it.':
    '…{keyHint} ilə bitən açar saxlanılır. Saxlamaq üçün boş buraxın.',
  Default: 'Susmaya görə',
  'Save company and model': 'Şirkəti və modeli yadda saxlayın',
  '{n} model': '{n} model',
  '{n} models': '{n} model',
  'The key is sent over HTTPS, encrypted on the server, and never shown again.':
    'Açar HTTPS ilə göndərilir, serverdə şifrələnir və bir daha göstərilmir.',
  'key …{keyHint}': 'açar …{keyHint}',
  'Models you can use': 'İstifadə edə biləcəyiniz modellər',
  'None yet. Add one above.': 'Hələ yoxdur. Yuxarıdan əlavə edin.',
  '{model} works ({ms} ms).': '{model} işləyir ({ms} ms).',
  'test failed': 'yoxlama uğursuz oldu',
  Test: 'Yoxlayın',
  'Runs a test call first and switches only if it works':
    'Əvvəlcə sınaq sorğusu göndərir və yalnız işləyərsə keçir',
  'Test failed; not switched.': 'Yoxlama uğursuz oldu; keçid edilmədi.',
  'Use this': 'İstifadə edin',
  'Remove {model}': '{model} modelini silin',
  'Remove {model}? It is the active model: no model will be active and new CVs will wait until you choose another.':
    '{model} silinsin? Bu, aktiv modeldir: heç bir model aktiv olmayacaq və yeni CV-lər başqa model seçənə qədər gözləyəcək.',
  'Remove {model}?': '{model} silinsin?',
  'Key and settings': 'Açar və ayarlar',
  'Replace API key': 'API açarını dəyişin',
  'The stored key is never shown.': 'Saxlanılan açar heç vaxt göstərilmir.',
  'Remove {name}, its key and its models? If one of them is active, no model will be active until you choose another.':
    '{name}, onun açarı və modelləri silinsin? Onlardan biri aktivdirsə, başqa model seçənə qədər heç bir model aktiv olmayacaq.',
  'Remove company': 'Şirkəti silin',

  // SenAI settings
  '{name} is on for recruiters.': '{name} işə götürənlər üçün aktivdir.',
  '{name} is off. Recruiters do not see it. It explains stored matches; it never scores, ranks or decides.':
    '{name} söndürülüb. İşə götürənlər onu görmür. O, saxlanılmış uyğunluqları izah edir; heç vaxt bal vermir, sıralamır və qərar qəbul etmir.',
  'Usage has passed {warnPct}% of a limit.': 'İstifadə limitin {warnPct}%-ni keçib.',
  'Turn the assistant on': 'Köməkçini işə salın',
  'Name (working name, can change any time)': 'Ad (işçi ad, istənilən vaxt dəyişə bilər)',
  'Give the assistant a name (up to 30 characters).': 'Köməkçiyə ad verin (ən çoxu 30 simvol).',
  Model: 'Model',
  'Leave on the scoring model, or pick another. A model is only used after a passing test.':
    'Qiymətləndirmə modelində saxlayın və ya başqasını seçin. Model yalnız uğurlu yoxlamadan sonra istifadə olunur.',
  'Same as scoring': 'Qiymətləndirmə ilə eyni',
  'Faster model for reading questions (optional)':
    'Sualları oxumaq üçün daha sürətli model (könüllü)',
  'Only reads what the person typed, so it can be a smaller, cheaper model. Leave empty to use the model above. If it fails, the model above reads the question. The data terms you confirm below cover both.':
    'Yalnız şəxsin yazdığını oxuyur, ona görə daha kiçik və daha ucuz model ola bilər. Yuxarıdakı modeldən istifadə etmək üçün boş buraxın. Alınmasa, sualı yuxarıdakı model oxuyur. Aşağıda təsdiq etdiyiniz məlumat şərtləri hər ikisinə şamil olunur.',
  'Same as the model above': 'Yuxarıdakı modellə eyni',
  'Test connection': 'Bağlantını yoxlayın',
  'Passed within the last hour.': 'Son bir saat ərzində keçib.',
  'Not tested in the last hour.': 'Son bir saatda yoxlanılmayıb.',
  'Message when it is unavailable': 'Əlçatan olmayanda göstərilən mesaj',
  Functions: 'Funksiyalar',
  'Say when a question contradicts the record': 'Sual qeydlə ziddiyyət təşkil edəndə bildirin',
  'Let a model read questions the rules cannot (question text only)':
    'Qaydaların oxuya bilmədiyi sualları model oxusun (yalnız sualın mətni)',
  'Suggest candidates from other vacancies (keep off until Legal confirms the notice)':
    'Başqa vakansiyalardan namizədlər təklif edin (hüquq şöbəsi bildirişi təsdiq edənə qədər söndürülü saxlayın)',
  'Read pages that candidates linked in their CV (keep off until Legal confirms; every CV also needs a recorded consent)':
    'Namizədlərin CV-də göstərdiyi səhifələri oxuyun (hüquq şöbəsi təsdiq edənə qədər söndürülü saxlayın; hər CV üçün qeydə alınmış razılıq da lazımdır)',
  'Data terms': 'Məlumat şərtləri',
  'What the provider does with the data': 'Provayder məlumatlarla nə edir',
  'Not recorded yet': 'Hələ qeyd edilməyib',
  'Provider keeps nothing and does not train on it':
    'Provayder heç nə saxlamır və onun üzərində təlim keçmir',
  'Provider keeps it for a time but does not train on it':
    'Provayder onu müəyyən müddət saxlayır, lakin onun üzərində təlim keçmir',
  'Provider may train on it (cannot be used)':
    'Provayder onun üzərində təlim keçə bilər (istifadə oluna bilməz)',
  'Region where data may be processed': 'Məlumatların emal oluna biləcəyi region',
  'I checked these terms with the provider’s own documentation.':
    'Bu şərtləri provayderin öz sənədləri ilə yoxladım.',
  'Last confirmed by {name}': 'Sonuncu dəfə {name} təsdiq edib',
  'an administrator': 'administrator',
  'Limits and usage': 'Limitlər və istifadə',
  'Answers per day': 'Gündə cavab sayı',
  'Empty means no limit': 'Boş buraxılsa, limit yoxdur',
  'Answers per month': 'Ayda cavab sayı',
  'Warn me at (%)': 'Xəbərdarlıq həddi (%)',
  'Today: {v} · This month: {v2}. Only answers a model wrote are counted.':
    'Bu gün: {v} · Bu ay: {v2}. Yalnız modelin yazdığı cavablar sayılır.',
  '{n} (no limit)': '{n} (limit yoxdur)',
  '{n} of {cap}': '{cap} içindən {n}',
  Changes: 'Dəyişikliklər',
  'Nothing yet.': 'Hələ heç nə yoxdur.',
  'Settings changed': 'Ayarlar dəyişdirildi',
  'Connection tested': 'Bağlantı yoxlanıldı',
  unknown: 'məlum deyil',
  'no model': 'model yoxdur',
  'Recent answers (for review)': 'Son cavablar (baxış üçün)',
  'No questions yet.': 'Hələ sual yoxdur.',
  'Add an API for {name}': '{name} üçün API əlavə edin',
  'Choose a company and model and paste its API key. The model is then chosen for {name} above; scoring keeps using its own model. Each company has one key, so a company already added keeps its key unless you paste a new one here.':
    'Şirkət və model seçin və onun API açarını yapışdırın. Model yuxarıda {name} üçün seçilir; qiymətləndirmə öz modelindən istifadə etməyə davam edir. Hər şirkətin bir açarı var, ona görə artıq əlavə edilmiş şirkət burada yeni açar yapışdırmasanız öz açarını saxlayır.',

  // Payload log
  'What was sent to the model': 'Modelə nə göndərildi',
  'Only these fields may leave the system, and only as shown here: the field names, their type and longest length, a size and a fingerprint. The text itself is never kept.':
    'Sistemi yalnız bu sahələr tərk edə bilər və yalnız burada göstərildiyi kimi: sahə adları, onların növü və ən uzun uzunluğu, ölçü və barmaq izi. Mətnin özü heç vaxt saxlanmır.',
  'No model call yet.': 'Hələ modelə sorğu göndərilməyib.',
  'Allowed: {v}': 'İcazə verilir: {v}',
  '{bytes} bytes · {count} fields ·': '{bytes} bayt · {count} sahə ·',
  'all allowed': 'hamısına icazə var',
  'NOT ALLOWED: {what}': 'İCAZƏ YOXDUR: {what}',

  // How SenAI is doing
  'How {name} is doing': '{name} necə işləyir',
  Period: 'Dövr',
  'Last 7 days': 'Son 7 gün',
  'Last 30 days': 'Son 30 gün',
  'Last 90 days': 'Son 90 gün',
  'The AI reader is paused after repeated failures; questions are read by fixed rules until it recovers or you press Test.':
    'Süni intellekt oxuyucusu təkrarlanan xətalardan sonra dayandırılıb; o bərpa olunana və ya siz “Yoxlayın” düyməsini basana qədər suallar sabit qaydalarla oxunur.',
  Questions: 'Suallar',
  'Read by the AI': 'Süni intellektin oxuduğu',
  'Could not tell what was meant': 'Nəyin nəzərdə tutulduğu anlaşılmadı',
  Refused: 'Rədd edilib',
  'Rules only (AI unavailable)': 'Yalnız qaydalar (süni intellekt əlçatan deyil)',
  'Read by fixed rules': 'Sabit qaydalarla oxunan',
  'Kinds of answer:': 'Cavab növləri:',
  'What people asked for:': 'İnsanların istədiyi:',
  'Notes shown:': 'Göstərilən qeydlər:',
  'Counts only, from the audit trail. No questions and no names are shown here.':
    'Yalnız say, audit izindən. Burada sual və ad göstərilmir.',

  // Words the assistant knows
  'Words the assistant knows': 'Köməkçinin bildiyi sözlər',
  '{assistantName} comes with about a hundred skills in Azerbaijani, English and Russian. Add your own here, for example a telecom term, or more ways to write a skill it already has. Recruiters can suggest words; nothing is read until you approve it.':
    '{assistantName} Azərbaycan, ingilis və rus dillərində təxminən yüz bacarıqla gəlir. Öz sözlərinizi, məsələn telekom termini və ya artıq bildiyi bacarığın yazılışının başqa variantlarını burada əlavə edin. İşə götürənlər söz təklif edə bilər; siz təsdiq etməyincə heç nə oxunmur.',
  'Skill name': 'Bacarığın adı',
  Kind: 'Növ',
  Tool: 'Alət',
  Domain: 'Sahə',
  Certificate: 'Sertifikat',
  'Other ways it is written (separate with commas)':
    'Yazılışının başqa variantları (vergüllə ayırın)',
  'Only more ways to write a built-in skill? Its id, for example excel (optional)':
    'Yalnız daxili bacarığın yazılışının başqa variantlarıdır? Onun identifikatoru, məsələn excel (könüllü)',
  'Add word': 'Söz əlavə edin',
  'No words added yet.': 'Hələ söz əlavə edilməyib.',
  'Added words': 'Əlavə edilmiş sözlər',
  '{name} reads this word now.': '{name} indi bu sözü oxuyur.',
  'more ways to write {id}': '{id} yazılışının başqa variantları',
  'by {name}': '{name} tərəfindən',
  approved: 'təsdiqlənib',
  rejected: 'rədd edilib',
  proposed: 'təklif edilib',
  Approve: 'Təsdiq edin',
  Reject: 'Rədd edin',

  // Data retention
  'Retention period': 'Saxlama müddəti',
  'When this is on, CV files and everything extracted from them (text, name, e-mail, summary, quotes, shared-report copies, assistant chats) are erased automatically once they are older than the period below, unless the vacancy is under legal hold. Decisions and the audit trail are kept. A run happens about once an hour and every run leaves a deletion certificate.':
    'Bu aktiv olduqda, CV faylları və onlardan çıxarılan hər şey (mətn, ad, e-poçt, xülasə, sitatlar, paylaşılan hesabat nüsxələri, köməkçi söhbətləri) aşağıdakı müddətdən köhnə olan kimi avtomatik silinir; vakansiya hüquqi saxlama altındadırsa istisna olmaqla. Qərarlar və audit izi saxlanılır. Silmə təxminən saatda bir dəfə işləyir və hər işləmə silinmə sertifikatı buraxır.',
  'Erase automatically': 'Avtomatik silin',
  'Keep CV files for (days, 30 to 3650)':
    'CV fayllarını saxlama müddəti (gün, 30-dan 3650-yə qədər)',
  'Preview what would be erased': 'Nələrin silinəcəyinə əvvəlcədən baxın',
  'Erase expired files now': 'Müddəti bitmiş faylları indi silin',
  'Erase expired files': 'Müddəti bitmiş faylları silin',
  'Erase {n} file now? This cannot be undone.':
    '{n} fayl indi silinsin? Bunu geri qaytarmaq olmaz.',
  'Erase {n} files now? This cannot be undone.':
    '{n} fayl indi silinsin? Bunu geri qaytarmaq olmaz.',
  'Yes, erase now': 'Bəli, indi silin',
  'Right now: {due} file(s) older than {days} days and not on hold; {heldBack} more on hold. The preview and the button use the saved period.':
    'Hazırda: {days} gündən köhnə və hüquqi saxlamada olmayan {due} fayl; hüquqi saxlamada daha {heldBack} fayl. Əvvəlcədən baxış və düymə yadda saxlanılmış müddətdən istifadə edir.',
  'Preview: {n} file(s) would be erased; {held} kept because of a legal hold.':
    'Əvvəlcədən baxış: {n} fayl silinəcək; hüquqi saxlamaya görə {held} fayl saxlanılır.',
  'Done: {n} file(s) erased; {held} kept because of a legal hold.':
    'Hazırdır: {n} fayl silindi; hüquqi saxlamaya görə {held} fayl saxlanıldı.',
  'Legal hold': 'Hüquqi saxlama',
  'A vacancy under hold is never purged, for example while a complaint or claim about a hiring decision is open. Name the matter; lifting the hold lets the next run take expired files.':
    'Saxlama altındakı vakansiya heç vaxt silinmir, məsələn işə qəbul qərarı ilə bağlı şikayət və ya iddia açıq olduqda. İşin adını yazın; saxlamanı götürdükdə növbəti işləmə müddəti bitmiş faylları silir.',
  'Vacancies and legal hold': 'Vakansiyalar və hüquqi saxlama',
  'Files held': 'Saxlanılan fayllar',
  Hold: 'Saxlama',
  Action: 'Əməliyyat',
  'Lift hold': 'Saxlamanı götürün',
  'Matter reference': 'İşin nömrəsi',
  'Place hold': 'Saxlama tətbiq edin',
  'Deletion certificates': 'Silinmə sertifikatları',
  'No purge has run yet.': 'Hələ silmə işləməyib.',
  When: 'Nə vaxt',
  'Run by': 'Kim işə salıb',
  'Files erased': 'Silinən fayllar',
  'Kept (hold)': 'Saxlanılan (hüquqi)',
  Scheduled: 'Cədvəl üzrə',
  '{days} days': '{days} gün',
  'The certificate number matches an entry in the audit trail; every erased file also has its own entry.':
    'Sertifikat nömrəsi audit izindəki qeyddə də var; silinən hər faylın da öz qeydi var.',
};
