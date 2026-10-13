/**
 * The sentences of the SenAI tools (compare, doctor, changes, what-if, open, interview, recall,
 * about, help), in the three languages. Fixed wording with slots: no model writes them, so every
 * number in them is the server's own.
 */
import type { Lang } from '../pool-assistant';

const W = {
  // compare
  compareHead: {
    en: 'Side by side for {title}: {names}.',
    az: '{title} üzrə yan-yana müqayisə: {names}.',
    ru: 'Сравнение для «{title}»: {names}.',
  },
  compareWho: {
    en: 'Which candidates? Name two or three, or say "compare the first and the second".',
    az: 'Hansı namizədlər? İki-üç nəfərin adını yazın və ya "birinci ilə ikincini müqayisə et" deyin.',
    ru: 'Каких кандидатов? Назовите двух-трёх или скажите «сравни первого и второго».',
  },
  compareSameVacancy: {
    en: 'I compare candidates of the same vacancy only, because requirements differ between vacancies. Pick candidates from one vacancy.',
    az: 'Yalnız eyni vakansiyanın namizədlərini müqayisə edirəm, çünki tələblər vakansiyadan vakansiyaya fərqlənir. Bir vakansiyadan seçin.',
    ru: 'Я сравниваю только кандидатов одной вакансии: требования у вакансий разные. Выберите кандидатов из одной вакансии.',
  },
  compareNote: {
    en: 'Each cell is what the analysis found for that requirement. Scores are the pool scores. This is a comparison, not a recommendation.',
    az: 'Hər xana həmin tələb üzrə təhlilin tapdığıdır. Ballar hovuzdakı ballardır. Bu müqayisədir, tövsiyə deyil.',
    ru: 'В каждой ячейке то, что анализ нашёл по этому требованию. Баллы — из пула. Это сравнение, а не рекомендация.',
  },
  // doctor
  doctorHead: {
    en: '{title}: {strong} of {n} analyzed are Strong. The rarest must-have is "{req}": {met} of {n} meet it.',
    az: '{title}: təhlil olunmuş {n} namizədin {strong}-i Güclüdür. Ən nadir vacib tələb "{req}"-dir: {n} nəfərdən {met}-i ödəyir.',
    ru: '«{title}»: из {n} проанализированных Сильное у {strong}. Самое редкое обязательное требование — «{req}»: его выполняют {met} из {n}.',
  },
  doctorNoMust: {
    en: '{title}: {strong} of {n} analyzed are Strong. This vacancy has no must-have requirements to blame.',
    az: '{title}: təhlil olunmuş {n} namizədin {strong}-i Güclüdür. Bu vakansiyada günahlandıracaq vacib tələb yoxdur.',
    ru: '«{title}»: из {n} проанализированных Сильное у {strong}. В этой вакансии нет обязательных требований, из-за которых мало подходящих.',
  },
  doctorNone: {
    en: '{title} has no analyzed resumes yet, so there is nothing to diagnose.',
    az: '{title} üçün hələ təhlil olunmuş CV yoxdur, ona görə baxılacaq bir şey yoxdur.',
    ru: 'Для «{title}» ещё нет проанализированных резюме, диагностировать нечего.',
  },
  doctorNote: {
    en: 'Counted from the analysis of each resume. A requirement that almost nobody meets is the usual reason for few Strong matches. You can test relaxing one with "what if ... were nice-to-have".',
    az: 'Hər CV-nin təhlilindən sayılıb. Demək olar ki, heç kimin ödəmədiyi tələb Güclü namizədlərin az olmasının adi səbəbidir. "... arzuolunan olsaydı nə olardı" ilə yoxlaya bilərsiniz.',
    ru: 'Посчитано по анализу каждого резюме. Требование, которое почти никто не выполняет, — обычная причина малого числа Сильных. Проверить можно вопросом «а если бы … было желательным».',
  },
  doctorWhatIf: {
    en: 'What if "{req}" were nice-to-have?',
    az: '"{req}" arzuolunan olsaydı nə olardı?',
    ru: 'А если «{req}» было бы желательным?',
  },
  // changes
  changesHead: {
    en: 'Since {date} for {scope}: {fresh} new analyzed, {marked} decisions.',
    az: '{date} tarixindən {scope} üzrə: {fresh} yeni təhlil, {marked} qərar.',
    ru: 'С {date} по {scope}: новых проанализированных — {fresh}, решений — {marked}.',
  },
  changesNone: {
    en: 'Nothing changed for {scope} since {date}.',
    az: '{date} tarixindən {scope} üzrə dəyişiklik olmayıb.',
    ru: 'С {date} по {scope} ничего не изменилось.',
  },
  changesNew: { en: 'Analyzed', az: 'Təhlil olundu', ru: 'Проанализировано' },
  changesMark: { en: 'Marked', az: 'Qeyd', ru: 'Отметка' },
  changesDefault: {
    en: 'No date was given, so I looked at the last 7 days.',
    az: 'Tarix verilmədi, ona görə son 7 günə baxdım.',
    ru: 'Дата не указана, поэтому я посмотрел последние 7 дней.',
  },
  // what if
  whatIfHead: {
    en: 'If "{req}" were {to}: Strong goes from {s0} to {s1}, {moved} candidates change band.',
    az: '"{req}" {to} olsaydı: Güclü namizədlər {s0}-dən {s1}-ə dəyişər, {moved} namizədin səviyyəsi dəyişər.',
    ru: 'Если бы «{req}» было {to}: Сильных станет {s1} вместо {s0}, уровень сменят {moved} кандидатов.',
  },
  whatIfNice: { en: 'nice-to-have', az: 'arzuolunan', ru: 'желательным' },
  whatIfMust: { en: 'a must-have', az: 'vacib', ru: 'обязательным' },
  whatIfWhich: {
    en: 'Which requirement? Pick one:',
    az: 'Hansı tələb? Birini seçin:',
    ru: 'Какое требование? Выберите:',
  },
  whatIfNote: {
    en: 'Nothing was changed or saved. It is the stored analysis scored again with the other weight; no resume was read again. To make it real, change the requirement on the results screen.',
    az: 'Heç nə dəyişdirilməyib və ya saxlanmayıb. Bu, saxlanmış təhlilin başqa çəki ilə yenidən hesablanmasıdır; heç bir CV yenidən oxunmayıb. Real etmək üçün nəticə ekranında tələbi dəyişin.',
    ru: 'Ничего не изменено и не сохранено. Это сохранённый анализ, посчитанный заново с другим весом; резюме заново не читались. Чтобы применить, измените требование на экране результатов.',
  },
  whatIfNeedsVacancy: {
    en: 'A what-if works on one vacancy. Pick it:',
    az: 'Nə olardı hesabı bir vakansiya üzrə işləyir. Seçin:',
    ru: 'Расчёт «а если» работает по одной вакансии. Выберите её:',
  },
  whatIfNoReq: {
    en: 'This vacancy has no requirement like that. Its requirements are listed below.',
    az: 'Bu vakansiyada belə tələb yoxdur. Tələblər aşağıdadır.',
    ru: 'В этой вакансии нет такого требования. Требования ниже.',
  },
  // open / interview
  openCandidate: {
    en: 'Open {name}',
    az: '{name} namizədini aç',
    ru: 'Открыть: {name}',
  },
  openVacancy: { en: 'Open {title}', az: '{title} vakansiyasını aç', ru: 'Открыть: {title}' },
  openNewVacancy: {
    en: 'Create a new vacancy',
    az: 'Yeni vakansiya yarat',
    ru: 'Создать новую вакансию',
  },
  openHead: { en: 'Here it is.', az: 'Buyurun.', ru: 'Вот.' },
  openWhich: {
    en: 'Open which one? Say a number from the list ("open the second") or a name.',
    az: 'Hansını açım? Siyahıdan nömrə ("ikincini aç") və ya ad deyin.',
    ru: 'Что открыть? Назовите номер из списка («открой второго») или имя.',
  },
  interviewHead: {
    en: 'Interview questions are made on the candidate page, from the analysis of that resume.',
    az: 'Müsahibə sualları namizədin səhifəsində, həmin CV-nin təhlilindən hazırlanır.',
    ru: 'Вопросы для интервью готовятся на странице кандидата по анализу его резюме.',
  },
  interviewNote: {
    en: 'Open the candidate and choose "Interview questions" in the assistant there.',
    az: 'Namizədi açın və oradakı köməkçidə "Müsahibə sualları"nı seçin.',
    ru: 'Откройте кандидата и выберите «Вопросы для интервью» в ассистенте.',
  },
  interviewWho: {
    en: 'For which candidate? Say a number from the list or a name.',
    az: 'Hansı namizəd üçün? Siyahıdan nömrə və ya ad deyin.',
    ru: 'Для какого кандидата? Назовите номер из списка или имя.',
  },
  // recall
  recallHead: {
    en: 'Your earlier conversations that match:',
    az: 'Uyğun gələn əvvəlki söhbətləriniz:',
    ru: 'Ваши прошлые разговоры по теме:',
  },
  recallNote: {
    en: 'This is what the answers said at the time, from your own conversations. It is not a new answer: ask again for the current list.',
    az: 'Bu, öz söhbətlərinizdə o vaxt verilən cavablardır. Yeni cavab deyil: indiki siyahı üçün yenidən soruşun.',
    ru: 'Это то, что говорили ответы в ваших разговорах в то время. Это не новый ответ: спросите ещё раз, чтобы увидеть текущий список.',
  },
  recallNone: {
    en: "I found nothing in your earlier conversations about that. I only see your own conversations, never other people's.",
    az: 'Əvvəlki söhbətlərinizdə bu barədə heç nə tapmadım. Yalnız sizin söhbətlərinizi görürəm, başqalarınınkını yox.',
    ru: 'В ваших прошлых разговорах об этом ничего не нашёл. Я вижу только ваши разговоры, не чужие.',
  },
  // about
  aboutHead: {
    en: 'What I can see and how I answer:',
    az: 'Nəyi görürəm və necə cavab verirəm:',
    ru: 'Что я вижу и как отвечаю:',
  },
  aboutSees: {
    en: 'I see the vacancies you can open, their requirements, the analysis of each resume (scores, bands, what was found), your marks and the text of resumes when you search a skill.',
    az: 'Açmaq icazəniz olan vakansiyaları, tələbləri, hər CV-nin təhlilini (ballar, səviyyələr, tapılanlar), sizin qeydlərinizi və bacarıq axtardıqda CV mətnini görürəm.',
    ru: 'Я вижу вакансии, которые вам доступны, их требования, анализ каждого резюме (баллы, уровни, найденное), ваши отметки и текст резюме при поиске навыка.',
  },
  aboutDoes: {
    en: 'The server finds and counts; numbers and resume lines come from the data, not from a model. A model may only help to understand an unclear question; it never sees a resume. I cannot change marks, requirements or anything else, and I do not recommend hiring or rejecting.',
    az: 'Server tapır və sayır; rəqəmlər və CV sətirləri məlumatdan gəlir, modeldən yox. Model yalnız aydın olmayan sualı anlamağa kömək edə bilər; CV-ni heç görmür. Qeydləri, tələbləri və ya başqa nəyisə dəyişə bilmirəm, işə götürməyi və ya rədd etməyi tövsiyə etmirəm.',
    ru: 'Сервер ищет и считает; цифры и строки резюме берутся из данных, а не от модели. Модель может лишь помочь понять неясный вопрос и резюме не видит. Я не могу менять отметки, требования и что-либо ещё и не советую нанимать или отклонять.',
  },
  aboutLast: {
    en: 'How I read your last question: {read}.',
    az: 'Son sualınızı belə oxudum: {read}.',
    ru: 'Как я прочитал ваш прошлый вопрос: {read}.',
  },
  aboutLastRules: {
    en: 'Understood by rules, no model was used.',
    az: 'Qaydalarla anlaşıldı, model istifadə olunmayıb.',
    ru: 'Понято по правилам, модель не использовалась.',
  },
  aboutLastModel: {
    en: 'The rules could not tell, so a model read the question (it saw only the question, not a resume).',
    az: 'Qaydalar anlaya bilmədi, ona görə sualı model oxudu (yalnız sualı gördü, CV-ni yox).',
    ru: 'Правила не поняли вопрос, его прочитала модель (она видела только вопрос, не резюме).',
  },
  // help topics
  help_out_of_date: {
    en: '"Out of date" means the resume was scored against earlier requirements of the vacancy. Re-analyze it to score it against the current ones.',
    az: '"Köhnəlib" CV-nin vakansiyanın əvvəlki tələblərinə görə qiymətləndirildiyini bildirir. Cari tələblərə görə qiymətləndirmək üçün yenidən təhlil edin.',
    ru: '«Устарело» — резюме оценено по прежним требованиям вакансии. Проанализируйте заново, чтобы оценить по текущим.',
  },
  help_needs_look: {
    en: '"Needs a look" means the analysis could not finish on its own (for example the file was unreadable). A person should open it; it is not scored.',
    az: '"Baxış tələb edir" təhlilin özbaşına tamamlana bilmədiyini bildirir (məsələn, fayl oxunmayıb). Bir nəfər açıb baxmalıdır; bal verilmir.',
    ru: '«Нужен взгляд» — анализ не смог завершиться сам (например, файл не читается). Нужно открыть вручную; балл не ставится.',
  },
  help_must_have: {
    en: 'A must-have is a requirement the vacancy cannot do without. Candidates missing one are not rejected: it lowers the score and is shown, and a person decides.',
    az: 'Vacib tələb vakansiyanın onsuz keçinə bilmədiyi tələbdir. Birini ödəməyən namizəd rədd edilmir: bal azalır və göstərilir, qərarı insan verir.',
    ru: 'Обязательное требование — то, без чего вакансия не обойдётся. Кандидата без него не отклоняют: балл снижается и это видно, решает человек.',
  },
  help_nice_to_have: {
    en: 'A nice-to-have adds to the score when found but its absence costs little.',
    az: 'Arzuolunan tələb tapıldıqda balı artırır, olmaması isə az təsir edir.',
    ru: 'Желательное требование добавляет баллы, если найдено, а его отсутствие стоит мало.',
  },
  help_bands: {
    en: 'Bands group scores: Strong 80 and above, Good 70 to 79, Partial 50 to 69, Limited below 50. They are a guide for ordering, not a verdict.',
    az: 'Səviyyələr balları qruplaşdırır: Güclü 80 və yuxarı, Yaxşı 70-79, Qismən 50-69, Məhdud 50-dən aşağı. Bu, sıralama üçün bələdçidir, hökm deyil.',
    ru: 'Уровни группируют баллы: Сильное — от 80, Хорошее — 70–79, Частичное — 50–69, Слабое — ниже 50. Это ориентир для порядка, а не приговор.',
  },
  help_shortlist: {
    en: 'The Shortlist is your own mark on a candidate. It does not change the score and nobody else is told by it.',
    az: 'Qısa siyahı sizin namizədə qoyduğunuz qeyddir. Balı dəyişmir və bununla başqasına xəbər verilmir.',
    ru: 'Короткий список — ваша собственная отметка кандидата. Балл она не меняет, другим ничего не сообщается.',
  },
  help_star_map: {
    en: 'The star map shows how well each candidate covers the requirements of a vacancy, one ray per requirement.',
    az: 'Ulduz xəritəsi hər namizədin vakansiyanın tələblərini nə qədər ödədiyini göstərir, hər tələb üçün bir şüa.',
    ru: 'Звёздная карта показывает, как кандидат покрывает требования вакансии: один луч на требование.',
  },
  help_reanalyze: {
    en: 'Re-analyze reads the resume again against the current requirements and replaces the match; earlier results stay in the history.',
    az: 'Yenidən təhlil CV-ni cari tələblərə görə təkrar oxuyur və nəticəni əvəz edir; əvvəlkilər tarixçədə qalır.',
    ru: 'Повторный анализ заново читает резюме по текущим требованиям и заменяет результат; прежние остаются в истории.',
  },
  help_score: {
    en: 'The score is arithmetic over the requirements: each found requirement adds its weight. The breakdown is always one click away, and a score never appears without it.',
    az: 'Bal tələblər üzrə hesabdır: tapılan hər tələb öz çəkisini əlavə edir. Hesablama həmişə bir kliklə əlçatandır, bal onsuz görünmür.',
    ru: 'Балл — арифметика по требованиям: каждое найденное требование добавляет свой вес. Расшифровка всегда в один клик, балла без неё не бывает.',
  },
  // statuses for the compare table
  st_met: { en: 'Met', az: 'Var', ru: 'Есть' },
  st_partially_met: { en: 'Partly', az: 'Qismən', ru: 'Частично' },
  st_not_met: { en: 'Not met', az: 'Yoxdur', ru: 'Нет' },
  st_not_found: { en: 'Not found', az: 'Tapılmadı', ru: 'Не найдено' },
  st_ambiguous: { en: 'Unclear', az: 'Aydın deyil', ru: 'Неясно' },
  st_not_applicable: { en: 'n/a', az: 'aid deyil', ru: 'н/п' },
  // table heads
  hRequirement: { en: 'Requirement', az: 'Tələb', ru: 'Требование' },
  hKind: { en: 'Kind', az: 'Növ', ru: 'Тип' },
  hMet: { en: 'Meet it', az: 'Ödəyir', ru: 'Выполняют' },
  hCandidate: { en: 'Candidate', az: 'Namizəd', ru: 'Кандидат' },
  hQuestion: { en: 'Question', az: 'Sual', ru: 'Вопрос' },
  hAnswer: { en: 'Answer', az: 'Cavab', ru: 'Ответ' },
  hScore: { en: 'Score', az: 'Bal', ru: 'Балл' },
  whatIfChipMust: {
    en: 'What if "{req}" were a must-have?',
    az: '"{req}" vacib olsaydı nə olardı?',
    ru: 'А если «{req}» было бы обязательным?',
  },
  hWhat: { en: 'What', az: 'Nə', ru: 'Что' },
  hVacancy: { en: 'Vacancy', az: 'Vakansiya', ru: 'Вакансия' },
  hWhen: { en: 'When', az: 'Nə vaxt', ru: 'Когда' },
  hNow: { en: 'Now', az: 'İndi', ru: 'Сейчас' },
  hIf: { en: 'If changed', az: 'Dəyişsə', ru: 'Если изменить' },
  kMust: { en: 'Must-have', az: 'Vacib', ru: 'Обязательное' },
  kNice: { en: 'Nice-to-have', az: 'Arzuolunan', ru: 'Желательное' },
  everywhere: { en: 'all vacancies', az: 'bütün vakansiyalar', ru: 'всем вакансиям' },
} as const;

export type TKey = keyof typeof W;

export const tsay = (lang: Lang, key: TKey, vars: Record<string, string | number> = {}): string =>
  W[key][lang].replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));

export const helpKey = (topic: string): TKey | null =>
  `help_${topic}` in W ? (`help_${topic}` as TKey) : null;
