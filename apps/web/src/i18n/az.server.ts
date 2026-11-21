/**
 * Azerbaijani text for the sentences the service sends back with an error (I18-05). The key is the
 * service's own sentence, word for word (apps/api/src), so it is found by `errMsg` / `trServer`.
 * A test reads the service source and fails when a sentence has no entry here.
 * Plain Azerbaijani, "siz" form (spec 2.4). Names, numbers and times are filled in unchanged.
 */
export const AZ_SERVER: Record<string, string> = {
  // The web's own fallbacks and the standard HTTP statuses
  'Something went wrong': 'Nəsə səhv getdi',
  Unauthorized: 'Davam etmək üçün daxil olun',
  'Not Found': 'Tapılmadı',
  'Bad Request': 'Sorğu düzgün deyil',
  Conflict: 'Bu dəyişiklik başqa bir dəyişiklikə ziddir',
  'Too Many Requests': 'Çox sorğu göndərildi. Bir az gözləyib yenidən cəhd edin.',
  'Payload Too Large': 'Fayl çox böyükdür',
  'Unsupported Media Type': 'Bu fayl növü qəbul edilmir',
  'Request Timeout': 'Gözləmə vaxtı bitdi. Yenidən cəhd edin.',
  'Internal Server Error': 'Xidmətdə xəta baş verdi. Bir azdan yenidən cəhd edin.',
  'Bad Gateway': 'Xidmət düzgün cavab vermədi. Bir azdan yenidən cəhd edin.',
  'Service Unavailable': 'Xidmət hazırda əlçatan deyil. Bir azdan yenidən cəhd edin.',
  'Gateway Timeout': 'Xidmət vaxtında cavab vermədi. Bir azdan yenidən cəhd edin.',
  'Invalid request': 'Sorğu düzgün deyil',
  'Expected multipart/form-data': 'Fayl düzgün göndərilməyib. Yenidən cəhd edin.',

  // Sign-in, passwords, two-step
  'user is disabled': 'İstifadəçi deaktiv edilib',
  'Password change required': 'Əvvəlcə parolu dəyişməlisiniz',
  'New password must be at least 12 characters': 'Yeni parol ən azı 12 simvol olmalıdır',
  'No password account for that user': 'Bu istifadəçinin parolla girişi yoxdur',
  'SERVICE role is for service principals only, and only that role':
    'SERVICE rolu yalnız xidmət hesabları üçündür və başqa rolla birlikdə verilmir',
  'SERVICE is not a human role': 'SERVICE rolu insan üçün deyil',
  'cannot revoke the last active ADMIN': 'Sonuncu aktiv administratorun rolunu götürmək olmaz',
  'Two-step sign-in is for accounts that sign in with a password here':
    'İki addımlı giriş yalnız burada parolla daxil olan hesablar üçündür',
  'That code is not right. Check the time on your phone and try again.':
    'Kod düzgün deyil. Telefonunuzdakı vaxtı yoxlayın və yenidən cəhd edin.',

  // Administration: AI models, assistant, skills
  'Nothing to update': 'Yeniləmək üçün heç nə yoxdur',
  'Unknown model': 'Naməlum model',
  'Unknown AI company': 'Naməlum süni intellekt şirkəti',
  'Unknown AI model': 'Naməlum süni intellekt modeli',
  'No AI model is active. An administrator must add a company, choose a model and make it active.':
    'Aktiv süni intellekt modeli yoxdur. Administrator şirkət əlavə etməli, model seçməli və onu aktiv etməlidir.',
  'SETTINGS_ENCRYPTION_KEY is not configured; provider keys cannot be stored':
    'Şifrələmə açarı qurulmayıb, ona görə provayder açarları saxlanıla bilmir',
  '{name} is already added. Add more models to it, or replace its key.':
    '{name} artıq əlavə edilib. Ona daha çox model əlavə edin və ya açarını dəyişin.',
  'Unknown setting "{key}"': 'Naməlum parametr: “{key}”',
  '{label} is required': '{label} tələb olunur',
  '{label} has an unsupported value': '{label} üçün dəstəklənməyən dəyər seçilib',
  'provider responded {status}': 'provayder {status} kodu ilə cavab verdi',
  'paused for a minute after repeated failures':
    'təkrar xətalardan sonra bir dəqiqəlik dayandırılıb',
  'unknown error': 'naməlum xəta',
  '{name}: {message}': '{name}: {message}',
  'That model is not in the list': 'Bu model siyahıda yoxdur',
  'Record what the provider does with the data before turning the assistant on':
    'Köməkçini yandırmazdan əvvəl provayderin məlumatlarla nə etdiyini qeyd edin',
  'A provider that may train on this data cannot be used for the assistant':
    'Bu məlumatlar üzərində təlim keçə bilən provayder köməkçi üçün istifadə edilə bilməz',
  'Choose a model, or make a scoring model active, first':
    'Əvvəlcə model seçin və ya qiymətləndirmə modelini aktiv edin',
  'Run "Test connection" on this model within the last hour first':
    'Əvvəlcə bu model üçün son bir saat ərzində “Bağlantını yoxlayın” düyməsinə basın',
  'Confirm that you checked these data terms before turning the assistant on':
    'Köməkçini yandırmazdan əvvəl bu məlumat şərtlərini yoxladığınızı təsdiq edin',
  'Choose and test an AI model first (Administration > AI models).':
    'Əvvəlcə süni intellekt modeli seçin və yoxlayın (İdarəetmə → Süni intellekt modelləri).',
  'A fairness test is already running.': 'Ədalətlilik testi artıq işləyir.',
  'Reading candidate links is switched off': 'Namizəd keçidlərinin oxunması söndürülüb',
  'A consent is already recorded for this CV': 'Bu CV üçün razılıq artıq qeyd edilib',
  'No consent is recorded for this CV, so its links are not read':
    'Bu CV üçün razılıq qeyd edilməyib, ona görə keçidləri oxunmur',
  'That link is not in this CV': 'Bu keçid həmin CV-də yoxdur',
  'Social network pages are never read, with or without consent':
    'Sosial şəbəkə səhifələri razılıqla da, razılıqsız da oxunmur',
  "Couldn't read that page. Open it yourself if you need it.":
    'Həmin səhifəni oxumaq alınmadı. Lazım olsa, özünüz açın.',
  'Give the skill a name': 'Bacarığa ad verin',
  'That built-in skill does not exist': 'Belə daxili bacarıq yoxdur',
  'Give between 1 and 20 ways the skill is written':
    'Bacarığın yazılış formalarından 1-dən 20-yə qədər göstərin',
  'The skill name needs at least two letters or digits':
    'Bacarığın adında ən azı iki hərf və ya rəqəm olmalıdır',
  'A skill with this name is already in the dictionary': 'Bu adlı bacarıq lüğətdə artıq var',
  '"{a}" must be between 2 and 40 characters': '“{a}” 2 ilə 40 simvol arasında olmalıdır',
  '"{a}" is already read as {label}': '“{a}” artıq “{label}” kimi oxunur',
  '{feature} is switched off': '{feature} söndürülüb',
  'Challenge is switched off': 'Matçın sorğulanması söndürülüb',
  'Compare is switched off': 'Müqayisə söndürülüb',
  'Interview questions is switched off': 'Müsahibə sualları söndürülüb',
  'Suggestions from other vacancies are switched off': 'Digər vakansiyalardan təkliflər söndürülüb',

  // Vacancies, criteria, uploads
  'Only the owner or a recruiting lead can change this vacancy.':
    'Bu vakansiyanı yalnız sahibi və ya işə götürmə rəhbəri dəyişə bilər.',
  'This vacancy is archived': 'Bu vakansiya arxivdədir',
  'Restore this vacancy first': 'Əvvəlcə bu vakansiyanı bərpa edin',
  'Restore this vacancy before changing it.': 'Dəyişməzdən əvvəl bu vakansiyanı bərpa edin.',
  'Vacancy not found': 'Vakansiya tapılmadı',
  'Stop the running screening first': 'Əvvəlcə işləyən seçimi dayandırın',
  'Confirm the candidate notice first': 'Əvvəlcə namizəd bildirişini təsdiq edin',
  'Add at least one skill first': 'Əvvəlcə ən azı bir bacarıq əlavə edin',
  'Add a vacancy link first': 'Əvvəlcə vakansiya keçidi əlavə edin',
  'The link must start with http:// or https://': 'Keçid http:// və ya https:// ilə başlamalıdır',
  'Enter a full web address that starts with https://': 'https:// ilə başlayan tam veb ünvan yazın',
  'Only web addresses (http or https) can be read':
    'Yalnız veb ünvanlar (http və ya https) oxuna bilər',
  'Leave the user name and password out of the address':
    'İstifadəçi adını və parolu ünvandan çıxarın',
  'someone else': 'başqa biri',
  'Save it as .docx and try again': '.docx kimi saxlayın və yenidən cəhd edin',
  'This file is locked with a password': 'Bu fayl parolla bağlanıb',
  'Only Word files (.docx) here': 'Burada yalnız Word faylları (.docx) qəbul edilir',
  "Couldn't find text in this file": 'Bu faylda mətn tapılmadı',
  'The AI provider returned output that could not be used. Try again.':
    'Süni intellekt provayderi istifadə oluna bilməyən cavab qaytardı. Yenidən cəhd edin.',
  'Criteria are frozen or not started. Create a new version first.':
    'Meyarlar dondurulub və ya hələ başlanmayıb. Əvvəlcə yeni versiya yaradın.',
  'A draft already exists': 'Qaralama artıq var',
  'There is no draft to freeze': 'Dondurulacaq qaralama yoxdur',
  'Add at least one mandatory or preferred criterion to score against':
    'Qiymətləndirmək üçün ən azı bir məcburi və ya üstün meyar əlavə edin',
  'Freeze the criteria before uploading CVs.': 'CV yükləməzdən əvvəl meyarları dondurun.',
  'Confirm that candidates have been informed that AI assists screening before uploading CVs.':
    'CV yükləməzdən əvvəl namizədlərə süni intellektin seçimə kömək etdiyinin bildirildiyini təsdiq edin.',
  'No frozen criteria': 'Dondurulmuş meyar yoxdur',
  'No file received': 'Fayl alınmadı',
  'No files received': 'Fayl alınmadı',
  'That file is over the size limit': 'Fayl icazə verilən ölçüdən böyükdür',
  'Only failed screenings can be retried': 'Yalnız alınmayan yoxlamalar təkrar edilə bilər',
  'Already erased': 'Artıq silinib',
  'Up to {max} CVs per download.': 'Bir endirmədə ən çox {max} CV ola bilər.',
  'Up to {max} files per upload.': 'Bir yükləmədə ən çox {max} fayl ola bilər.',
  'This download link has been used or has expired. Start the download again.':
    'Bu endirmə keçidi istifadə olunub və ya müddəti bitib. Endirməni yenidən başladın.',
  'This CV is already here': 'Bu CV artıq buradadır',
  'This CV is already in this vacancy': 'Bu CV artıq bu vakansiyadadır',
  'Add the requirements to this vacancy first, then analyze':
    'Əvvəlcə bu vakansiyaya tələbləri əlavə edin, sonra təhlil edin',

  // Candidates, marks, requirements, decisions
  'We could not find this candidate.': 'Bu namizəd tapılmadı.',
  'This page link is not valid.': 'Bu səhifə keçidi düzgün deyil.',
  'Only a person can set a mark.': 'Qeydi yalnız insan təyin edə bilər.',
  'This candidate was erased.': 'Bu namizəd silinib.',
  'This vacancy is archived. Restore it to change marks.':
    'Bu vakansiya arxivdədir. Qeydləri dəyişmək üçün onu bərpa edin.',
  'This CV is still being analyzed.': 'Bu CV hələ təhlil olunur.',
  'This candidate was changed by someone else.': 'Bu namizəd başqası tərəfindən dəyişdirilib.',
  '{by} already changed this to {mark}.': '{by} bunu artıq “{mark}” olaraq dəyişib.',
  'This CV has no readable text.': 'Bu CV-də oxunaqlı mətn yoxdur.',
  'Only a person can change requirements': 'Tələbləri yalnız insan dəyişə bilər',
  'That requirement is not part of the current scan': 'Bu tələb cari skanın tərkibində deyil',
  'Only a person can reveal names': 'Adları yalnız insan göstərə bilər',
  'Only a person can record a decision': 'Qərarı yalnız insan qeyd edə bilər',
  'Confirm that you reviewed the evidence before rejecting':
    'İmtina etməzdən əvvəl sübutlara baxdığınızı təsdiq edin',
  "This candidate's data has been erased": 'Bu namizədin məlumatları silinib',
  'Screening is still running': 'Seçim hələ davam edir',
  'A text file has no pages to show.': 'Mətn faylında göstəriləcək səhifə yoxdur.',
  'The pages of this Word file are being prepared.': 'Bu Word faylının səhifələri hazırlanır.',
  'This Word file cannot be shown as pages.': 'Bu Word faylı səhifə kimi göstərilə bilməz.',

  // Reports, retention
  'The scan is still running. Share the report when every CV has been read, or stop the scan first.':
    'Skan hələ davam edir. Hesabatı bütün CV-lər oxunduqdan sonra paylaşın və ya əvvəlcə skanı dayandırın.',
  'Only a person can share a report': 'Hesabatı yalnız insan paylaşa bilər',
  'One of the chosen people cannot be given access.':
    'Seçilmiş şəxslərdən birinə giriş verilə bilməz.',
  'Report not found': 'Hesabat tapılmadı',
  'No access to this report': 'Bu hesabata girişiniz yoxdur',
  'Report no longer available': 'Hesabat artıq mövcud deyil',
  'A matter reference is required for a hold': 'Hüquqi saxlama üçün işin nömrəsi tələb olunur',

  // Why a CV needs a person, and why a file could not be read
  'A knockout rule matched. A person decides.': 'Kənarlaşdırma qaydası işlədi. Qərarı insan verir.',
  'The text looked like it contained instructions to the AI. A person should read it.':
    'Mətndə süni intellektə yönəlmiş göstərişlər olduğu görünürdü. Onu insan oxumalıdır.',
  'No score could be given. A person should read this CV.':
    'Bal vermək mümkün olmadı. Bu CV-ni insan oxumalıdır.',
  'The file could not be read': 'Fayl oxuna bilmədi',

  // AI models: the companies' own notes, options and test results
  'The company returned no models for this key; showing its documented models.':
    'Şirkət bu açar üçün heç bir model qaytarmadı; sənədləşdirilmiş modellər göstərilir.',
  '{error}. Showing the documented models; you can also type a model id.':
    '{error}. Sənədləşdirilmiş modellər göstərilir; model identifikatorunu özünüz də yaza bilərsiniz.',
  '{provider} / {model} answered in the expected shape.':
    '{provider} / {model} gözlənilən formada cavab verdi.',
  'The model answered, but not in a form that can be checked.':
    'Model cavab verdi, lakin yoxlana bilən formada deyil.',
  'Data region': 'Məlumat regionu',
  'A Gemini API key from Google AI Studio.': 'Google AI Studio-dan Gemini API açarı.',
  'Gemini Developer API (Google AI Studio keys): processing region is chosen by Google; there is no EU-only option on this key type.':
    'Gemini Developer API (Google AI Studio açarları): emal regionunu Google seçir; bu açar növündə yalnız Avropa İttifaqı seçimi yoxdur.',
  preview: 'ilkin versiya',
  'Choose Europe only if the API key belongs to a project created with European data residency; otherwise calls are rejected.':
    'Avropanı yalnız API açarı Avropa məlumat yerləşməsi ilə yaradılmış layihəyə aiddirsə seçin; əks halda sorğular rədd edilir.',
  'Global (default)': 'Qlobal (susmaya görə)',
  'Europe (project with EU data residency)': 'Avropa (Avropa məlumat yerləşməli layihə)',
  'A secret key from the OpenAI platform (project key recommended).':
    'OpenAI platformasından gizli açar (layihə açarı tövsiyə olunur).',
  'Processed in the United States unless the project uses European data residency.':
    'Layihə Avropa məlumat yerləşməsindən istifadə etmirsə, Birləşmiş Ştatlarda emal olunur.',
  'An API key from the Anthropic Console.': 'Anthropic Console-dan API açarı.',
  'Processed in the United States by default.': 'Susmaya görə Birləşmiş Ştatlarda emal olunur.',
  'A key for the general Z.ai API (not a "Coding Plan" key: those are limited to coding tools).':
    'Ümumi Z.ai API üçün açar (“Coding Plan” açarı deyil: onlar yalnız proqramlaşdırma alətləri ilə məhdudlaşır).',
  'International Z.ai platform (Zhipu AI); confirm where it processes data before use.':
    'Beynəlxalq Z.ai platforması (Zhipu AI); istifadədən əvvəl məlumatı harada emal etdiyini dəqiqləşdirin.',
  'An API key from the Sakana AI console.': 'Sakana AI konsolundan API açarı.',
  'Sakana AI (Japan). Fugu orchestrates several underlying models, so the data may be handled by more than one provider: confirm this with Sakana first.':
    'Sakana AI (Yaponiya). Fugu bir neçə əsas modeli idarə edir, ona görə məlumatı birdən çox provayder emal edə bilər: əvvəlcə bunu Sakana ilə dəqiqləşdirin.',
  'needs access approval': 'giriş təsdiqi lazımdır',
  'Japanese-specialised': 'yapon dilinə ixtisaslaşıb',
  'An API key (starts with nvapi-) from build.nvidia.com.':
    'build.nvidia.com saytından API açarı (nvapi- ilə başlayır).',
  'NVIDIA API catalog (United States). The free tier is for development and testing and is rate-limited: not suitable for production use.':
    'NVIDIA API kataloqu (Birləşmiş Ştatlar). Pulsuz səviyyə inkişaf və sınaq üçündür, sorğu sayı məhdudlaşdırılıb: real istifadə üçün uyğun deyil.',

  // The paired-CV fairness test: the variants it sends
  Base: 'Əsas',
  'Repeat of base': 'Əsasın təkrarı',
  'Azerbaijani female name': 'Azərbaycanlı qadın adı',
  'Azerbaijani male name': 'Azərbaycanlı kişi adı',
  'Russian female name': 'Rus qadın adı',
  'Russian male name': 'Rus kişi adı',
  'Personal details block': 'Şəxsi məlumatlar bloku',
  'Career break line': 'Karyerada fasilə sətri',
  'none (English name)': 'yoxdur (ingilis adı)',
  'none: the same CV sent again, to measure the model’s own noise':
    'yoxdur: modelin öz dəyişkənliyini ölçmək üçün eyni CV yenidən göndərilir',
  name: 'ad',
  'name plus date of birth, family status and nationality lines':
    'ad, üstəlik doğum tarixi, ailə vəziyyəti və milliyyət sətirləri',
  'name plus a free-text career break "(maternity leave)"':
    'ad, üstəlik sərbəst mətn şəklində karyera fasiləsi “(analıq məzuniyyəti)”',
};
