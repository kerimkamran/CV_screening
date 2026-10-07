/** Sign-in, menu, footer, shared labels, and the server messages people meet most often. */
export const AZ_SHELL: Record<string, string> = {
  // header, menu, footer
  'New screening': 'Yeni yoxlama',
  'Past scans': 'Keçmiş yoxlamalar',
  'Shared with me': 'Mənimlə paylaşılanlar',
  Admin: 'İdarə',
  Administration: 'İdarəetmə',
  Users: 'İstifadəçilər',
  'AI models': 'Süni intellekt modelləri',
  Assistant: 'Köməkçi',
  Main: 'Əsas',
  Password: 'Parol',
  'Sign out': 'Çıxış',
  Language: 'Dil',
  Background: 'Fon',
  'Page background': 'Səhifə fonu',
  'Match my device': 'Cihazıma uyğun',
  White: 'Ağ',
  'White-grey': 'Ağ-boz',
  Sky: 'Səma',
  Dark: 'Tünd',
  'Focus on skills': 'Bacarıqlara fokus',
  'Hides file names and "Reveal all names" so the first look is only about skills. Hidden on screen, not a guarantee.':
    'Fayl adlarını və “Bütün adları göstər” seçimini gizlədir ki, ilk baxış yalnız bacarıqlara aid olsun. Ekranda gizlədilir, təminat deyil.',
  'Could not save your choice. It applies on this device only for now.':
    'Seçiminiz saxlanmadı. Hələlik yalnız bu cihazda keçərlidir.',
  'Loading…': 'Yüklənir…',
  'Administrators only.': 'Yalnız administratorlar üçün.',
  'Administrators manage users and AI models under Admin. Candidate data is available only to recruiters.':
    'Administratorlar istifadəçiləri və süni intellekt modellərini “İdarə” bölməsində idarə edir. Namizəd məlumatları yalnız işə götürənlər üçün əlçatandır.',
  'AI-assisted screening: scores and rankings are recommendations. Every decision about a candidate is made by a person and recorded under their name.':
    'Süni intellektlə dəstəklənən yoxlama: bal və sıralama yalnız tövsiyədir. Namizəd barədə hər qərarı insan verir və onun adı ilə qeyd olunur.',
  'Checking service…': 'Xidmət yoxlanılır…',
  'Service ready': 'Xidmət hazırdır',
  'Service unavailable': 'Xidmət əlçatan deyil',
  'Your session ended. Please sign in again.':
    'Sessiyanız bitdi. Zəhmət olmasa yenidən daxil olun.',
  'You were signed out after 30 minutes of inactivity.':
    '30 dəqiqə hərəkətsizlikdən sonra sistemdən çıxarıldınız.',
  'Data retention': 'Məlumatın saxlanma müddəti',
  // two-step sign-in
  Security: 'Təhlükəsizlik',
  'Two-step sign-in': 'İki addımlı daxil olma',
  'After your password, you enter a six-digit code from an authenticator app on your phone. It protects your account if your password is stolen.':
    'Paroldan sonra telefonunuzdakı autentifikator tətbiqindən altı rəqəmli kod daxil edirsiniz. Parol oğurlansa belə, hesabınızı qoruyur.',
  'Your organisation signs you in elsewhere, so two-step sign-in is managed there.':
    'Təşkilatınız sizi başqa yerdə daxil edir, ona görə iki addımlı daxil olma orada idarə olunur.',
  'Two-step sign-in is on.': 'İki addımlı daxil olma aktivdir.',
  'Save these recovery codes somewhere safe. Each works once if you lose your phone. They are shown only now.':
    'Bu bərpa kodlarını təhlükəsiz yerdə saxlayın. Telefonunuzu itirsəniz, hər biri bir dəfə işləyir. Yalnız indi göstərilir.',
  'Recovery codes': 'Bərpa kodları',
  'I have saved them': 'Saxladım',
  'Two-step sign-in is on. Recovery codes left: {n}':
    'İki addımlı daxil olma aktivdir. Qalan bərpa kodları: {n}',
  'Your password': 'Parolunuz',
  'Turn off two-step sign-in': 'İki addımlı daxil olmanı söndürün',
  'Turn off': 'Söndürün',
  'In your authenticator app, add an account and enter this key (or open the link on your phone):':
    'Autentifikator tətbiqində hesab əlavə edin və bu açarı daxil edin (və ya linki telefonunuzda açın):',
  'Open in authenticator app': 'Autentifikator tətbiqində açın',
  'Code shown in the app': 'Tətbiqdə göstərilən kod',
  'Turn on': 'Aktiv edin',
  'Set up two-step sign-in': 'İki addımlı daxil olmanı qurun',
  'Code from your authenticator app': 'Autentifikator tətbiqindən kod',
  'Six digits. Lost your phone? Use one of your recovery codes instead.':
    'Altı rəqəm. Telefonunuzu itirmisiniz? Əvəzinə bərpa kodlarından birini daxil edin.',
  // sign-in and passwords
  'Sign in': 'Daxil olun',
  'Signing in…': 'Daxil olunur…',
  Email: 'E-poçt',
  'Accounts are created by your administrator, who sends you an invitation link.':
    'Hesabları administrator yaradır və sizə dəvət linki göndərir.',
  'The new passwords do not match': 'Yeni parollar eyni deyil',
  'The passwords do not match': 'Parollar eyni deyil',
  'Choose your own password': 'Özünüz üçün parol seçin',
  'Change password': 'Parolu dəyişin',
  'Your temporary password must be replaced before you continue.':
    'Davam etməzdən əvvəl müvəqqəti parolu dəyişməlisiniz.',
  'Temporary password (from your email)': 'Müvəqqəti parol (e-poçtunuzdan)',
  'Current password': 'Cari parol',
  'New password': 'Yeni parol',
  'At least 12 characters. A short sentence works well.':
    'Ən azı 12 simvol. Qısa bir cümlə yaxşı işləyir.',
  'Repeat new password': 'Yeni parolu təkrarlayın',
  'Save password': 'Parolu saxlayın',
  'Choose your password': 'Parolunuzu seçin',
  'Go to sign in': 'Daxil olma səhifəsinə keçin',
  'Checking your link…': 'Linkiniz yoxlanılır…',
  'Welcome, {name}. Choose a password for your account:':
    '{name}, xoş gəlmisiniz. Hesabınız üçün parol seçin:',
  'Save password and sign in': 'Parolu saxlayın və daxil olun',
  // statuses and labels used on several screens
  Met: 'Ödənilir',
  'Partially met': 'Qismən ödənilir',
  'Not met': 'Ödənilmir',
  'Not found in CV': 'CV-də tapılmadı',
  Unclear: 'Aydın deyil',
  'Not applicable': 'Aid deyil',
  'Strong match': 'Güclü uyğunluq',
  'Possible match': 'Mümkün uyğunluq',
  'Weak match': 'Zəif uyğunluq',
  'Needs review': 'Baxış tələb olunur',
  Shortlisted: 'Qısa siyahıda',
  Maybe: 'Bəlkə',
  'Not now': 'İndi yox',
  Strong: 'Güclü',
  Good: 'Yaxşı',
  Partial: 'Qismən',
  Limited: 'Məhdud',
  'Needs a human look': 'İnsan baxışı lazımdır',
  // common server messages
  'Something went wrong': 'Nəsə səhv getdi',
  'Invalid email or password': 'E-poçt və ya parol yanlışdır',
  'Too many attempts. Try again later.': 'Çox cəhd edildi. Bir az sonra yenidən yoxlayın.',
  'Not found': 'Tapılmadı',
  Forbidden: 'İcazə yoxdur',
  'Forbidden resource': 'İcazə yoxdur',
};
