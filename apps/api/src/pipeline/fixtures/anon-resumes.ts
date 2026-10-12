/** The 10-resume fixture pack for the anonymiser (Development Plan WP 3.5): zero misses allowed. */
export interface AnonFixture {
  id: string;
  names: string[];
  text: string;
  /** every one of these must be absent from the anonymised text */
  hidden: string[];
  /** every one of these must still be there */
  kept: string[];
}

export const ANON_FIXTURES: AnonFixture[] = [
  {
    id: 'en-network-engineer',
    names: ['Rashad Aliyev'],
    text: `Rashad Aliyev
Network Engineer
Email: rashad.aliyev@example.com
Phone: +994 50 123 45 67
LinkedIn: https://www.linkedin.com/in/rashad-aliyev
Date of birth: 14.03.1988
Marital status: Married, 2 children
Nationality: Azerbaijani

Experience
2016-2024 Azercell, Senior Network Engineer. Built MPLS and BGP routing for the core network.
R. Aliyev led the migration to 5G transport.
Education
Baku State University, BSc Telecommunications, 2010`,
    hidden: [
      'Rashad',
      'Aliyev',
      'rashad.aliyev@example.com',
      '123 45 67',
      'linkedin.com',
      '14.03.1988',
      'Married',
      'Azerbaijani',
    ],
    kept: ['Azercell', 'MPLS and BGP', 'Baku State University', '2016-2024', 'Network Engineer'],
  },
  {
    id: 'az-patronymic',
    names: ['Leyla Məmmədova'],
    text: `LEYLA MƏMMƏDOVA
Ad, soyad, ata adı: Leyla Məmmədova Elçin qızı
Doğum tarixi: 02.11.1992
Ailə vəziyyəti: subay
Cinsi: qadın
Ünvan: Bakı, Nərimanov rayonu, Əhməd Rəcəbli küç. 12, ev 4
Tel: (050) 777-88-99
E-poçt: leyla.m@mail.az

İş təcrübəsi
2018–2024 Kapital Bank, Proqram təminatı mühəndisi. Java və PostgreSQL ilə ödəniş sistemi hazırlayıb.
Təhsil: Azərbaycan Texniki Universiteti, bakalavr, 2014`,
    hidden: [
      'Leyla',
      'Məmmədova',
      'LEYLA',
      'MƏMMƏDOVA',
      'Elçin',
      '02.11.1992',
      'subay',
      'qadın',
      'Rəcəbli',
      '777-88-99',
      'leyla.m@mail.az',
    ],
    kept: ['Kapital Bank', 'Java və PostgreSQL', 'Azərbaycan Texniki Universiteti', '2018–2024'],
  },
  {
    id: 'ru-analyst',
    names: ['Ирина Петрова'],
    text: `Ирина Петрова
Дата рождения: 5 мая 1990
Пол: женский
Семейное положение: замужем
Гражданство: Россия
Телефон: +7 912 345 67 89
Адрес: Москва, ул. Ленина, д. 5, кв. 12

Опыт работы
2015-2023 Яндекс, аналитик данных. SQL, Python, построение дашбордов.
Образование: МГУ, прикладная математика, 2012
Петрова И. руководила командой из 5 человек.`,
    hidden: [
      'Ирина',
      'Петрова',
      '5 мая 1990',
      'женский',
      'замужем',
      'Россия',
      '912 345 67 89',
      'Ленина',
    ],
    kept: ['Яндекс', 'SQL, Python', 'МГУ', '2015-2023'],
  },
  {
    id: 'en-initials-honorific',
    names: ['John Michael Smith'],
    text: `CURRICULUM VITAE
Mr. John Michael Smith
Gender: Male
Age: 41
Mobile: 055 888 99 00
Email: jsmith@corp.example.org
Telegram: @jsmith_dev

Summary
J. M. Smith is a project manager with 12 years of experience in telecom rollouts. Smith managed budgets above 2M AZN.
Employment: Azerconnect, Project Manager 2019-2025.
Passport No: AA1234567
FIN: 5ABC123`,
    hidden: [
      'John',
      'Michael',
      'Smith',
      'jsmith',
      'Male',
      '888 99 00',
      'AA1234567',
      '5ABC123',
      '@jsmith_dev',
    ],
    kept: ['Azerconnect', 'project manager', '12 years', 'telecom rollouts', '2019-2025'],
  },
  {
    id: 'az-latin-no-diacritics',
    names: ['Nigar Huseynova'],
    text: `Nigar Huseynova
Dogum tarixi: 10 mart 1995
Milliyyeti: azerbaycanli
Aile veziyyeti: evli
Telefon: 070 555 12 34
nigar.h@gmail.com
Veb: www.nigar-portfolio.example.com

Is tecrubesi
2019-2025 PASHA Bank, Data Analyst. Power BI, SQL, Python.
Huseynova N. 2023-cu ilde ilin isci mukafatini alib.`,
    hidden: [
      'Nigar',
      'Huseynova',
      '10 mart 1995',
      'azerbaycanli',
      'evli',
      '555 12 34',
      'nigar.h@gmail.com',
      'nigar-portfolio',
    ],
    kept: ['PASHA Bank', 'Power BI, SQL, Python', '2019-2025'],
  },
  {
    id: 'en-two-pages',
    names: ['Elvin Jafarov'],
    text: `Elvin Jafarov — Cloud Architect
elvin@jafarov.example | +994 12 498 00 00 | github.com/ejafarov
Born: 1985 in Ganja
Sex: M

Profile
Cloud architect with AWS and Azure certifications. Elvin has delivered 20 migrations.
Jafarov's team reduced cost by 30%.

Work history
Microsoft Azerbaijan 2013-2020; Delivery Hero 2020-2025.`,
    hidden: [
      'Elvin',
      'Jafarov',
      'elvin@jafarov.example',
      '498 00 00',
      'github.com/ejafarov',
      'Ganja',
    ],
    kept: ['Cloud architect', 'AWS and Azure', 'Microsoft Azerbaijan', 'Delivery Hero', '30%'],
  },
  {
    id: 'az-short',
    names: ['Tural Qasımov'],
    text: `Tural Qasımov
Yaş: 29
Telefon: +994 55 321 00 11
tural.qasimov@outlook.com

Təcrübə: Azercosmos, DevOps mühəndisi (2021-2025). Kubernetes, Terraform, CI/CD.
Qasımov T. Kubernetes sertifikatı alıb.`,
    hidden: ['Tural', 'Qasımov', '29', '321 00 11', 'tural.qasimov@outlook.com'],
    kept: ['Azercosmos', 'Kubernetes, Terraform, CI/CD', '2021-2025'],
  },
  {
    id: 'en-headers-only-last-name',
    names: ['Sevinj Karimova'],
    text: `KARIMOVA, SEVINJ
Place of birth: Sumgait
Children: 1
Religion: none stated
Photo: attached
+994 51 234 56 78 | sevinj.k@example.net

HR Business Partner
Karimova joined Bakcell in 2017 and moved into talent acquisition. Sevinj runs 40 hires a quarter.
Education: ADA University, MBA, 2016`,
    hidden: [
      'SEVINJ',
      'KARIMOVA',
      'Sumgait',
      'none stated',
      'attached',
      '234 56 78',
      'sevinj.k@example.net',
      'Karimova',
      'Sevinj',
    ],
    kept: ['HR Business Partner', 'Bakcell', 'talent acquisition', 'ADA University', '40 hires'],
  },
  {
    id: 'ru-az-mixed',
    names: ['Фарид Гусейнов', 'Farid Huseynov'],
    text: `Фарид Гусейнов (Farid Huseynov)
Телефон: +994 77 000 11 22
Email: farid@huseynov.example
Национальность: азербайджанец
Возраст: 34

Опыт: Bakcell, Руководитель проектов, 2016-2025. Agile, Scrum, бюджет 3 млн.
F. Huseynov получил сертификат PMP в 2020.`,
    hidden: [
      'Фарид',
      'Гусейнов',
      'Farid',
      'Huseynov',
      '000 11 22',
      'farid@huseynov.example',
      'азербайджанец',
      '34',
    ],
    kept: ['Bakcell', 'Agile, Scrum', 'PMP', '2016-2025'],
  },
  {
    id: 'en-lowercase-name-and-oglu',
    names: ['Orkhan Mammadov'],
    text: `orkhan mammadov
Full name: Orkhan Mammadov Rafig oglu
Date of birth: 01/09/1987
Driver's license: B, no. 1234567
E-mail: orkhan@mammadov.example
Phone: 994502223344

Experience
2012-2025 Azercell, Radio Planning Engineer. Planned LTE and 5G sites; mammadov was responsible for a 300-site rollout.`,
    hidden: [
      'orkhan',
      'mammadov',
      'Orkhan',
      'Mammadov',
      'Rafig',
      '01/09/1987',
      '1234567',
      'orkhan@mammadov.example',
      '994502223344',
    ],
    kept: ['Azercell', 'Radio Planning Engineer', 'LTE and 5G', '300-site', '2012-2025'],
  },
];
