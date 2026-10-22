// docket's own words, per language, read from locales/<code>.json so translators edit JSON, not code.
// English is built in too, so the pane always draws, and a node test keeps it equal to en.json.
// Each language names its lists and gives each a letter, which labels its items (Q12, P12, 質12):
// letters are unique within a language. Items keep their internal letter; only what is shown,
// typed and sent uses the language's.
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
  }
  config: { offer: string; lookAt: string; updated: string; updatedAdding: string; unreadable: string }
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
  },
  config: {
    offer: "Create docket's config at {path}, with every setting at its default? You can edit it there, or with ⚙.",
    lookAt: 'Look at your new config: {path}. Every setting is there at its default.',
    updated: 'docket updated its config at {path} from version {from} to {to}.',
    updatedAdding: 'docket updated its config at {path} from version {from} to {to}, adding {added} at their defaults.',
    unreadable: "docket couldn't read its config at {path}, so it's using the defaults until the file is fixed.",
  },
  fields: {
    language: ['Language', "Language of the docket's own words: auto follows Claude Code's language setting"],
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

// A language file over English: any key it leaves out, or gives the wrong shape, stays English.
export const mergeStrings = (base: Strings, over: unknown): Strings => {
  const merge = (a: unknown, b: unknown): unknown => {
    if (typeof a === 'string') return typeof b === 'string' && b.trim() ? b : a
    if (Array.isArray(a)) return Array.isArray(b) && b.length === a.length && b.every(each => typeof each === 'string') ? b : a
    if (isRecord(a)) {
      const out: Record<string, unknown> = {}
      for (const key of Object.keys(a)) out[key] = merge(a[key], isRecord(b) ? b[key] : undefined)

      return out
    }

    return a
  }

  return merge(base, over) as Strings
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
export const letterFor = (text: Strings, typed: string): Letter | undefined =>
  (Object.keys(text.lists) as Letter[]).find(letter => text.lists[letter].letter.toLowerCase() === typed.toLowerCase())

// An id the user or Claude wrote in this language ("P12" in Spanish) as the internal id ("Q12"), or
// undefined when no list of this language has its letter.
export const idFor = (text: Strings, label: string) => {
  const [, typed = '', n = ''] = /^(.+?)(\d+)$/u.exec(label.trim()) ?? []
  const letter = letterFor(text, typed)

  return letter ? `${letter}${Number(n)}` : undefined
}
