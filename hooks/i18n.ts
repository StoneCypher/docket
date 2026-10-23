// docket's own words, per language. English is here in code; every other language is a file,
// locales/<code>.json, mapping each English string to its translation, so translators edit JSON beside
// the English they translate. Each translation, and the file as a whole, says how ready it is: false
// (not translated; English shows), "ai translated", or true (checked by a person).
// Each list's letter, which labels its items (Q12, P12, 質12), is the first character of its name in
// that language, so names are chosen to start with letters unique within the language.
import type { Item, Letter } from '../types'
import { codeOf, normalCode } from './languages.ts'

// A language's code, as its file in locales/ is named: "es", "pt-BR".
export type Language = string

export type Strings = {
  language: string
  lists: Record<Letter, { name: string; letter: string }>
  lean: string
  new: string
  more: string
  fewer: string
  nothing: string
  bulk: { Q: string; C: string; R: string }
  send: {
    acceptLean: string
    rejectLean: string
    pick: string
    approve: string
    decline: string
    confirm: string
    notConfirm: string
    start: string
    acceptLeans: string
    confirmAll: string
    approveAll: string
  }
  settings: {
    title: string
    done: string
    editingYours: string
    editingProject: string
    copyToProject: string
    mobile: string
    capTitle: string
    capDescription: string
    noVoice: string
  }
  config: { offer: string; lookAt: string; updated: string; updatedAdding: string; unreadable: string }
  // Offers to help with a language docket speaks: machine-translated, or behind English.
  translate: { machine: string; behind: string }
  // The yes and no buttons. Never translated: only a dialect changes them, with text and perhaps an
  // image's file name, which the mod reads into the SVG's source where a surface draws SVG.
  marks: { yes: string; no: string; yesImage?: string; noImage?: string }
  fields: Record<string, [string, string]>
}

export const EN: Strings = {
  language: 'English',
  lists: {
    R: { name: 'Requests', letter: 'R' },
    Q: { name: 'Questions', letter: 'Q' },
    C: { name: 'Confirm', letter: 'C' },
    N: { name: 'Needs you', letter: 'N' },
    V: { name: 'View', letter: 'V' },
    U: { name: 'Underway', letter: 'U' },
    L: { name: 'Later', letter: 'L' },
    W: { name: 'Waiting', letter: 'W' },
    P: { name: 'Pinned', letter: 'P' },
  },
  lean: 'Lean',
  new: '(new)',
  more: '+{n} more',
  fewer: 'fewer',
  nothing: 'Nothing on the docket.',
  bulk: { Q: 'Accept all leans', C: 'Confirm all', R: 'Approve all' },
  send: {
    acceptLean: 'Accept the lean on {id}.',
    rejectLean: 'No to the lean on {id}.',
    pick: '{id} ({option}).',
    approve: 'Approved {id}.',
    decline: 'Declined {id}.',
    confirm: 'Confirmed {id}.',
    notConfirm: 'Not confirmed {id}.',
    start: 'Start {id} now.',
    acceptLeans: 'Accept the leans on {ids}.',
    confirmAll: 'Confirmed {ids}.',
    approveAll: 'Approved {ids}.',
  },
  settings: {
    title: 'Settings',
    done: 'Done',
    editingYours: 'Editing your config:',
    editingProject: 'Editing this project’s config, which overrides yours:',
    copyToProject: 'Make a copy for this project',
    mobile: 'Settings need the terminal, desktop or VS Code.',
    capTitle: '{list} cap',
    capDescription: 'Items shown in {list} before "+N more"',
    noVoice: 'No voice',
  },
  config: {
    offer: "Create docket's config at {path}, with every setting at its default? You can edit it there, or with ⚙.",
    lookAt: 'Look at your new config: {path}. Every setting is there at its default.',
    updated: 'docket updated its config at {path} from version {from} to {to}.',
    updatedAdding: 'docket updated its config at {path} from version {from} to {to}, adding {added} at their defaults.',
    unreadable: "docket couldn't read its config at {path}, so it's using the defaults until the file is fixed.",
  },
  translate: {
    machine:
      `docket's {language} was machine-translated. Help make it read naturally? ✔ opens [its file]({link}) in GitHub's editor: fix any string, set its "ready" to true, and save to propose it.`,
    behind:
      `docket has new English its {language} doesn't translate yet. Help [bring it up to date]({link})? ✔ opens the file in GitHub's editor: fill in each empty "text", and save to propose it.`,
  },
  marks: { yes: '✔', no: '✗' },
  fields: {
    language: ['Language', "Language of the docket's own words: auto follows Claude Code's language setting"],
    voice: ['Voice', "A character Claude writes the docket's items as, in any language"],
    display: ['Display', 'A pane beside the transcript, or a band above the prompt'],
    emoji: ['Emoji', 'Master switch for every emoji the docket draws'],
    headingEmoji: ['Heading emoji', "An emoji before each list's heading"],
    noItemEmojiLists: ['Lists without item emoji', 'Letters of lists whose items draw no emoji, e.g. "Q,P"'],
    inlineLists: ['Inline lists', 'Letters of lists drawn on one line, separated by dots'],
    targetWords: ['Target lengths', 'Soft word limits per list, e.g. "P=8,Q=30"'],
    stakesDisplay: ['Stakes display', 'How stakes markers show'],
    itemColor: ['Item color', 'Color of an item changed this turn, a hex or a theme key'],
    itemDimColor: ['Dimmed item color', 'Color of an item unchanged since the last turn'],
    upArrowColor: ['Growing arrow', 'Color of the ↑ when a list grew this turn'],
    upNumberColor: ['Growing number', "Color of the count beside a growing list's ↑"],
    downArrowColor: ['Shrinking arrow', 'Color of the ↓ when a list shrank this turn'],
    downNumberColor: ['Shrinking number', "Color of the count beside a shrinking list's ↓"],
    leanColor: ['Lean color', "Color of the lean line, a hex or a theme key; empty for the item's own color"],
    leanDimColor: ['Dimmed lean color', 'Color of the lean line while its item is dimmed as unchanged'],
    answeredLingerSeconds: ['Answered linger', 'Seconds an item answered by button stays up, dimmed, before it goes'],
    strikeLingerMinutes: ['Strike linger', 'Minutes an item Claude closed on its own stays up struck through'],
  },
}

// Fills {name} slots in a template.
export const fill = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in values ? String(values[name]) : whole))

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

// Every string in a set of words, with where it sits; the language's name and the letters aren't
// translated, as they come from the language table and the list names.
const leaves = (value: unknown, at = ''): [string, string][] =>
  typeof value === 'string'
    ? at === 'language' || at.endsWith('.letter') || at.startsWith('marks.')
      ? []
      : [[at, value]]
    : Array.isArray(value)
      ? value.flatMap((each, i) => leaves(each, `${at}.${i}`))
      : isRecord(value)
        ? Object.entries(value).flatMap(([key, each]) => leaves(each, at ? `${at}.${key}` : key))
        : []

// The English strings a language file translates, each once, in the order docket uses them.
export const keysOf = () => [...new Set(leaves(EN).map(([, english]) => english))]

// Raise this whenever English's strings change, then run `npm run locales`: each file gains the new
// strings, blank, and loses the ones English no longer says. A file's own version says which of
// these it was last brought up to date with, so docket can ask for help when it falls behind.
export const STRINGS_VERSION = 2

export type Readiness = boolean | 'ai translated'
export const AI = 'ai translated'
export type Translation = { text: string; ready: Readiness }

const readinessOf = (value: unknown): Readiness => (value === true || value === AI ? value : false)

// What a language file says about itself, beside its strings.
export type FileState = { ready: Readiness; version: number }

export const stateOf = (file: unknown): FileState => {
  const found = isRecord(file) ? file : {}

  return { ready: readinessOf(found.ready), version: typeof found.version === 'number' ? found.version : 0 }
}

// One string's translation as a file holds it; a bare string counts as machine-made.
export const translationOf = (value: unknown): Translation =>
  typeof value === 'string'
    ? { text: value, ready: value.trim() ? AI : false }
    : isRecord(value)
      ? { text: typeof value.text === 'string' ? value.text : '', ready: readinessOf(value.ready) }
      : { text: '', ready: false }

// A language's file brought in line with English: its state first, then every English string in
// docket's order, translated where it was, blank where not. Strings English no longer says are dropped.
// A dialect's file also keeps its name, which is what Claude is told the docket is written in, and
// any buttons of its own; any file keeps its voices.
export const synced = (file: unknown) => {
  const found = isRecord(file) ? file : {}
  const { ready, version } = stateOf(found)
  const words = Object.fromEntries(keysOf().map(key => [key, translationOf(found[key])]))
  const kept = Object.fromEntries(
    (['name', 'tag', 'cast', 'marks', 'voice', 'voices'] as const).filter(key => found[key] !== undefined).map(key => [key, found[key]]),
  )

  return `${JSON.stringify({ ...kept, ready, version, ...words }, null, 2)}
`
}

// How Claude writes the docket's items, if a file or the config says: a voice for everything, and
// one per list. A file names lists by their English names ("View") or letters ("V"); later files
// win, list by list.
export type Voice = { all: string; lists: Partial<Record<Letter, string>> }

export const voiceOf = (...files: unknown[]): Voice => {
  const voice: Voice = { all: '', lists: {} }
  for (const file of files) {
    if (!isRecord(file)) continue
    if (typeof file.voice === 'string' && file.voice.trim()) voice.all = file.voice.trim()
    if (!isRecord(file.voices)) continue
    for (const [key, said] of Object.entries(file.voices)) {
      const letter = (Object.keys(EN.lists) as Letter[]).find(each => each === key || EN.lists[each].name === key)
      if (letter && typeof said === 'string' && said.trim()) voice.lists[letter] = said.trim()
    }
  }

  return voice
}

// A name's first character, as a capital where the script has one in common use. Georgian's capitals
// (Mtavruli) are rare in fonts, so Georgian keeps its usual letters.
export const firstLetter = (name: string) => {
  const first = [...name.trim()][0] ?? ''
  const upper = first.toUpperCase()

  return /[\u1C90-\u1CBF]/u.test(upper) ? first : upper
}

// A dialect's own button, as text or { text, image }, or the usual one.
const markOf = (marks: unknown, key: string, usual: string) => {
  const mark = isRecord(marks) ? marks[key] : undefined
  const text = isRecord(mark) ? mark.text : mark

  return typeof text === 'string' && text.trim() ? text : usual
}

// The file a dialect's button draws where it can, if it names one: an .svg beside the dialect.
export const markImage = (file: unknown, key: 'yes' | 'no') => {
  const marks = isRecord(file) ? file.marks : undefined
  const mark = isRecord(marks) ? marks[key] : undefined
  const image = isRecord(mark) ? mark.image : undefined

  return typeof image === 'string' && /^[\w.-]+\.svg$/.test(image) ? image : undefined
}

// docket's words in a language, from its file: each translated string over the English. Each list's
// letter is its translated name's first character; if two lists would share one, every list keeps
// its English letter, so no label is ever ambiguous.
export const translate = (file: unknown, language: string): Strings => {
  const words = isRecord(file) ? file : {}
  const say = (english: string) => {
    const { text, ready } = translationOf(words[english])

    return ready !== false && text.trim() ? text : english
  }
  const walk = (value: unknown, at: string): unknown =>
    typeof value === 'string'
      ? at === 'language'
        ? language
        : at.endsWith('.letter')
          ? value
          : at.startsWith('marks.')
            ? markOf(words.marks, at.slice('marks.'.length), value)
            : say(value)
      : Array.isArray(value)
        ? value.map((each, i) => walk(each, `${at}.${i}`))
        : isRecord(value)
          ? Object.fromEntries(Object.entries(value).map(([key, each]) => [key, walk(each, at ? `${at}.${key}` : key)]))
          : value
  const text = walk(EN, '') as Strings
  const letters = (Object.keys(text.lists) as Letter[]).map(letter => [letter, firstLetter(text.lists[letter].name)] as const)
  if (new Set(letters.map(([, each]) => each)).size === letters.length && letters.every(([, each]) => each)) {
    for (const [letter, each] of letters) text.lists[letter].letter = each
  }

  return text
}

// docket's setting wins, as a language's name or code, or any code with a file in locales/; "auto" or
// nothing follows Claude Code's language, and English is the fallback. The code may have no file yet.
export const resolveLanguage = (setting: unknown, claudeCode: unknown, available: readonly string[] = []): Language => {
  const own = setting && setting !== 'auto' ? String(setting) : undefined
  const code = own && normalCode(own)

  return (own && (codeOf(own) ?? (code && available.includes(code) ? code : undefined))) || codeOf(claudeCode) || 'en'
}

// An item's label as the user sees it: the language's letter for its list, then its number.
export const labelOf = (text: Strings, item: Pick<Item, 'list' | 'n'>) => `${text.lists[item.list].letter}${item.n}`

// An internal id ("Q12") as the user sees it.
export const labelOfId = (text: Strings, id: string) => {
  const list = text.lists[id[0] as Letter]

  return list ? `${list.letter}${id.slice(1)}` : id
}

// The internal letter for a letter the user typed in this language, if any.
// A letter without its accents, in lower case: how someone without the accent on their keyboard types it.
export const foldLetter = (letter: string) => letter.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

// The letters a language's labels can be typed with: each list's own, and its unaccented form where
// no other list's letter folds to the same (İ as i in Turkish; but Czech's Ž and Z stay apart).
export const typedLetters = (text: Strings) => {
  const own = Object.values(text.lists).map(list => list.letter)
  const folded = own.map(foldLetter)
  const isUnique = (each: string) => folded.filter(other => other === each).length === 1

  return [...new Set([...own, ...folded.filter(isUnique)])]
}

// The internal letter for a letter the user typed in this language, if any: as written, else unaccented.
export const letterFor = (text: Strings, typed: string): Letter | undefined => {
  const letters = Object.keys(text.lists) as Letter[]
  const exact = letters.find(letter => text.lists[letter].letter.toLowerCase() === typed.toLowerCase())
  if (exact) return exact
  const loose = letters.filter(letter => foldLetter(text.lists[letter].letter) === foldLetter(typed))

  return loose.length === 1 ? loose[0] : undefined
}

// An id the user or Claude wrote in this language ("P12" in Spanish) as the internal id ("Q12"), or
// undefined when no list of this language has its letter.
export const idFor = (text: Strings, label: string) => {
  const [, typed = '', n = ''] = /^(.+?)(\d+)$/u.exec(label.trim()) ?? []
  const letter = letterFor(text, typed)

  return letter ? `${letter}${Number(n)}` : undefined
}
