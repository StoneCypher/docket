// The languages docket can recognize, whether or not it has a file for them yet: each code with its
// English name first, then the other names Claude Code's free-form language setting may use.
// A language docket has no file for gets English, and an offer to help translate.
export const NAMES: Record<string, readonly string[]> = {
  en: ['English'],
  es: ['Spanish', 'Español', 'Espanol', 'Castellano'],
  fr: ['French', 'Français', 'Francais'],
  de: ['German', 'Deutsch'],
  it: ['Italian', 'Italiano'],
  'pt-BR': ['Brazilian Portuguese', 'Portuguese (Brazil)', 'Português do Brasil', 'Português brasileiro'],
  pt: ['Portuguese', 'Português', 'Portugues'],
  nl: ['Dutch', 'Nederlands'],
  sv: ['Swedish', 'Svenska'],
  no: ['Norwegian', 'Norsk', 'Bokmål'],
  da: ['Danish', 'Dansk'],
  fi: ['Finnish', 'Suomi'],
  is: ['Icelandic', 'Íslenska'],
  pl: ['Polish', 'Polski'],
  cs: ['Czech', 'Čeština'],
  sk: ['Slovak', 'Slovenčina'],
  hu: ['Hungarian', 'Magyar'],
  ro: ['Romanian', 'Română'],
  bg: ['Bulgarian', 'Български'],
  ru: ['Russian', 'Русский'],
  uk: ['Ukrainian', 'Українська'],
  el: ['Greek', 'Ελληνικά'],
  tr: ['Turkish', 'Türkçe'],
  ar: ['Arabic', 'العربية'],
  he: ['Hebrew', 'עברית'],
  fa: ['Persian', 'Farsi', 'فارسی'],
  hi: ['Hindi', 'हिन्दी'],
  bn: ['Bengali', 'Bangla', 'বাংলা'],
  ur: ['Urdu', 'اردو'],
  ta: ['Tamil', 'தமிழ்'],
  th: ['Thai', 'ไทย'],
  vi: ['Vietnamese', 'Tiếng Việt'],
  id: ['Indonesian', 'Bahasa Indonesia'],
  ms: ['Malay', 'Bahasa Melayu'],
  tl: ['Filipino', 'Tagalog'],
  'zh-TW': ['Traditional Chinese', 'Chinese (Traditional)', '繁體中文', '繁体中文'],
  zh: ['Chinese', 'Simplified Chinese', 'Chinese (Simplified)', 'Mandarin', '简体中文', '中文'],
  ja: ['Japanese', '日本語'],
  ko: ['Korean', '한국어'],
  ca: ['Catalan', 'Català'],
  eu: ['Basque', 'Euskara'],
  gl: ['Galician', 'Galego'],
  hr: ['Croatian', 'Hrvatski'],
  sr: ['Serbian', 'Српски', 'Srpski'],
  sl: ['Slovenian', 'Slovenščina'],
  lt: ['Lithuanian', 'Lietuvių'],
  lv: ['Latvian', 'Latviešu'],
  et: ['Estonian', 'Eesti'],
  sw: ['Swahili', 'Kiswahili'],
  af: ['Afrikaans'],
  cy: ['Welsh', 'Cymraeg'],
  ga: ['Irish', 'Gaeilge'],
  eo: ['Esperanto'],
  sq: ['Albanian', 'Shqip'],
  hy: ['Armenian', 'Հայերեն'],
  az: ['Azerbaijani', 'Azərbaycan dili'],
  be: ['Belarusian', 'Беларуская'],
  bs: ['Bosnian', 'Bosanski'],
  mk: ['Macedonian', 'Македонски'],
  mt: ['Maltese', 'Malti'],
  lb: ['Luxembourgish', 'Lëtzebuergesch'],
  fo: ['Faroese', 'Føroyskt'],
  nn: ['Norwegian Nynorsk', 'Nynorsk'],
  gd: ['Scottish Gaelic', 'Gàidhlig'],
  br: ['Breton', 'Brezhoneg'],
  fy: ['Frisian', 'Frysk', 'West Frisian'],
  co: ['Corsican', 'Corsu'],
  oc: ['Occitan', 'Occitan'],
  rm: ['Romansh', 'Rumantsch'],
  ast: ['Asturian', 'Asturianu'],
  'fr-CA': ['Canadian French', 'French (Canada)', 'Français canadien'],
  la: ['Latin', 'Latina'],
  yi: ['Yiddish', 'ייִדיש'],
  ka: ['Georgian', 'ქართული'],
  kk: ['Kazakh', 'Қазақ тілі'],
  ky: ['Kyrgyz', 'Кыргызча'],
  uz: ['Uzbek', 'Oʻzbek'],
  tg: ['Tajik', 'Тоҷикӣ'],
  tk: ['Turkmen', 'Türkmençe'],
  mn: ['Mongolian', 'Монгол'],
  tt: ['Tatar', 'Татар'],
  ba: ['Bashkir', 'Башҡорт'],
  ug: ['Uyghur', 'ئۇيغۇرچە'],
  bo: ['Tibetan', 'བོད་ཡིག'],
  ku: ['Kurdish', 'Kurdî', 'Kurmanji'],
  ckb: ['Central Kurdish', 'Sorani', 'کوردی'],
  ps: ['Pashto', 'پښتو'],
  sd: ['Sindhi', 'سنڌي'],
  ne: ['Nepali', 'नेपाली'],
  si: ['Sinhala', 'සිංහල'],
  mr: ['Marathi', 'मराठी'],
  gu: ['Gujarati', 'ગુજરાતી'],
  pa: ['Punjabi', 'ਪੰਜਾਬੀ'],
  kn: ['Kannada', 'ಕನ್ನಡ'],
  ml: ['Malayalam', 'മലയാളം'],
  te: ['Telugu', 'తెలుగు'],
  or: ['Odia', 'ଓଡ଼ିଆ', 'Oriya'],
  as: ['Assamese', 'অসমীয়া'],
  sa: ['Sanskrit', 'संस्कृतम्'],
  my: ['Burmese', 'မြန်မာ', 'Myanmar'],
  km: ['Khmer', 'ខ្មែរ', 'Cambodian'],
  lo: ['Lao', 'ລາວ'],
  yue: ['Cantonese', '粵語', '廣東話'],
  jv: ['Javanese', 'Basa Jawa'],
  su: ['Sundanese', 'Basa Sunda'],
  ceb: ['Cebuano', 'Sinugbuanon'],
  mi: ['Māori', 'Te Reo Māori', 'Maori'],
  haw: ['Hawaiian', 'ʻŌlelo Hawaiʻi'],
  sm: ['Samoan', 'Gagana Sāmoa'],
  to: ['Tongan', 'Lea faka-Tonga'],
  fj: ['Fijian', 'Na Vosa Vakaviti'],
  am: ['Amharic', 'አማርኛ'],
  ti: ['Tigrinya', 'ትግርኛ'],
  om: ['Oromo', 'Afaan Oromoo'],
  so: ['Somali', 'Soomaali'],
  ha: ['Hausa', 'Harshen Hausa'],
  yo: ['Yoruba', 'Yorùbá'],
  ig: ['Igbo', 'Asụsụ Igbo'],
  zu: ['Zulu', 'isiZulu'],
  xh: ['Xhosa', 'isiXhosa'],
  st: ['Sesotho', 'Sotho'],
  tn: ['Tswana', 'Setswana'],
  sn: ['Shona', 'chiShona'],
  ny: ['Chichewa', 'Chinyanja', 'Nyanja'],
  rw: ['Kinyarwanda', 'Ikinyarwanda'],
  mg: ['Malagasy', 'Fiteny malagasy'],
  lg: ['Ganda', 'Luganda'],
  ln: ['Lingala', 'Lingála'],
  wo: ['Wolof', 'Wolof'],
  ff: ['Fula', 'Fulfulde', 'Pulaar'],
  ak: ['Akan', 'Twi'],
  ee: ['Ewe', 'Eʋegbe'],
  ht: ['Haitian Creole', 'Kreyòl ayisyen'],
  qu: ['Quechua', 'Runasimi'],
  gn: ['Guarani', 'Avañeʼẽ'],
  ay: ['Aymara', 'Aymar aru'],
  tlh: ['Klingon', 'tlhIngan Hol'],
}

// A code as a language file is named: "pt_br" and "PT-BR" are both pt-BR.
const CODE = /^([a-z]{2,3})(?:[-_]([a-z]{2,4}))?$/i

export const normalCode = (text: string) => {
  const [, base = '', region] = CODE.exec(text.trim()) ?? []

  return base ? (region ? `${base.toLowerCase()}-${region.length === 2 ? region.toUpperCase() : region}` : base.toLowerCase()) : undefined
}

const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim()

// The code a language setting names: a code, or any of a language's names, alone or leading the
// setting ("japanese (日本語)"). Earlier entries win, so Brazilian Portuguese is checked before Portuguese.
export const codeOf = (name: unknown): string | undefined => {
  const text = fold(String(name ?? ''))
  if (!text) return undefined
  const entries = Object.entries(NAMES)
  const named = (test: (alias: string) => boolean) => entries.find(([, names]) => names.some(alias => test(fold(alias))))?.[0]
  const code = normalCode(text)

  return (
    named(alias => alias === text) ??
    (code && (code in NAMES || (code.split('-')[0] ?? '') in NAMES) ? code : undefined) ??
    named(alias => text.startsWith(alias) && !/\p{L}/u.test(text.charAt(alias.length)))
  )
}

// A code's English name, for Claude and for the offer to translate; an unlisted code is its own name.
export const englishName = (code: string) => NAMES[code]?.[0] ?? code

// A code's name in its own language, for asking its speakers; English where the table has no other.
export const nativeName = (code: string) => NAMES[code]?.[1] ?? englishName(code)
