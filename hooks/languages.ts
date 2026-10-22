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
