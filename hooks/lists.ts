import type { PluginOptions } from 'claude-code'

import type { Counts, Item, Letter } from '../types'
import { fill, idFor, labelOf, labelOfId, letterFor, typedLetters } from './i18n.ts'
import type { Strings, Voice } from './i18n.ts'

export type ListDef = {
  letter: Letter
  name: string
  emoji: string
  isRanked: boolean
  capKey: string
  // A heading button answering every item shown, sending this message with their labels.
  bulk?: 'acceptLeans' | 'confirmAll' | 'approveAll'
  // Yes and no buttons on each item, sending these messages with its label.
  answers?: { yes: keyof Strings['send']; no: keyof Strings['send'] }
}

// Least important first: the band's order, so the most important sits by the prompt. The pane reverses it.
export const LISTS: readonly ListDef[] = [
  { letter: 'P', name: 'Pinned', emoji: '📌', isRanked: false, capKey: 'pinnedCap' },
  { letter: 'W', name: 'Waiting', emoji: '⏳', isRanked: false, capKey: 'waitingCap' },
  { letter: 'L', name: 'Later', emoji: '📥', isRanked: false, capKey: 'laterCap' },
  { letter: 'U', name: 'Underway', emoji: '🔨', isRanked: false, capKey: 'underwayCap' },
  { letter: 'V', name: 'Verify', emoji: '👀', isRanked: true, capKey: 'verifyCap' },
  { letter: 'N', name: 'Needs you', emoji: '🙋', isRanked: true, capKey: 'needsYouCap' },
  {
    letter: 'C',
    name: 'Confirm',
    emoji: '👍',
    isRanked: true,
    capKey: 'confirmCap',
    bulk: 'confirmAll',
    answers: { yes: 'confirm', no: 'notConfirm' },
  },
  {
    letter: 'Q',
    name: 'Questions',
    emoji: '❓',
    isRanked: true,
    capKey: 'questionsCap',
    bulk: 'acceptLeans',
  },
  {
    letter: 'R',
    name: 'Requests',
    emoji: '🙏',
    isRanked: true,
    capKey: 'requestsCap',
    bulk: 'approveAll',
    answers: { yes: 'approve', no: 'decline' },
  },
]

export const LETTERS = LISTS.map(list => list.letter)

export type Settings = {
  display: 'pane' | 'band'
  // The once-a-turn pass for what the turn decided or left open.
  isTurnReview: boolean
  // The once-a-day look on GitHub for a newer docket.
  isUpdateCheck: boolean
  caps: Counts
  isEmoji: boolean
  isHeadingEmoji: boolean
  noItemEmoji: Set<string>
  inline: Set<string>
  targetWords: Counts
  stakesDisplay: 'emoji' | 'text' | 'none'
  lingerMs: number
  answeredMs: number
  leanColor?: string
  leanDimColor?: string
  itemColor?: string
  itemDimColor?: string
  upArrowColor?: string
  upNumberColor?: string
  downArrowColor?: string
  downNumberColor?: string
}

const letterSet = (value: unknown) =>
  new Set(
    String(value ?? '')
      .toUpperCase()
      .split(/[\s,]+/)
      .filter(Boolean),
  )

// The colors the engine accepts. Anything else would make it refuse the whole tree, so it falls back.
const COLOR_NAMES = new Set([
  'text', 'inverseText', 'inactive', 'subtle', 'suggestion', 'remember', 'success', 'error', 'warning',
  'merged', 'claude', 'permission', 'planMode', 'autoAccept', 'promptBorder', 'bashBorder', 'ide',
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white', 'gray', 'grey',
])

const colorOf = (value: unknown, fallback: string) => {
  const color = String(value ?? fallback).trim()
  if (!color) {
    return undefined
  }

  return /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color) || COLOR_NAMES.has(color) ? color : fallback
}

// A number setting as a number from 0 to `most`: a word, a negative or a timer-breaking size gives way.
const within = (value: unknown, usual: number, most: number) => {
  const number = Number(value ?? usual)

  return Number.isFinite(number) ? Math.min(most, Math.max(0, number)) : usual
}

export const settingsOf = (options: PluginOptions): Settings => {
  const caps: Counts = {}
  for (const list of LISTS) {
    caps[list.letter] = Math.max(1, Number(options[list.capKey] ?? 7))
  }

  const targetWords: Counts = {}
  for (const pair of String(options.targetWords ?? 'P=8').split(/[\s,]+/)) {
    const [, letter, words] = /^([A-Za-z])=(\d+)$/.exec(pair) ?? []
    // Only the lists' own letters: any other has no list to limit.
    if (letter && words && LETTERS.includes(letter.toUpperCase() as Letter)) {
      targetWords[letter.toUpperCase() as Letter] = Number(words)
    }
  }

  const stakes = String(options.stakesDisplay ?? 'emoji')

  return {
    display: options.display === 'band' ? 'band' : 'pane',
    isTurnReview: options.turnReview !== false,
    isUpdateCheck: options.updateCheck !== false,
    caps,
    isEmoji: options.emoji !== false,
    isHeadingEmoji: options.headingEmoji === true,
    noItemEmoji: letterSet(options.noItemEmojiLists),
    inline: letterSet(options.inlineLists ?? 'P'),
    targetWords,
    stakesDisplay: stakes === 'text' || stakes === 'none' ? stakes : 'emoji',
    lingerMs: within(options.strikeLingerMinutes, 3, 24 * 60) * 60_000,
    answeredMs: within(options.answeredLingerSeconds, 20, 24 * 60 * 60) * 1000,
    leanColor: colorOf(options.leanColor, '#b1b1b1'),
    leanDimColor: colorOf(options.leanDimColor, '#757575'),
    itemColor: colorOf(options.itemColor, '#e0e0e0'),
    itemDimColor: colorOf(options.itemDimColor, '#939393'),
    upArrowColor: colorOf(options.upArrowColor, '#5fb878'),
    upNumberColor: colorOf(options.upNumberColor, '#7c9a84'),
    downArrowColor: colorOf(options.downArrowColor, '#a885e6'),
    downNumberColor: colorOf(options.downNumberColor, '#8f83a8'),
  }
}

export const isOpen = (item: Item) => item.closed === undefined

export const openCounts = (items: readonly Item[]): Counts => {
  const counts: Counts = {}
  for (const item of items) {
    if (isOpen(item)) {
      counts[item.list] = (counts[item.list] ?? 0) + 1
    }
  }

  return counts
}

const urgency = (a: Item, b: Item) => (a.rank ?? 9999) - (b.rank ?? 9999) || a.n - b.n

export type Arranged = { shown: Item[]; lingering: Item[]; hidden: number }

// The capped slice of one list, in display order. Items new this turn always show.
// Beside the prompt the most urgent goes last, nearest it; elsewhere it goes first.
export const arrange = (
  items: readonly Item[],
  list: ListDef,
  cap: number,
  turn: number,
  now: number,
  lingerMs: number,
  isUrgentLast: boolean,
  answeredMs: number,
): Arranged => {
  const own = items.filter(item => item.list === list.letter)
  // An answered item leaves the view once its time is up, closed by Claude or not.
  const isGone = (item: Item) => item.answeredAt !== undefined && now - item.answeredAt >= answeredMs
  const open = own.filter(item => isOpen(item) && !isGone(item)).sort(list.isRanked ? urgency : (a, b) => a.n - b.n)
  const kept = open.filter((item, i) => i < cap || item.addedTurn === turn)
  const lingering = own.filter(item => item.closed?.isUnasked && now - item.closed.at < lingerMs)

  return {
    shown: list.isRanked && isUrgentLast ? kept.reverse() : kept,
    lingering,
    hidden: open.length - kept.length,
  }
}

// A counter's parts: what's hidden, the direction of the change, and its size.
export const counterParts = (hidden: number, delta: number) => ({
  more: hidden > 0 ? `+${hidden} more · ` : '',
  arrow: delta > 0 ? '↑' : delta < 0 ? '↓' : '',
  number: delta === 0 ? '+0' : String(Math.abs(delta)),
  direction: delta > 0 ? ('up' as const) : delta < 0 ? ('down' as const) : ('none' as const),
})

export const counterText = (hidden: number, delta: number) => {
  const { more, arrow, number } = counterParts(hidden, delta)

  return `${more}${arrow}${number}`
}

const describe = (item: Item, text: Strings) =>
  [
    `${labelOf(text, item)}${item.emoji ? ` ${item.emoji}` : ''} ${item.text}`,
    item.lean && `lean: ${item.lean}`,
    item.stakes && `stakes: ${item.stakes}`,
    item.rank !== undefined && `rank ${item.rank}`,
    item.action && "the mod's own item: leave it alone",
    item.answered && `the user answered ${item.answered === 'yes' ? 'yes' : item.answered === 'no' ? 'no' : item.answered} by button`,
  ]
    .filter(Boolean)
    .join(' | ')

// Phrases a reply uses when it leaves work open: a reply holding one that changed nothing on the
// docket is flagged, and the next prompt asks for a reconcile. Only phrases that leave work open
// count; bare words like "next" or "later" also describe how things work, so they don't.
const PENDING =
  /\b(next up|next steps?|left to do|still (need|needs|have) to|remaining work|to-?dos?|once you('ve| have)?|when you're ready|haven't (done|built|started|written)|I'll (come back|get to|follow up|do that|pick (it|that) up)|follow[- ]up)\b/i

// Code is quoted, not said: fences and inline code are left out before the check.
const withoutCode = (text: string) => text.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ')

export const speaksOfPending = (answer: string) => PENDING.test(withoutCode(answer))

export const RECONCILE =
  'Your last reply spoke of pending or next work but the docket did not change that turn. Make sure every open thread it mentions is an item; nothing open should live only in prose.'

export const snapshot = (items: readonly Item[], dismissed: readonly string[], text: Strings) => {
  const open = items.filter(isOpen)
  const lines = ['Docket, open items (the user sees these in the docket pane or band):']
  lines.push(...(open.length ? open.map(item => describe(item, text)) : ['(empty)']))
  if (dismissed.length) {
    lines.push(
      `The user cleared these from the docket since the last prompt: ${dismissed.map(id => labelOfId(text, id)).join(', ')}. Clearing only empties the display: it cancels no work, answers nothing and approves nothing. Carry on as before, and don't add them back while they stay dormant; if one becomes relevant again, add it fresh, with a new number.`,
    )
  }

  return lines.join('\n')
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// The items a prompt names by label ("q10", "c23-c25", "質12"), in the user's language, so a closed
// one is still known. A Latin letter mustn't be the end of a longer word; any other script can sit
// right after the text before it.
export const references = (prompt: string, items: readonly Item[], text: Strings) => {
  // Longest first, so a letter isn't cut short by a shorter one that begins it.
  const letters = typedLetters(text)
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join('|')
  const range = new RegExp(`(?<![A-Za-z0-9])(${letters})(\\d+)\\s*(?:-|–|~|〜|to|through|thru|bis|a)\\s*(?:\\1)?(\\d+)`, 'giu')
  const single = new RegExp(`(?<![A-Za-z0-9])(${letters})(\\d+)`, 'giu')
  const ids = new Set<string>()
  for (const [, typed = '', from, to] of prompt.matchAll(range)) {
    const letter = letterFor(text, typed)
    const low = Math.min(Number(from), Number(to))
    const high = Math.min(Math.max(Number(from), Number(to)), low + 50)
    for (let n = low; letter && n <= high; n += 1) ids.add(`${letter}${n}`)
  }
  for (const [whole] of prompt.matchAll(single)) {
    const id = idFor(text, whole)
    if (id) ids.add(id)
  }

  const named = items.filter(item => ids.has(item.id))
  if (!named.length) {
    return undefined
  }

  return [
    'Docket items the user named in this prompt:',
    ...named.map(item => `${describe(item, text)}${isOpen(item) ? '' : ' (already closed)'}`),
  ].join('\n')
}

// Told to Claude once at the end of each turn, as the old /questions skill was called after every turn:
// the pass that catches what the turn decided or left open without saying so.
export const REVIEW = `Before this turn ends, go back over it once for the docket:
- Any decision you made on the user's behalf that they might want to make themselves: ask it, as a question with your lean.
- Anything you're not sure you read right, or anything risky about to happen: put it in confirm.
- Any thread your reply left open (later, waiting, pinned, needs you): make it an item.
If anything is missing, add it in one update call. Then end the turn with one short line saying what you added, or that nothing was missing: don't repeat your reply.`

// Told to Claude when the docket's language or voice changed since its open items were written.
export const rewriteNote = (text: Strings, voice: Voice) => {
  const isVoiced = Boolean(voice.all || Object.keys(voice.lists).length)

  return `The docket's language or voice has changed since its open items were written: it is now ${text.language}, ${
    isVoiced ? 'in the voice the docket instructions give' : 'with no voice'
  }. Before anything else, rewrite every open item's text, lean and options that way, in one update call of changes, keeping each label and exactly what each item says; leave the mod's own items alone.${
    isVoiced ? '' : ' Write them plainly, out of character.'
  }`
}

// The docket as it is now, told with every prompt: the system prompt is composed once a session, so a
// language or voice chosen since never reaches it. Empty for plain English with no voice, which the
// system prompt already says.
export const nowNote = (text: Strings, voice: Voice) => {
  const isEnglish = text.language === 'English'
  const voiced = (Object.keys(voice.lists) as Letter[]).map(letter => `- ${text.lists[letter].letter} (${text.lists[letter].name}): ${voice.lists[letter]}`)
  if (isEnglish && !voice.all && !voiced.length) {
    return ''
  }
  const letters = LETTERS.map(letter => `${text.lists[letter].letter} ${text.lists[letter].name}`).join(', ')
  const id = (letter: Letter, n: number) => `${text.lists[letter].letter}${n}`
  const say = (key: keyof Strings['send'], values: Record<string, string>) => `"${fill(text.send[key], values)}"`

  return [
    'The docket right now, which overrides the docket instructions where they differ:',
    isEnglish
      ? ''
      : `- It is in ${text.language}. Write every item's text, lean and options in ${text.language}.`,
    `- Its lists and their letters, which label items and go in the tool's list field: ${letters}.`,
    `- Its buttons send ${say('acceptLean', { id: id('Q', 5) })}, ${say('rejectLean', { id: id('Q', 5) })}, ${say('approve', { id: id('R', 3) })}, ${say('decline', { id: id('R', 3) })}, ${say('confirm', { id: id('C', 3) })}, ${say('notConfirm', { id: id('C', 3) })} and ${say('start', { id: id('L', 3) })}.`,
    voice.all || voiced.length
      ? `- Write every item, new or changed, in character${voice.all ? `, as ${voice.all}` : ''}${voiced.length ? '; in these lists, as follows:' : '.'}`
      : '',
    ...voiced,
    voice.all || voiced.length
      ? "  The voice is for the items' wording only: they still say exactly what they need to, and the labels, links and paths stay as they are."
      : '',
  ]
    .filter(Boolean)
    .join('\n')
}

export const instructions = (settings: Settings, isHeadless: boolean, text: Strings, voice: Voice = { all: '', lists: {} }) => {
  const L = (letter: Letter) => text.lists[letter].letter
  const named = (letter: Letter) => (text.language === 'English' ? L(letter) : `${L(letter)} (${text.lists[letter].name})`)
  const say = (key: keyof Strings['send'], id: string, extra: Record<string, string> = {}) => `"${fill(text.send[key], { id, ids: id, ...extra })}"`
  const targets = Object.entries(settings.targetWords)
    .map(([letter, words]) => `${L(letter as Letter)} at most about ${words} words`)
    .join(', ')
  const language =
    text.language === 'English'
      ? ''
      : `\n\nThe user's docket is in ${text.language}. Write every item's text, lean and options in ${text.language}, and label items with the letters below (letter then number, such as ${L('Q')}12). The buttons send the messages quoted below, in ${text.language}.`

  const voiced = (Object.keys(voice.lists) as Letter[]).map(letter => `- ${named(letter)}: ${voice.lists[letter]}`)
  const voices =
    voice.all || voiced.length
      ? [
          `Write the docket's items in character${voice.all ? `, as ${voice.all}` : ''}${voiced.length ? '; in these lists, as follows:' : '.'}`,
          ...voiced,
          "The voice is for the items' wording only: they still say exactly what they need to, and the labels, links and paths stay as they are.",
        ].join('\n')
      : ''

  return `# Docket

The user runs the docket mod, a pane beside the transcript (or a band above the prompt) showing your open items as numbered lists. You keep it current with the mcp__docket__update tool: one call per turn, holding every change, whenever anything changed. ${
    isHeadless
      ? 'Nothing draws the band in this session, so end each reply with the open items as plain text, grouped by list, in the order below.'
      : 'The docket is where the user reads them: never repeat docket items in your prose reply.'
  }${language}${voices ? `\n\n${voices}` : ''}

Lists, from least to most important:
- ${named('P')} pinned: parked for later.
- ${named('W')} waiting: stalled on something other than the user; informational.
- ${named('L')} later: your own work that is decided or approved but not started yet, in the order you will take it. When you start one, close it and add it to ${L('U')}. Its 🏗️ button (▶ in the terminal) sends ${say('start', `${L('L')}3`)}: the user wants that one started now, ahead of the order, so start it and move it to ${L('U')}.
- ${named('U')} underway: only your own work in progress, never the user's.
- ${named('V')} verify: things for the user to look at and confirm: that a change works, reads right or looks right.
- ${named('N')} needs you: actions only the user can take. Give the exact console path. Rank the ones you are stuck on first.
- ${named('C')} confirm: when you are unsure you read the user right, or something risky is about to happen and you want them certain of it. State your reading, so a bare "yes" settles it. ${say('confirm', `${L('C')}3`)} (its ✔ button) settles it; ${say('notConfirm', `${L('C')}3`)} (its ✗ button) means your reading was wrong or the risky step should not go ahead: hold off, and ask what they meant.
- ${named('Q')} questions: decisions only the user can make. Always give a lean: the answer you would pick. When the question offers up to three choices, pass their labels as options: one to three buttons, each label a single letter or a single emoji, whichever reads best ("a", "b", "c" or "🌐", "📄"), and write each label in the text beside the choice it picks. Their buttons replace ✔ and ✗ and send ${say('pick', `${L('Q')}4`, { option: 'b' })}, meaning the user picked (b).
- ${named('R')} requests: things you want to do on your own initiative. Wait for permission. Use sparingly. ${say('approve', `${L('R')}3`)} (its ✔ button) means go ahead; ${say('decline', `${L('R')}3`)} (its ✗ button) means don't do it.

The tool's list field takes these same letters.

The docket is the complete set of open threads: anything your reply calls pending, queued, next, later or left must also be an item (${L('L')}, ${L('P')}, ${L('R')} or another list), never only prose.

Writing items: verify cheaply before adding one, and never ask what you can look up. Each item is answerable without scrolling back: define each named thing at its first mention, and give issue or PR numbers. Link whatever has a web address (a repo, an issue or PR, a page, a site, a commit) as a [label](https://...) link with a short label, such as [StoneCypher/docket](https://github.com/StoneCypher/docket); the docket draws it as a link. When an item is about a local file, set open to its absolute path, and the item gets an Open button for it. Keep items to one to three lines${targets ? `, and ${targets}` : ''}. Give each item one emoji: a single code point with default emoji presentation from Unicode 9 or earlier (no VS16, ZWJ, flags or skin tones). Set stakes only when they matter: emergency and high sparingly, med otherwise, none for low. On ${L('V')}, ${L('N')}, ${L('C')}, ${L('Q')} and ${L('R')}, rank 1 is the most urgent.

Answers: the user answers by label ("${L('Q').toLowerCase()}10 yes", "${L('C').toLowerCase()}23-${L('C').toLowerCase()}25 confirmed", "accept all other leans"), or by button. ${say('acceptLean', `${L('Q')}5`)} (a lean's ✔ button) accepts your lean; ${say('rejectLean', `${L('Q')}5`)} (its ✗ button) rejects only your lean: keep the question open, and ask what they want instead, or take the obvious other answer when there are only two. ${say('acceptLeans', `${L('Q')}5, ${L('Q')}6`)}, ${say('confirmAll', `${L('C')}2, ${L('C')}3`)} and ${say('approveAll', `${L('R')}2, ${L('R')}3`)} answer several at once. Act on every answer first, then make one update call closing what is resolved and adding what is new, and confirm each answer briefly by its label in prose. Never re-ask unless the answer was ambiguous; then ask once, in ${L('C')}. Close items on common-sense grounds. Answered items vanish from the user's view on their own about ${Math.round(settings.answeredMs / 1000)} seconds after their button is pressed, so close them, and when an answer starts work you haven't finished, add that work to ${L('U')} (underway) in the same update. The user can also clear items or whole lists from the docket; that only empties the display and never cancels work, answers a question or approves a request. A cleared thread that becomes relevant again comes back as a new item, with a new number. When you close an item the user did not resolve themselves, set unasked: true, and mention every such closure in one \`\`\`diff block of "- " lines. The tool assigns the labels, and numbers only ever go up. Change an item only to correct or sharpen the same item; anything the user would read as a new question or a new item, such as a follow-up after a "no" or a reworded ask, closes the old one and is added fresh, so it gets a new number. A label that suddenly means something else looks like a bug.`
}
