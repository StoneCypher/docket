import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, Register, RenderSurface } from 'claude-code'

import type { Counts, Item, Letter, Stakes } from '../types'
import {
  LETTERS,
  LISTS,
  arrange,
  counterParts,
  instructions,
  isOpen,
  openCounts,
  RECONCILE,
  REVIEW,
  SEND_BACK,
  nowNote,
  references,
  rewriteNote,
  sendsBack,
  settingsOf,
  snapshot,
  speaksOfPending,
  userTurnAfter,
} from './lists'
import type { Settings } from './lists'
import { CONFIG_VERSION, FIELDS, defaults, merged, migrate, parse, serialize } from './config'
import type { ConfigFile } from './config'
import { AI, EN, STRINGS_VERSION, fill, idFor, labelOf, labelOfId, letterFor, localeOf, markImage, resolveLanguage, stateOf, translate, voiceOf } from './i18n'
import type { FileState, Voice } from './i18n'
import { codeOf, englishName, nativeName } from './languages'
import { appDirOf, exeDirsOf, exeIn, launchOf, scriptDirsOf, scriptIn } from './editor'
import { BUILT } from './release'
import { DIVIDER, dayOf, defaultVariant, groupsOf, isChoosing, labelFor, pickedOf, variantsOf } from './picker'
import type { Dialect } from './picker'
import type { Language, Strings } from './i18n'
import { buttonOf, buttonsOf } from './buttons'
import type { ItemButton } from './buttons'

const TOOL = 'mcp__docket__update'
const PANE = 'docket'
const CLOSED_KEPT = 200
// How long an item Claude just added or changed stays out of a bulk button's answer, so one that lands
// under the person's finger isn't swept up with the rest.
const BULK_SETTLE_MS = 5_000

type Dollar = EngineInterface
type Kit = Pick<Elements['terminal'], 'Box' | 'Button' | 'Text' | 'Link'>
// Every surface but the terminal draws SVG.
type Svg = Elements['vscode']['Svg']
// Every surface but the terminal hands docket a press on a Markdown link without opening it.
type MarkdownElement = Elements['vscode']['Markdown']
const markdownOf = (kit: object, surface: string): MarkdownElement | undefined =>
  surface === 'terminal' ? undefined : (kit as { Markdown?: MarkdownElement }).Markdown
const svgOf = (kit: object, surface: string): Svg | undefined => (surface === 'terminal' ? undefined : (kit as { Svg?: Svg }).Svg)
type FieldKit = Pick<Elements['terminal'], 'Box' | 'Button' | 'Text' | 'Input' | 'Select'>

const items = atom({ plugin: 'docket', key: 'items' } as const, [] as Item[])
const counters = atom({ plugin: 'docket', key: 'counters' } as const, {} as Counts)
const turn = atom({ plugin: 'docket', key: 'turn' } as const, 0)
const baseline = atom({ plugin: 'docket', key: 'baseline' } as const, {} as Counts)
const dismissed = atom({ plugin: 'docket', key: 'dismissed' } as const, [] as string[])
const isSettings = atom({ plugin: 'docket', key: 'isSettings' } as const, false)
const expanded = atom({ plugin: 'docket', key: 'expanded' } as const, [] as string[])
const updatedTurn = atom({ plugin: 'docket', key: 'updatedTurn' } as const, 0)
const isUnreconciled = atom({ plugin: 'docket', key: 'isUnreconciled' } as const, false)
const languageGroup = atom({ plugin: 'docket', key: 'languageGroup' } as const, '')
const spokenAs = atom({ plugin: 'docket', key: 'spokenAs' } as const, '')
const deepDive = atom({ plugin: 'docket', key: 'deepDive' } as const, null as boolean | null)
const isUserTurn = atom({ plugin: 'docket', key: 'isUserTurn' } as const, false)
const queued = atom({ plugin: 'docket', key: 'queued' } as const, [] as string[])

// The language and voice items are written in, as one comparable key.
const speechOf = (text: Strings, voice: Voice) => JSON.stringify({ language: text.language, voice })

type Fields = { text?: string; emoji?: string; lean?: string; stakes?: Stakes; rank?: number; options?: string[]; open?: string }
type UpdateInput = {
  add?: (Fields & { list: Letter; text: string })[]
  change?: (Fields & { id: string })[]
  close?: { id: string; unasked?: boolean }[]
  // The language the user writes in, as Claude hears it: the last hint "auto" has before English.
  language?: string
  // Lists to clear, by letter, or "all": what a heading's ✕ does, done before the adds.
  clear?: string[]
  // Buttons to press, by item label and button name, as the person presses them.
  press?: { id: string; button: string }[]
  // Opens the pane, or closes it for good, as the person's close does.
  pane?: 'open' | 'close'
}

const STAKES = ['emergency', 'high', 'med']

// A button label: one letter, or one emoji (a pictograph with its modifiers, at most 8 code units).
const isOptionLabel = (label: unknown): label is string =>
  typeof label === 'string' && (/^\p{L}$/u.test(label) || (/^\p{Extended_Pictographic}/u.test(label) && label.length <= 8))

const fieldsOf = (spec: Fields): Fields => {
  const out: Fields = {}
  if (typeof spec.text === 'string') out.text = spec.text
  if (typeof spec.emoji === 'string' && spec.emoji) out.emoji = spec.emoji
  if (typeof spec.lean === 'string' && spec.lean) out.lean = spec.lean
  if (spec.stakes && STAKES.includes(spec.stakes)) out.stakes = spec.stakes
  if (Array.isArray(spec.options)) {
    const options = spec.options.filter(isOptionLabel).slice(0, 3)
    if (options.length) out.options = options
  }
  if (typeof spec.rank === 'number') out.rank = spec.rank
  if (typeof spec.open === 'string' && spec.open.trim()) out.open = spec.open.trim()

  return out
}

// The tool's fields, in the user's language's letters and messages.
const itemFields = (text: Strings) => ({
  text: { type: 'string', description: 'The item, one to three lines' },
  emoji: { type: 'string', description: 'One emoji for the item' },
  lean: { type: 'string', description: 'Questions only: the answer you would pick' },
  stakes: { type: 'string', enum: STAKES, description: 'Omit for low stakes' },
  rank: {
    type: 'number',
    description: `${(['V', 'N', 'C', 'Q', 'R'] as const).map(letter => text.lists[letter].letter).join(', ')} only: 1 is the most urgent`,
  },
  open: { type: 'string', description: 'A local file path the item is about. The item gets an Open button that opens it in the editor.' },
  options: {
    type: 'array',
    items: { type: 'string' },
    maxItems: 3,
    description: `Questions only: one to three button labels, each a single letter or a single emoji, such as ["a", "b", "c"] or ["🌐", "📄"]. Each label must appear in the text beside what it picks. Their buttons replace the lean’s ✔ and ✗ and send "${fill(text.send.pick, { id: `${text.lists.Q.letter}4`, option: 'b' })}"`,
  },
})

const schemaOf = (text: Strings) => ({
  type: 'object',
  properties: {
    add: {
      type: 'array',
      items: {
        type: 'object',
        properties: { list: { type: 'string', enum: LETTERS.map(letter => text.lists[letter].letter) }, ...itemFields(text) },
        required: ['list', 'text'],
      },
    },
    change: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string', description: `A label such as ${text.lists.Q.letter}12` }, ...itemFields(text) },
        required: ['id'],
      },
    },
    close: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          unasked: {
            type: 'boolean',
            description: 'True when you close it on your own judgment, not on the user\'s word',
          },
        },
        required: ['id'],
      },
    },
    language: {
      type: 'string',
      description:
        "The language the user writes to you in, as a code such as de or pt-BR. Set it only when the docket asks you to: it's on auto and nothing else told it the user's language.",
    },
    clear: {
      type: 'array',
      items: { type: 'string', enum: [...LETTERS.map(letter => text.lists[letter].letter), 'all'] },
      description:
        "Lists to clear, by letter, or \"all\" for every list: what a heading's ✕ does. It runs before add, so clear plus add starts the docket afresh. Clearing only empties the display.",
    },
    press: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: `A label such as ${text.lists.R.letter}1` },
          button: {
            type: 'string',
            description:
              'yes (✔), no (✗), an option\'s own label, start (a Later item\'s 🏗️), open (👁️) or clear (🗑️). Only the buttons the item shows now can be pressed.',
          },
        },
        required: ['id', 'button'],
      },
      description:
        "Presses an item's button exactly as the user's click does: the row is answered at once. On your own items, ✔, ✗, an option and start send their message as the user, held until your turn ends, so press them only when the user tells you to. The docket's own items, such as the offer to create its config, are handled by the docket.",
    },
    pane: {
      type: 'string',
      enum: ['open', 'close'],
      description: "Opens the docket's pane, or closes it as the user's close does: it stays closed, and the band with it, until reopened.",
    },
  },
})

const withoutAnswer = ({ answered: _, answeredAt: __, ...item }: Item): Item => item

const STAKES_GLYPH = { emergency: '[🚨emergency]', high: '❗', med: '🔶' }
const STAKES_TEXT = { emergency: '[emergency]', high: '[high stakes]', med: '[med stakes]' }
const STAKES_COLOR = { emergency: 'red', high: '#ff8800', med: 'yellow' }

// Whether the pane is on screen, and whether the person closed it. The band stands in only where no
// pane could be placed: a closed pane stays closed, everywhere, until /docket opens it again.
let isPaneShown = false
let isPaneClosed = false

// The docket's own pane, docked beside the transcript where the surface docks one.
// docket's version, from its own manifest, as the engine doesn't say it: shown in the pane's title.
const versionOf = async ($: Dollar) => {
  try {
    const { version } = JSON.parse(await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`)) as { version?: unknown }

    return typeof version === 'string' ? version : ''
  } catch {
    return ''
  }
}

const openPane = async ($: Dollar, version = '') => {
  const { isPlaced } = await $.ui.open({ id: PANE, title: version ? `Docket 📋 ${version}` : 'Docket 📋' })
  isPaneShown = isPlaced
  isPaneClosed = false
  $.ui.invalidate('ui.render')

  return isPlaced
}

// Closes the pane for good, as the person's close does: the band stays down too, until /docket or
// Claude opens the pane again. Returns what went wrong, or '' once it's closed.
// e.g. await closePane($) is '' after the pane goes; a ui.close hook's refusal comes back as its words.
const closePane = async ($: Dollar) => {
  try {
    await $.ui.close({ id: PANE })
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  isPaneShown = false
  isPaneClosed = true
  $.ui.invalidate('ui.render')

  return ''
}

// What a press on one of the mod's own items does: the pane's, the band's and Claude's alike.
type OnAction = (item: Item, kind: string) => Promise<void>

// Marks items answered at once, so the row dims and drops its buttons before Claude acts on the reply.
// `answeredMs` is how long an answered row stays up; the pane redraws once it's due to go.
const markAnswered = async ($: Dollar, ids: readonly string[], answer: string, answeredMs: number) => {
  const answeredAt = await $.clock.now()
  await update($, items, current =>
    current.map(item => (ids.includes(item.id) && isOpen(item) ? { ...item, answered: answer, answeredAt } : item)),
  )
  $.clock.after(answeredMs + 500, () => $.ui.invalidate('ui.render'))
}

// A ✔, ✗, option or start: answers one item as if the user had typed `said`. The mod's own items are
// handled by `onAction` and never reach Claude. The person's press and Claude's both come here; Claude's
// is `isHeld`, as its tool call holds the turn a prompt would wait on, so its words go once the turn ends.
// e.g. answerItem($, r3, 'yes', 'Approved R3.', 20_000, onAction) submits "Approved R3." as the user.
const answerItem = async ($: Dollar, item: Item, answer: string, said: string, answeredMs: number, onAction: OnAction, isHeld = false) => {
  await markAnswered($, [item.id], answer, answeredMs)
  if (item.action) {
    await onAction(item, answer)

    return
  }
  if (isHeld) {
    await update($, queued, current => [...current, said])

    return
  }
  await $.prompt.submit({ text: said, asUser: true })
}

// Sends what Claude's presses held, as one prompt from the user, once the turn that pressed them ends.
// e.g. held "Approved R2." and "Start L1 now." go as "Approved R2. Start L1 now."
const sendHeld = async ($: Dollar) => {
  const held = await read($, queued)
  if (!held.length) return
  await update($, queued, () => [])
  await $.prompt.submit({ text: held.join(' '), asUser: true })
}

// An item's 🗑️: clears just that item, and tells Claude at the next prompt. Clearing one of the mod's
// own offers declines it, so it doesn't come back.
const clearItem = async ($: Dollar, item: Item, onAction: OnAction) => {
  if (item.action) {
    await onAction(item, 'no')

    return
  }
  const at = await $.clock.now()
  await update($, items, current =>
    current.map(each => (each.id === item.id && isOpen(each) ? { ...each, closed: { at, isUnasked: false } } : each)),
  )
  await update($, dismissed, gone => [...gone, item.id])
}

// A heading's ✕, for each list named: clears every open item in them, and tells Claude at the next
// prompt. Returns the ids it cleared.
// e.g. clearLists($, ['Q']) clears the open questions and leaves every other list.
const clearLists = async ($: Dollar, letters: readonly Letter[]) => {
  const at = await $.clock.now()
  const ids: string[] = []
  await update($, items, current => {
    ids.length = 0

    return current.map(item => {
      if (!letters.includes(item.list) || !isOpen(item)) {
        return item
      }
      ids.push(item.id)

      return { ...item, closed: { at, isUnasked: false } }
    })
  })
  await update($, dismissed, gone => [...gone, ...ids])

  return ids
}

// Claude presses one of an item's buttons, by buttonsOf's description of it: the same calls the pane's
// button makes, so Claude's press and the person's come out the same, its words sent as the turn ends.
const pressItem = async ($: Dollar, item: Item, button: ItemButton, answeredMs: number, onAction: OnAction) =>
  button.kind === 'answer'
    ? answerItem($, item, button.answer, button.send, answeredMs, onAction, true)
    : button.kind === 'open'
      ? onAction(item, 'open')
      : clearItem($, item, onAction)

// Every list with something to show, or null when the docket is empty.
const draw = async (
  $: Dollar,
  { Box, Button, Text, Link }: Kit,
  settings: Settings,
  columns: number,
  isByPrompt: boolean,
  surface: string,
  onAction: OnAction,
  text: Strings,
  Svg?: Svg,
  Markdown?: MarkdownElement,
) => {
  const label = (item: Pick<Item, 'list' | 'n'>) => labelOf(text, item)
  // An item's clear button: a trash can, apart from the ✗ beside it, but the terminal can't size 🗑️.
  const trash = surface === 'terminal' ? '✕' : '🗑️'
  // The eye has the same trouble on the terminal, which gets a plain ◉ instead.
  const eye = surface === 'terminal' ? '◉' : '👁️'
  // Later's "okay, it's time to do this now": a crane, or ▶ on the terminal.
  const crane = surface === 'terminal' ? '▶' : '🏗️'

  // A heading's counter: a growing list's arrow in moderate green and its number in a fainter green,
  // a shrinking list's in purple, and no change in the dim gray.
  const counter = (hidden: number, delta: number) => {
    const { more, arrow, number, direction } = counterParts(hidden, delta)
    const colors =
      direction === 'up'
        ? { arrow: settings.upArrowColor, number: settings.upNumberColor }
        : { arrow: settings.downArrowColor, number: settings.downNumberColor }

    return (
      <Text>
        {' '}
        {more ? <Text dimColor>{more}</Text> : null}
        {direction === 'none' ? (
          <Text dimColor>{number}</Text>
        ) : (
          <Text>
            <Text color={colors.arrow}>{arrow}</Text>
            <Text color={colors.number}>{number}</Text>
          </Text>
        )}
      </Text>
    )
  }

  // Turns links in an item's text into Link elements: `[label](https://...)` shows the label,
  // and a bare web address shows itself, its trailing punctuation left as text.
  const linkify = (text: string) => {
    const parts: (string | ReturnType<typeof Link>)[] = []
    let rest = 0
    for (const match of text.matchAll(/\[([^\]]+)\]\(((?:https?|file):\/\/[^\s)]+)\)|https?:\/\/[^\s<>"')\]]+/g)) {
      const [whole, label, target] = match
      const href = target ?? whole.replace(/[.,;:!?]+$/, '')
      parts.push(text.slice(rest, match.index), <Link href={href}>{label ?? href}</Link>)
      rest = match.index + (label ? whole.length : href.length)
    }
    parts.push(text.slice(rest))

    return parts
  }

  const all = await read($, items)
  const at = await read($, turn)
  const base = await read($, baseline)
  const now = await $.clock.now()
  const counts = openCounts(all)

  const order = isByPrompt ? LISTS : [...LISTS].reverse()
  // Lists the user opened past their cap; "+N more" adds one, "fewer" takes it back out.
  const open = await read($, expanded)
  const toggle = (letter: string, isOpening: boolean) => () =>
    update($, expanded, current => (isOpening ? [...current.filter(each => each !== letter), letter] : current.filter(each => each !== letter)))

  const sections = order.map(list => ({
    list,
    ...arrange(
      all,
      list,
      open.includes(list.letter) ? Infinity : (settings.caps[list.letter] ?? 7),
      at,
      now,
      settings.lingerMs,
      isByPrompt,
      settings.answeredMs,
    ),
  })).filter(section => section.shown.length + section.lingering.length + section.hidden > 0)

  if (!sections.length) {
    return null
  }

  // An item's 🗑️: clears just that item.
  const dismiss = (id: string) => async () => {
    const item = all.find(each => each.id === id)
    if (item) await clearItem($, item, onAction)
  }

  // The heading's ✕: dismisses every open item in the list.
  const dismissList = (letter: Letter) => async () => {
    await clearLists($, [letter])
  }

  // A ✔, ✗, option or start: answers one item, as if the user had typed it.
  const answer = (id: string, kind: string, said: string) => async () => {
    const item = all.find(each => each.id === id)
    if (item) await answerItem($, item, kind, said, settings.answeredMs, onAction)
  }

  // Whether a lean fits on one line beside its buttons: an estimate in cells, as no surface reports
  // rendered widths. The lean's margin and the two buttons side by side take about 9.
  const isOneLine = (text: string, reserve = 0) => text.length <= columns - 9 - reserve

  // What a list's bulk button would answer: open items not already sent, and for questions only
  // those with a lean to accept.
  // Never the mod's own items, and never one changed in the last few seconds.
  const bulkable = (list: readonly Item[], letter: Letter, at: number) =>
    list.filter(
      item =>
        item.list === letter &&
        isOpen(item) &&
        !item.answered &&
        !item.action &&
        (letter !== 'Q' || item.lean) &&
        at - (item.changedAt ?? 0) >= BULK_SETTLE_MS,
    )

  // A bulk button answers only the items on screen: never the ones hidden past the cap.
  const accept = (send: keyof Strings['send'], letter: Letter, shown: readonly Item[]) => async () => {
    const onScreen = new Set(shown.map(item => item.id))
    const ids = bulkable(await read($, items), letter, await $.clock.now())
      .filter(item => onScreen.has(item.id))
      .map(item => item.id)
    if (ids.length) {
      await markAnswered($, ids, 'yes', settings.answeredMs)
      await $.prompt.submit({ text: fill(text.send[send], { ids: ids.map(id => labelOfId(text, id)).join(', ') }), asUser: true })
    }
  }

  const marker = (item: Item) => {
    const hasEmoji = settings.isEmoji && !settings.noItemEmoji.has(item.list) && item.emoji

    return hasEmoji ? ` ${item.emoji}` : ''
  }

  const stakesTag = (item: Item) => {
    if (!item.stakes || settings.stakesDisplay === 'none') {
      return null
    }
    if (settings.isEmoji && settings.stakesDisplay === 'emoji') {
      return <Text> {STAKES_GLYPH[item.stakes]}</Text>
    }

    return <Text color={STAKES_COLOR[item.stakes]}> {STAKES_TEXT[item.stakes]}</Text>
  }

  // Struck-through items take the surface's dim; open ones take explicit colors, which dim would override.
  const itemColor = (isLingering: boolean, isDim: boolean) =>
    isLingering ? { dimColor: true } : { color: isDim ? settings.itemDimColor : settings.itemColor }

  // The pane's text can't be selected, so an item's label copies it: label, text and any lean, the way
  // the person would quote it. A toast says it took.
  const copyItem = (item: Item) => async () => {
    const quoted = [`${label(item)}. ${item.text}`, item.lean ? `${text.lean}: ${item.lean}` : ''].filter(Boolean).join('\n')
    const { isCopied } = await $.ui.copy({ text: quoted, surface: surface as RenderSurface })
    if (isCopied) await $.ui.toast(`📋 ${label(item)}`)
  }

  // A bare web address as a Markdown link, its trailing punctuation left as text, as linkify does; one
  // already written [label](https://...) is kept.
  const linked = (words: string) =>
    words.replace(/\[[^\]]+\]\((?:https?|file):\/\/[^\s)]+\)|https?:\/\/[^\s<>"')\]]+/g, whole => {
      if (whole.startsWith('[')) return whole
      const href = whole.replace(/[.,;:!?]+$/, '')

      return `[${href}](${href})${whole.slice(href.length)}`
    })

  // Where a copy link points, should a surface open it instead of handing docket the press: the site.
  const copyHref = (item: Item) => `${SITE}/#copy-${item.id}`

  const stakesWords = (item: Item) =>
    !item.stakes || settings.stakesDisplay === 'none'
      ? ''
      : ` ${settings.isEmoji && settings.stakesDisplay === 'emoji' ? STAKES_GLYPH[item.stakes] : STAKES_TEXT[item.stakes]}`

  // An item's own line: label, emoji, stakes, text. Where a surface hands docket a link's press, the
  // line is Markdown and its label a link that copies the item, flowing with the text; the terminal,
  // which may open a link before docket hears of it, keeps a plain label, its text selectable anyway.
  const line = (item: Item, isLingering: boolean, isDim: boolean) => {
    // Struck through while lingering, and once sent: the answer is out, the item is on its way.
    const isStruck = isLingering || item.answered !== undefined
    const isNew = item.addedTurn === at && !isLingering
    if (Markdown && !isLingering) {
      const words = `**[${label(item)}.](${copyHref(item)} "${text.copyItem.replace(/"/g, "'")}")**${marker(item)}${stakesWords(item)} ${linked(item.text)}${isNew ? ` ${text.new}` : ''}`

      return (
        <Markdown
          key={`line-${item.id}`}
          text={isStruck ? `~~${words}~~` : words}
          dimColor={isDim}
          pressableLinks={[copyHref(item)]}
          onLinkPress={() => void copyItem(item)()}
        />
      )
    }

    return (
      <Text {...itemColor(isLingering, isDim)} strikethrough={isStruck}>
        <Text bold>{label(item)}.</Text>
        {marker(item)}
        {stakesTag(item)} {linkify(item.text)}
        {isNew ? ` ${text.new}` : ''}
      </Text>
    )
  }

  // A ✔ and ✗ pair, side by side when the text beside them fits on one line, stacked when it wraps.
  // `reserve` is the cells other controls take on the same line.
  // Once answered, a plain mark of the answer sent stands in for the pair.
  const yesNo = (item: Item, yes: string, no: string, beside: string, reserve = 0) =>
    item.answered ? (
      <Box flexShrink={0} marginLeft={1}>
        {/* A button holds only text, so a dialect's picture shows here, as the mark of what was sent. */}
        {Svg && item.answered === 'yes' && text.marks.yesImage ? (
          <Svg source={text.marks.yesImage} alt={text.marks.yes} width={16} height={16} />
        ) : Svg && item.answered === 'no' && text.marks.noImage ? (
          <Svg source={text.marks.noImage} alt={text.marks.no} width={16} height={16} />
        ) : (
          <Text size="caption" dimColor>
            {item.answered === 'yes' ? text.marks.yes : item.answered === 'no' ? text.marks.no : item.answered}
          </Text>
        )}
      </Box>
    ) : (
      <Box flexShrink={0} marginLeft={1} flexDirection={isOneLine(beside, reserve) ? 'row' : 'column'} columnGap={1}>
        <Button key={`ok-${item.id}`} plain dimColor onPress={answer(item.id, 'yes', yes)}>
          <Text size="caption" color="green">{text.marks.yes}</Text>
        </Button>
        <Button key={`no-${item.id}`} plain dimColor onPress={answer(item.id, 'no', no)}>
          <Text size="caption">{text.marks.no}</Text>
        </Button>
      </Box>
    )

  // A question's lettered options, one button each, in place of ✔ and ✗.
  const choices = (item: Item, beside: string) =>
    item.answered ? (
      <Box flexShrink={0} marginLeft={1}>
        <Text size="caption" dimColor>
          {item.answered}
        </Text>
      </Box>
    ) : (
      <Box
        flexShrink={0}
        marginLeft={1}
        flexDirection={isOneLine(beside, 2 * (item.options?.length ?? 0)) ? 'row' : 'column'}
        columnGap={1}
      >
        {(item.options ?? []).map((option, i) => (
          <Button key={`opt-${item.id}-${i}`} plain dimColor onPress={answer(item.id, option, fill(text.send.pick, { id: label(item), option }))}>
            <Text size="caption">{option}</Text>
          </Button>
        ))}
      </Box>
    )

  const row = (item: Item, isLingering: boolean) => {
    const isDim = isLingering || item.answered !== undefined || item.changedTurn < at
    const { answers } = LISTS.find(list => list.letter === item.list) ?? {}
    const sayOf = answers && { yes: fill(text.send[answers.yes], { id: label(item) }), no: fill(text.send[answers.no], { id: label(item) }) }

    return (
      // Items sit about 1em in from their heading: 2 cells, a cell being near 0.6em.
      <Box key={item.id} flexDirection="column" marginBottom={1} marginLeft={2}>
        {isLingering ? (
          line(item, isLingering, isDim)
        ) : (
          <Box flexDirection="row" flexWrap="nowrap" alignItems="flex-start">
            <Box flexShrink={1} minWidth={0}>
              {line(item, isLingering, isDim)}
            </Box>
            {sayOf ? yesNo(item, sayOf.yes, sayOf.no, `${label(item)}. ${item.text}`, 3) : null}
            {item.options && !item.lean ? choices(item, `${label(item)}. ${item.text}`) : null}
            {/* An item about a file gets 👁️ to open it, and a Later item 🏗️ to start it, stacked above its 🗑️. */}
            <Box flexShrink={0} marginLeft={1} flexDirection="column">
              {item.list === 'L' ? (
                item.answered ? (
                  <Text size="caption" dimColor>
                    {crane}
                  </Text>
                ) : (
                  <Button key={`go-${item.id}`} plain dimColor onPress={answer(item.id, crane, fill(text.send.start, { id: label(item) }))}>
                    <Text size="caption">{crane}</Text>
                  </Button>
                )
              ) : null}
              {item.open ? (
                <Button key={`open-${item.id}`} plain dimColor onPress={() => onAction(item, 'open')}>
                  <Text size="caption">{eye}</Text>
                </Button>
              ) : null}
              {/* Once sent, the row leaves on its own: nothing left to clear by hand. */}
              {item.answered ? null : (
                <Button key={`x-${item.id}`} plain dimColor onPress={dismiss(item.id)}>
                  <Text size="caption">{trash}</Text>
                </Button>
              )}
            </Box>
          </Box>
        )}
        {item.lean && !isLingering ? (
          <Box marginLeft={3} flexDirection="row" flexWrap="nowrap" alignItems="flex-start">
            <Box flexShrink={1} minWidth={0}>
              {/* Explicit colors, not dimColor: a surface's dim overrides any color given beside it. */}
              <Text color={isDim ? settings.leanDimColor : settings.leanColor} italic>
                <Text bold>{text.lean}</Text>: {linkify(item.lean)}
              </Text>
            </Box>
            {item.options
              ? choices(item, `${text.lean}: ${item.lean}`)
              : yesNo(
                  item,
                  fill(text.send.acceptLean, { id: label(item) }),
                  fill(text.send.rejectLean, { id: label(item) }),
                  `${text.lean}: ${item.lean}`,
                )}
          </Box>
        ) : null}
      </Box>
    )
  }

  const inline = (list: Item[], lingering: Item[]) => (
    <Box marginBottom={1} marginLeft={2}>
      <Text>
        {[...lingering, ...list].map((item, i) => {
          const isLingering = !isOpen(item)

          return (
            <Text key={item.id} {...itemColor(isLingering, item.changedTurn < at)} strikethrough={isLingering}>
              {i ? ' · ' : ''}
              <Text bold>{label(item)}</Text>
              {marker(item)}
              {stakesTag(item)} {linkify(item.text)}
            </Text>
          )
        })}
      </Text>
    </Box>
  )

  return (
    <Box flexDirection="column" flexGrow={1}>
      {sections.map(({ list, shown, lingering, hidden }) => (
        <Box key={`list-${list.letter}`} flexDirection="column">
          <Box flexDirection="row">
            <Text bold>
              {settings.isEmoji && settings.isHeadingEmoji ? `${list.emoji} ` : ''}
              {/* Only the name is underlined: not the emoji, nor the space after it. */}
              <Text underline>{text.lists[list.letter].name}</Text>
            </Text>
            {hidden > 0 ? (
              <Box marginLeft={1}>
                <Button key={`more-${list.letter}`} plain dimColor label={fill(text.more, { n: hidden })} onPress={toggle(list.letter, true)} />
              </Box>
            ) : open.includes(list.letter) && (counts[list.letter] ?? 0) > (settings.caps[list.letter] ?? 7) ? (
              <Box marginLeft={1}>
                <Button key={`fewer-${list.letter}`} plain dimColor label={text.fewer} onPress={toggle(list.letter, false)} />
              </Box>
            ) : null}
            {counter(0, (counts[list.letter] ?? 0) - (base[list.letter] ?? 0))}
            {shown.length ? (
              // About 2em past the heading and 1em between buttons: a cell is near 0.6em.
              <Box flexDirection="row" marginLeft={3} columnGap={2}>
                {/* A bulk button only where there's more than one thing for it to answer. */}
                {/* It says how many it answers, so a new arrival changes what's pressed visibly. */}
                {list.bulk && bulkable(shown, list.letter, now).length > 1 ? (
                  <Button
                    key={`bulk-${list.letter}`}
                    label={`${text.bulk[list.letter as 'Q' | 'C' | 'R']} (${bulkable(shown, list.letter, now).length})`}
                    onPress={accept(list.bulk, list.letter, shown)}
                  />
                ) : null}
                <Button key={`x-${list.letter}`} plain dimColor onPress={dismissList(list.letter)}>
                  <Text size="caption">✕</Text>
                </Button>
              </Box>
            ) : null}
          </Box>
          {settings.inline.has(list.letter)
            ? inline(shown, lingering)
            : [...lingering.map(item => row(item, true)), ...shown.map(item => row(item, false))]}
        </Box>
      ))}
    </Box>
  )
}

// The ⚙ that flips the pane between the lists and the settings view, at the pane's bottom right.
// Beside it, a link to docket's repository.
const REPO = 'https://github.com/StoneCypher/docket'
const SITE = 'https://stonecypher.github.io/docket'

// Whether the once-a-turn review runs: the switch, once flipped this session, else the config's turnReview.
const isDeepDiving = async ($: Dollar, settings: Settings) => (await read($, deepDive)) ?? settings.isTurnReview

// The pane's bottom row: the Deep dive switch at the left; docket's repository and the ⚙ at the right.
// The switch is meant to be rarely touched, so it's a quiet link, its emoji saying the state; the
// terminal, which may open a link itself, gets an equally quiet button.
const DEEP_DIVE_HREF = 'https://stonecypher.github.io/docket/#deep-dive'

const gear = async ($: Dollar, { Box, Button, Link, Text }: Kit, surface: string, settings: Settings, text: Strings, Markdown?: MarkdownElement) => {
  const isOn = await isDeepDiving($, settings)
  const words = `${isOn ? '☑' : '☐'} ${text.deepDive}`
  const flip = () => void update($, deepDive, () => !isOn)

  return (
    // One row, never wrapped: a Markdown block would otherwise take the width and push the rest below.
    <Box flexDirection="row" flexWrap="nowrap" justifyContent="space-between" alignItems="center" columnGap={2} marginTop={1}>
      <Box flexShrink={1} minWidth={0}>
        {Markdown ? (
          <Markdown key="deep-dive" text={`[${words}](${DEEP_DIVE_HREF})`} dimColor pressableLinks={[DEEP_DIVE_HREF]} onLinkPress={flip} />
        ) : (
          <Button key="deep-dive" plain dimColor onPress={flip}>
            <Text size="caption">{words}</Text>
          </Button>
        )}
      </Box>
      <Box flexDirection="row" flexShrink={0} alignItems="center" columnGap={2}>
        <Text dimColor size="caption">
          <Link href={REPO}>GitHub</Link>
        </Text>
        <Button key="gear" plain dimColor onPress={() => update($, isSettings, isOn => !isOn)}>
          <Text size="caption">{surface === 'terminal' ? '⚙' : '⚙️'}</Text>
        </Button>
      </Box>
    </Box>
  )
}

export type ConfigPaths = { user: string; project?: string }
// What loading a config file had to say: worded once the language is known, as the file may set it.
export type ConfigNote = { kind: 'unreadable' | 'updated'; path: string; from?: number; added?: string[] }
export type LoadedConfig = { user?: ConfigFile; project?: ConfigFile; notes: ConfigNote[] }

const noteText = (text: Strings, note: ConfigNote) =>
  note.kind === 'unreadable'
    ? fill(text.config.unreadable, { path: fileLink(note.path) })
    : fill(note.added?.length ? text.config.updatedAdding : text.config.updated, {
        path: fileLink(note.path),
        from: note.from ?? 0,
        to: CONFIG_VERSION,
        added: (note.added ?? []).join(', '),
      })

// VS Code draws only https: links, so a config path is shown as plain text.
const fileLink = (path: string) => path

// Where docket's config lives: ~/.claude/docket/config.json, and the same path inside the project.
// A session started in the home folder has no separate project config.
const configPaths = async ($: Dollar, cwd: string): Promise<ConfigPaths> => {
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? ''
  const base = ((await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${home}/.claude`).replace(/\\/g, '/')
  const user = `${base}/docket/config.json`
  const project = `${cwd.replace(/\\/g, '/')}/.claude/docket/config.json`

  return { user, project: project === user ? undefined : project }
}

// Reads both files and brings each up to date, writing back any it migrated. A file that won't parse
// is left alone, and its defaults are used until it's fixed. Each migration or failure leaves a note.
const loadConfig = async ($: Dollar, paths: ConfigPaths): Promise<LoadedConfig> => {
  const loaded: LoadedConfig = { notes: [] }
  for (const scope of ['user', 'project'] as const) {
    const path = paths[scope]
    if (!path || !(await $.fs.exists(path))) continue
    const raw = parse(await $.fs.read(path))
    if (raw === undefined) {
      loaded.notes.push({ kind: 'unreadable', path })
      continue
    }
    const migration = migrate(raw, scope === 'project')
    if (migration.isChanged) {
      await $.fs.write(path, serialize(migration.config))
      loaded.notes.push({ kind: 'updated', path, from: migration.from, added: migration.added })
    }
    loaded[scope] = migration.config
  }

  return loaded
}

// Opens a file in the editor hosting the session, reusing its window; else VS Code by PATH, else the
// system's default app for it.
const openFile = async ($: Dollar, path: string) => {
  const isWindows = (await $.env.get('OS')) === 'Windows_NT'
  // First, the editor hosting the session, by where it's installed rather than by PATH.
  const appDir = appDirOf(await $.env.get('VSCODE_NLS_CONFIG'))
  const namesIn = async (dir: string) => {
    try {
      return (await $.fs.list(dir)).filter(entry => entry.kind === 'file').map(entry => entry.name)
    } catch {
      return []
    }
  }
  if (appDir) {
    for (const dir of isWindows ? exeDirsOf(appDir) : scriptDirsOf(appDir)) {
      const names = await namesIn(dir)
      const found = isWindows ? exeIn(names) : scriptIn(names)
      if (!found) continue
      const { argv, env } = isWindows ? launchOf(`${dir}/${found}`, appDir, path) : { argv: [`${dir}/${found}`, '-r', path], env: {} }
      try {
        if ((await $.process.run(argv, { env })).exitCode === 0) return
      } catch {
        // That one wouldn't start; try the next way.
      }
    }
  }
  // cmd reparses what it runs, so a path with &, ^, % or quotes skips VS Code for the system's own opener.
  const isPlain = /^[\w:\\/. ()-]+$/.test(path)
  const tries = isWindows
    ? [...(isPlain ? [['cmd', '/c', 'code', '-r', path]] : []), ['rundll32', 'url.dll,FileProtocolHandler', path]]
    : [['code', '-r', path], ['open', path], ['xdg-open', path]]
  for (const argv of tries) {
    try {
      if ((await $.process.run(argv)).exitCode === 0) return
    } catch {
      // Not on this system; try the next.
    }
  }
}

// Adds items the mod writes itself, numbered like any other.
const addOwn = async ($: Dollar, specs: (Pick<Item, 'list' | 'text' | 'emoji' | 'rank' | 'action' | 'open' | 'language'>)[]) => {
  const at = await read($, turn)
  const made: Item[] = []
  await update($, counters, current => {
    const next = { ...current }
    made.length = 0
    for (const spec of specs) {
      const n = (next[spec.list] ?? 0) + 1
      next[spec.list] = n
      made.push({ ...spec, id: `${spec.list}${n}`, n, addedTurn: at, changedTurn: at })
    }

    return next
  })
  await update($, items, current => [...current, ...made])
}

const closeOwn = async ($: Dollar, id: string) => {
  const at = await $.clock.now()
  await update($, items, current =>
    current.map(item => (item.id === id && isOpen(item) ? { ...item, closed: { at, isUnasked: false } } : item)),
  )
}

export type SettingsView = {
  onDone: () => void
  values: Record<string, string | number | boolean>
  path: string
  isProject: boolean
  userPath: string
  onSave: (key: string, value: string | number | boolean) => Promise<void>
  onCopyToProject?: () => Promise<void>
  // docket's version, for the line that says which docket this is.
  version: string
  // The language picker: the language docket speaks, the languages it can, its dialects, and the
  // group of initials open in it.
  speaking: string
  languages: string[]
  dialects: Dialect[]
  group: string
  onGroup: (group: string) => void
  // The voice pulldown: the casts, and the cast the dialect brings when the config names none.
  casts: Cast[]
  dialectCast: string
  noVoice: string
}

// The language as three pulldowns, since a pulldown holds at most 64 choices: a group of initials (or
// auto), then a language in it, then its variant. Picking a group alone saves nothing.
const languagePicker = (Box: FieldKit['Box'], Select: FieldKit['Select'], view: SettingsView, value: unknown) => {
  const { base, variant } = pickedOf(value)
  const bases = [...new Set(view.languages.map(code => code.split('-')[0] ?? code))]
  const groups = groupsOf(view.speaking, bases)
  // A setting the picker doesn't know (a code typed into the file by hand) shows as itself, not as auto.
  const isKnown = base === 'auto' || groups.some(group => group.codes.includes(base))
  const open = view.group || (base === 'auto' ? 'auto' : (groups.find(group => group.codes.includes(base))?.value ?? 'current'))
  const inGroup = groups.find(group => group.value === open)
  const variantsFor = (code: string) => variantsOf(view.speaking, code, view.languages, view.dialects)
  const variants = base === 'auto' ? [] : variantsFor(base)
  // Picking a language with variants picks its first region too; one with one or none has no third pulldown.
  const pick = (code: string) => {
    const choices = variantsFor(code)
    void view.onSave('language', isChoosing(choices) ? `${code}-${defaultVariant(code, choices)}` : code)
  }

  // One line, wrapping only where the pane is too narrow for all three.
  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={1} rowGap={1}>
      <Select
        key="language-group"
        value={open}
        options={[
          ...(isKnown ? [] : [{ value: 'current', label: String(value) }]),
          { value: 'auto', label: 'auto' },
          ...groups.map(({ value: group, label }) => ({ value: group, label })),
        ]}
        onSelect={choice =>
          choice === 'auto' ? void view.onSave('language', 'auto') : choice === 'current' ? view.onGroup('') : view.onGroup(choice)
        }
      />
      {inGroup ? (
        <Select
          key="language"
          value={inGroup.codes.includes(base) ? base : undefined}
          options={inGroup.codes.map(code => ({ value: code, label: labelFor(view.speaking, code) }))}
          onSelect={pick}
        />
      ) : null}
      {inGroup?.codes.includes(base) && isChoosing(variants) ? (
        <Select
          key="language-variant"
          value={variants.some(each => each.value === variant && each.value !== DIVIDER) ? variant : defaultVariant(base, variants)}
          options={variants}
          // The divider picks nothing: saving the setting unchanged redraws the pulldown back to it.
          onSelect={choice => void view.onSave('language', choice === DIVIDER ? String(value) : `${base}-${choice}`)}
        />
      ) : null}
    </Box>
  )
}

// The voice as a pulldown: no voice, or a cast. A character described in words in the config file shows
// as itself; picking from the pulldown replaces it.
const voicePicker = (Select: FieldKit['Select'], view: SettingsView, value: unknown) => {
  const setting = String(value ?? '').trim()
  const isCast = view.casts.some(cast => cast.id === setting)
  const shown = setting === 'none' || isCast ? setting : setting ? 'own' : view.dialectCast || 'none'

  return (
    <Select
      key="voice"
      value={shown}
      options={[
        { value: 'none', label: view.noVoice },
        // A pulldown holds 64: room for no voice, the casts and a described character.
        ...view.casts.slice(0, 62).map(cast => ({ value: cast.id, label: cast.name })),
        ...(shown === 'own' ? [{ value: 'own', label: setting }] : []),
      ]}
      onSelect={choice => (choice === 'own' ? undefined : void view.onSave('voice', choice))}
    />
  )
}

// A text field, saved on Enter or its 💾: the engine's own submit button, which the surface always draws.
const savedField = ({ Input }: FieldKit, view: SettingsView, key: string, value: unknown, isNumber: boolean) => (
  <Input key={key} value={String(value)} submitLabel="💾" onSubmit={typed => view.onSave(key, isNumber ? Number(typed) : typed)} />
)

// Every list's cap in one table: its title right-aligned in a column as wide as the longest, then its
// field with its 💾. Markdown tables hold only text, so it's laid out in Boxes.
const capsTable = (kit: FieldKit, view: SettingsView, text: Strings) => {
  const { Box, Text } = kit
  const rows = LISTS.map(list => ({
    key: list.capKey,
    title: fieldWords(text, list.capKey, '', '')[0],
    value: view.values[list.capKey] ?? FIELDS[list.capKey]?.default ?? 7,
  }))
  const width = Math.max(...rows.map(row => [...row.title].length)) + 1

  return (
    <Box key="row-caps" flexDirection="column" marginBottom={1} rowGap={0}>
      <Text bold>{text.settings.capsHeading}</Text>
      {rows.map(row => (
        <Box key={`cap-${row.key}`} flexDirection="row" flexWrap="nowrap" alignItems="center" columnGap={1}>
          <Box width={width} flexShrink={0} justifyContent="flex-end">
            <Text bold>{row.title}</Text>
          </Box>
          <Box flexGrow={1} flexShrink={1} minWidth={0}>
            {savedField(kit, view, row.key, row.value, true)}
          </Box>
        </Box>
      ))}
    </Box>
  )
}

// The ⚙ view: every setting, edited straight into the config file it names.
// A field's title and description in the user's language; a list's cap names its list.
const fieldWords = (text: Strings, key: string, title: string, description: string): [string, string] => {
  const list = LISTS.find(each => each.capKey === key)
  if (list) {
    const name = text.lists[list.letter].name

    return [fill(text.settings.capTitle, { list: name }), fill(text.settings.capDescription, { list: name })]
  }

  return text.fields[key] ?? [title, description]
}

const drawSettings = ({ Box, Button, Text, Input, Select }: FieldKit, view: SettingsView, text: Strings) => (
  <Box flexDirection="column">
    <Box flexDirection="row" marginBottom={1}>
      <Text bold>{text.settings.title}</Text>
      <Box marginLeft={3}>
        <Button key="done" label={text.settings.done} onPress={view.onDone} />
      </Box>
    </Box>
    <Box flexDirection="column" marginBottom={1}>
      <Text dimColor size="footnote">
        {view.isProject ? text.settings.editingProject : text.settings.editingYours} {view.path}
      </Text>
      <Box marginTop={1}>
        <Text dimColor size="footnote">
          {fill(text.settings.about, { version: view.version || '?', date: dayOf(view.speaking, BUILT) })}
        </Text>
      </Box>
      {view.onCopyToProject ? (
        <Box marginTop={1}>
          <Button key="copy-project" label={text.settings.copyToProject} onPress={view.onCopyToProject} />
        </Box>
      ) : null}
    </Box>
    {Object.entries(FIELDS).map(([key, field]) => {
      // The caps go in one table, where the first of them stands; the rest are in it.
      const capKeys = LISTS.map(list => list.capKey)
      if (capKeys.includes(key)) {
        return key === capKeys.find(each => each in FIELDS) ? capsTable({ Box, Button, Text, Input, Select }, view, text) : null
      }
      const value = view.values[key] ?? field.default
      const control =
        field.kind === 'boolean' ? (
          <Select key={key} value={value ? 'on' : 'off'} options={[{ value: 'on' }, { value: 'off' }]} onSelect={choice => view.onSave(key, choice === 'on')} />
        ) : key === 'language' ? (
          languagePicker(Box, Select, view, value)
        ) : key === 'voice' ? (
          voicePicker(Select, view, value)
        ) : field.kind === 'choice' && field.options ? (
          <Select key={key} value={String(value)} options={field.options.map(option => ({ value: option }))} onSelect={choice => view.onSave(key, choice)} />
        ) : (
          savedField({ Box, Button, Text, Input, Select }, view, key, value, field.kind === 'number')
        )

      const [title, description] = fieldWords(text, key, field.title, field.description)

      return (
        <Box key={`row-${key}`} flexDirection="column" marginBottom={1}>
          <Text bold>{title}</Text>
          <Text dimColor size="footnote">
            {description}
          </Text>
          {control}
        </Box>
      )
    })}
  </Box>
)

// docket's published manifest, read for the update check.
const LATEST_MANIFEST = 'https://raw.githubusercontent.com/StoneCypher/docket/main/.claude-plugin/plugin.json'
const UPDATE_CHECK_MS = 24 * 60 * 60 * 1000

// Whether version a comes after version b, part by part.
export const isNewer = (a: string, b: string) => {
  const parts = (version: string) => version.split('.').map(part => Number.parseInt(part, 10) || 0)
  const [x, y] = [parts(a), parts(b)]
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0)
  }

  return false
}

// Once a day at most, reads docket's manifest on GitHub; when it's newer, says so in Verify, once per
// version. Off with updateCheck, which also stops the request.
const checkForUpdate = async ($: Dollar, current: string, settings: Settings, text: Strings) => {
  if (!settings.isUpdateCheck || !current) return
  const now = await $.clock.now()
  const checkedAt = Number(await $.store.get('updateCheckedAt'))
  if (checkedAt && now - checkedAt < UPDATE_CHECK_MS) return
  await $.store.set('updateCheckedAt', now)
  let latest = ''
  try {
    const { ok, text: body } = await $.http.fetch(LATEST_MANIFEST)
    const { version } = (ok ? JSON.parse(body) : {}) as { version?: unknown }
    latest = typeof version === 'string' ? version : ''
  } catch {
    return
  }
  if (!latest || !isNewer(latest, current) || (await $.store.get('updateNoticed')) === latest) return
  await $.store.set('updateNoticed', latest)
  await addOwn($, [{ list: 'V', emoji: '🔔', rank: 1, text: fill(text.update, { latest, current }), action: 'update' }])
}

// The tool, described in the user's language.
const toolSpec = (text: Strings) => ({
  name: 'update',
  description:
    'Add, change and close items on the docket, the numbered lists the user reads above the prompt. Send every change of a turn in one call. Labels are assigned here and returned. Use change only to correct the same item; a new or follow-up question is a close plus an add, so it gets a new number. When the user asks, it also clears lists, presses an item\'s buttons as their click would, and opens or closes the pane.',
  inputSchema: schemaOf(text),
  isDeferred: false,
})

const localeFile = ($: Dollar, code: string) => `${$.plugin.root}/locales/${code}.json`

// A language file's translations, or none when it's missing or won't parse.
const wordsOf = async ($: Dollar, code: string): Promise<Record<string, unknown>> => {
  try {
    return JSON.parse(await $.fs.read(localeFile($, code)))
  } catch {
    return {}
  }
}

// docket's own words in a language. A regional file (es-MX) says only what differs, over its
// language's (es); a dialect, from locales/dialects/, says what it changes over both; English
// underlies all of them. A dialect's name is what Claude is told the docket is written in.
// A cast, from locales/voices/, is the voice Claude writes in and the buttons it brings, in any
// language: the one the config names, or else the dialect's own.
const stringsOf = async ($: Dollar, language: Language, dialect = '', voiceSetting = '', casts: readonly Cast[] = []) => {
  const [base = 'en'] = language.split('-')
  const spoken = dialect ? await wordsOf($, `dialects/${dialect}`) : {}
  const castId = castIdOf(voiceSetting, casts, typeof spoken.cast === 'string' ? spoken.cast : '')
  const cast = castId ? await wordsOf($, `voices/${castId}`) : {}
  const words = base === 'en' ? {} : await wordsOf($, base)
  const regional = language === base ? {} : await wordsOf($, language)
  const voice = voiceOf(words, regional, spoken, cast)
  const name = typeof spoken.name === 'string' ? spoken.name : englishName(language)
  const marks = cast.marks ?? spoken.marks
  if (base === 'en' && !dialect && !marks) {
    return { text: EN, voice }
  }
  const text = translate({ ...words, ...regional, ...spoken, marks }, base === 'en' && !dialect ? EN.language : name)
  const pictured = cast.marks ? { file: cast, folder: 'voices' } : { file: spoken, folder: 'dialects' }
  for (const key of ['yes', 'no'] as const) {
    const image = markImage(pictured.file, key)
    if (!image) continue
    try {
      text.marks[`${key}Image`] = await $.fs.read(`${$.plugin.root}/locales/${pictured.folder}/${image}`)
    } catch {
      // No picture: the button keeps its text.
    }
  }

  return { text, voice }
}

// The casts, from locales/voices/: each one's file name and its name.
export type Cast = { id: string; name: string }

const castsOf = async ($: Dollar): Promise<Cast[]> => {
  try {
    const ids = (await $.fs.list(`${$.plugin.root}/locales/voices`))
      .filter(entry => entry.kind === 'file' && entry.name.endsWith('.json'))
      .map(entry => entry.name.slice(0, -'.json'.length))
    const found = await Promise.all(ids.map(async id => ({ id, file: await wordsOf($, `voices/${id}`) })))

    return found.map(({ id, file }) => ({ id, name: typeof file.name === 'string' ? file.name : id })).sort((x, y) => x.name.localeCompare(y.name))
  } catch {
    return []
  }
}

// The config's voice: a cast's file name, "none", a character described in words (Claudeville), or
// nothing, which leaves the dialect's own cast if it has one.
const voiceSettingOf = (loaded: LoadedConfig) => String(loaded.project?.voice ?? loaded.user?.voice ?? '').trim()

export const castIdOf = (setting: string, casts: readonly Cast[], dialectCast: string) =>
  setting === 'none' ? '' : casts.some(cast => cast.id === setting) ? setting : setting ? '' : dialectCast

// The voice in force: a character the config describes in words, over any file's.
const voiceFor = (setting: string, casts: readonly Cast[], files: Voice): Voice =>
  setting && setting !== 'none' && !casts.some(cast => cast.id === setting) ? { all: setting, lists: {} } : files

// A language setting may end in a dialect, as BCP 47's variant does: "en-US-startrek" is English with
// the startrek dialect. A variant is at least five characters, so "zh-Hant" is still a script.
const VARIANT = /^([a-z]{2,3}(?:[-_][a-z]{2,4})?)[-_]([a-z][a-z0-9]{4,})$/i

export const splitDialect = (setting: unknown) => {
  const [, language, dialect] = VARIANT.exec(String(setting ?? '').trim()) ?? []

  return language && dialect ? { language, dialect: dialect.toLowerCase() } : { language: setting, dialect: '' }
}

// The forced dialect, if any: the language setting's variant, or a "dialect" key, set by hand.
const dialectOf = (loaded: LoadedConfig) => {
  const named = String(loaded.project?.dialect ?? loaded.user?.dialect ?? '').trim()
  const own = /^[a-z0-9-]+$/i.test(named) ? named.toLowerCase() : ''

  return own || splitDialect(merged(loaded.user, loaded.project).language).dialect
}

// Each language file's state, by code: whatever locales/ holds, so a new language is just its file.
const localesOf = async ($: Dollar): Promise<Record<string, FileState>> => {
  try {
    const codes = (await $.fs.list(`${$.plugin.root}/locales`))
      .filter(entry => entry.kind === 'file' && entry.name.endsWith('.json'))
      .map(entry => entry.name.slice(0, -'.json'.length))

    return Object.fromEntries(await Promise.all(codes.map(async code => [code, stateOf(await wordsOf($, code))] as const)))
  } catch {
    return {}
  }
}

// The dialects, by the language tags that pick them ("en-US-startrek") and their names.
const dialectsOf = async ($: Dollar): Promise<Dialect[]> => {
  try {
    const names = (await $.fs.list(`${$.plugin.root}/locales/dialects`))
      .filter(entry => entry.kind === 'file' && entry.name.endsWith('.json'))
      .map(entry => entry.name.slice(0, -'.json'.length))
    const found = await Promise.all(names.map(async name => ({ name, file: await wordsOf($, `dialects/${name}`) })))

    return found
      .filter(({ file }) => typeof file.tag === 'string')
      .map(({ name, file }) => ({
        tag: String(file.tag),
        name: typeof file.name === 'string' ? file.name : name,
        cast: typeof file.cast === 'string' ? file.cast : undefined,
      }))
  } catch {
    return []
  }
}

// The languages docket can speak: English, and each file not marked unready.
const readyOf = (locales: Record<string, FileState>) =>
  ['en', ...Object.keys(locales).filter(code => locales[code]?.ready !== false)].sort()

// Where to help translate: the language's file in GitHub's editor, which forks the repository for
// someone without access and proposes their change as a pull request; or, with no file yet, a new one.
const translateLink = (code: string, locales: Record<string, FileState>) =>
  code in locales ? `${REPO}/edit/main/locales/${code}.json` : `${REPO}/new/main/locales?filename=${encodeURIComponent(`${code}.json`)}`

// What help a language needs: a translation, when docket can't speak it (asked in English, as
// there's nothing else to ask in); a person's eye, when its file is machine-translated; or new strings,
// when it's behind English. Each is asked once: per language, and per strings version for the others.
const offerTranslation = async ($: Dollar, language: Language, locales: Record<string, FileState>, text: Strings) => {
  const [base = 'en'] = language.split('-')
  if (base === 'en') return
  const spoken = [language, base].find(code => locales[code] && locales[code].ready !== false)
  const state = spoken ? locales[spoken] : undefined
  const target = spoken ?? (language in locales || !(base in locales) ? language : base)
  const need = !state ? 'translate' : state.version < STRINGS_VERSION ? 'behind' : state.ready === AI ? 'machine' : undefined
  if (!need) return
  const key = need === 'translate' ? target : `${target}:${need}@${STRINGS_VERSION}`
  const asked = ((await $.store.get('translateAsked')) as string[] | undefined) ?? []
  const isOpenNow = (await read($, items)).some(item => item.action === 'translate' && item.language === key && isOpen(item))
  if (asked.includes(key) || isOpenNow) return
  const link = translateLink(target, locales)
  const name = englishName(target)
  await addOwn($, [
    {
      list: 'R',
      emoji: '🌐',
      rank: 1,
      text:
        need === 'translate'
          ? `docket doesn't speak ${name} yet. Help [translate it](${link})? ✔ opens locales/${target}.json in GitHub's editor: fill in each empty "text", set its "ready" to true, and save to propose it.`
          : fill(text.translate[need], { language: nativeName(target), link }),
      action: 'translate',
      language: key,
    },
  ])
}

// Opens a web page in the system's browser. Windows goes through rundll32, not cmd, which would
// split the address at its &s.
const openLink = async ($: Dollar, url: string) => {
  const isWindows = (await $.env.get('OS')) === 'Windows_NT'
  const tries = isWindows ? [['rundll32', 'url.dll,FileProtocolHandler', url]] : [['open', url], ['xdg-open', url]]
  for (const argv of tries) {
    try {
      if ((await $.process.run(argv)).exitCode === 0) return
    } catch {
      // Not on this system; try the next.
    }
  }
}

// The mod's own items, answered here and never sent to Claude: the offer to write a config, and the
// offer to help translate. Returns whether a config was written.
const ownAnswer = async ($: Dollar, item: Item, kind: string, paths: ConfigPaths, locales: Record<string, FileState>) => {
  await closeOwn($, item.id)
  if (item.action === 'translate' && item.language) {
    const asked = ((await $.store.get('translateAsked')) as string[] | undefined) ?? []
    await $.store.set('translateAsked', [...new Set([...asked, item.language])])
    const [code = ''] = item.language.split(':')
    if (kind === 'yes') await openLink($, translateLink(code, locales))

    return false
  }
  if (item.action !== 'createConfig') return false
  if (kind !== 'yes') {
    await $.store.set('configDeclined', true)

    return false
  }
  // Written only where there's no file: one made since the offer, or one that won't parse, is kept.
  if (await $.fs.exists(paths.user)) return true
  await $.fs.write(paths.user, serialize(defaults()))

  return true
}

// The language docket's config names, or for "auto", the first language the setup names: Claude Code's
// own setting, then the editor's display language (VS Code tells its terminals), then the locale.
const languageFor = async ($: Dollar, loaded: LoadedConfig, available: readonly string[]) => {
  let claudeCode: unknown
  try {
    claudeCode = (await $.config.list()).find(row => row.key === 'language')?.value
  } catch {
    // No settings menu to ask.
  }
  const hints = [
    claudeCode,
    localeOf(await $.env.get('VSCODE_NLS_CONFIG')),
    localeOf(await $.env.get('LC_ALL')),
    localeOf(await $.env.get('LC_MESSAGES')),
    localeOf(await $.env.get('LANG')),
  ]
  const setting = splitDialect(merged(loaded.user, loaded.project).language).language
  const isAuto = !setting || setting === 'auto'
  // Where nothing above names a language (the desktop app on WSL, say), the one Claude hears.
  const heard = await $.store.get('heardLanguage')
  const isUnheard = isAuto && !hints.some(hint => codeOf(hint)) && !codeOf(heard)

  return { language: resolveLanguage(setting, [...hints, heard], available), isUnheard }
}

// What a reload settles. `spoken` is the files' voice, kept to reuse; `voice` is what's in force.
export type Reloaded = {
  loaded: LoadedConfig
  language: Language
  // On auto with no hint at all: Claude is asked to say the user's language.
  isUnheard: boolean
  dialect: string
  text: Strings
  spoken: Voice
  voice: Voice
  languages: string[]
  locales: Record<string, FileState>
  dialects: Dialect[]
  voiceSetting: string
  casts: Cast[]
}

// Loads the config, then the language it names, registering the tool again in a new language, then
// adds its notes in that language. With nothing before it, the tool is registered regardless.
const reloadConfig = async ($: Dollar, paths: ConfigPaths, was?: Reloaded): Promise<Reloaded> => {
  const loaded = await loadConfig($, paths)
  // The files are read once a session: they change only with docket itself.
  const locales = was?.locales ?? (await localesOf($))
  const dialects = was?.dialects ?? (await dialectsOf($))
  const languages = readyOf(locales)
  const { language, isUnheard } = await languageFor($, loaded, languages)
  const dialect = dialectOf(loaded)
  const casts = was?.casts ?? (await castsOf($))
  const voiceSetting = voiceSettingOf(loaded)
  const isSame = was !== undefined && was.language === language && was.dialect === dialect && was.voiceSetting === voiceSetting
  const { text, voice: spoken } = isSame ? { text: was.text, voice: was.spoken } : await stringsOf($, language, dialect, voiceSetting, casts)
  const voice = voiceFor(voiceSetting, casts, spoken)
  if (!isSame) {
    await $.tool.register(toolSpec(text))
    $.ui.invalidate('ui.render')
  }
  // A note already open, as an unreadable file's on every prompt, isn't added again.
  const shown = new Set((await read($, items)).filter(isOpen).map(item => item.text))
  const fresh = loaded.notes.map(note => noteText(text, note)).filter(note => !shown.has(note))
  if (fresh.length) {
    await addOwn($, fresh.map(note => ({ list: 'V', emoji: '⚙️', rank: 1, text: note })))
  }
  if (!was || was.language !== language) {
    await offerTranslation($, language, locales, text)
  }

  return { loaded, language, isUnheard, dialect, voiceSetting, casts, text, spoken, voice, languages, locales, dialects }
}

// What register holds that the functions below share, read live through getters, and its adopt, which
// takes what a reload found.
type Live = {
  readonly settings: Settings
  readonly text: Strings
  readonly voice: Voice
  readonly paths: ConfigPaths
  readonly files: LoadedConfig
  readonly locales: Record<string, FileState>
  readonly version: string
  was: () => Reloaded
  adopt: (next: Reloaded) => void
}

// A press on one of the mod's own items, from the pane, the band or Claude alike: 👁️ opens its file,
// and an answer is the mod's to handle. A config it writes is read at once and pointed out in Verify.
// e.g. actOn($, live, r1, 'yes') on the config offer writes the config and adds "Look at your new config".
const actOn = async ($: Dollar, live: Live, item: Item, kind: string) => {
  if (kind === 'open') {
    if (item.open) await openFile($, item.open)

    return
  }
  if (!(await ownAnswer($, item, kind, live.paths, live.locales))) return
  live.adopt(await reloadConfig($, live.paths, live.was()))
  const { paths, text } = live
  await addOwn($, [{ list: 'V', emoji: '⚙️', rank: 1, text: fill(text.config.lookAt, { path: fileLink(paths.user) }), open: paths.user }])
}

// Whether the model has docket's tool now. Where the engine can't say, it's taken as there, so
// nothing is registered on a guess.
const hasTool = async ($: Dollar) => {
  try {
    return (await $.tool.list()).some(tool => tool.name === TOOL)
  } catch {
    return true
  }
}

// A session's first steps: /docket, then docket's version and where its config lives. A command the
// engine won't register leaves the rest to go on.
const startOf = async ($: Dollar, cwd: string) => {
  try {
    await $.command.register({ name: 'docket', description: 'Open the docket pane' })
  } catch {
    // /docket is missing this session; the docket itself still works.
  }

  return { version: await versionOf($), paths: await configPaths($, cwd) }
}

// What follows the config at a session's start: the update check, the language the items are written
// in, the offer to write a config, and the pane.
const settle = async ($: Dollar, live: Live) => {
  const { settings, text, voice, paths, files: loaded, version } = live
  // After the config, which may turn the check off.
  void checkForUpdate($, version, settings, text)
  if (!(await read($, spokenAs))) await update($, spokenAs, () => speechOf(text, voice))
  // With no config of the user's own, offer to write one: once, and not again after a no.
  const isOffered = (await read($, items)).some(item => item.action === 'createConfig' && isOpen(item))
  if (!loaded.user && !(await $.fs.exists(paths.user)) && !isOffered && !(await $.store.get('configDeclined'))) {
    await addOwn($, [
      {
        list: 'R',
        emoji: '⚙️',
        rank: 1,
        text: fill(text.config.offer, { path: fileLink(paths.user) }),
        action: 'createConfig',
      },
    ])
  }
  if (settings.display === 'pane') {
    void openPane($, version)
  }
}

// Clears the lists Claude named, by letter or "all", as their headings' ✕ would. Returns its report.
// e.g. clearNamed($, EN, ['Q', 'Z']) clears the questions and says no list has the letter Z.
const clearNamed = async ($: Dollar, text: Strings, named: readonly string[]) => {
  const isAll = (each: string) => String(each).toLowerCase() === 'all'
  const letters = named.some(isAll)
    ? [...LETTERS]
    : named.map(each => letterFor(text, String(each))).filter((letter): letter is Letter => Boolean(letter))
  const strays = named.filter(each => !isAll(each) && !letterFor(text, String(each)))
  const ids = letters.length ? await clearLists($, letters) : []

  return [`Cleared ${ids.map(id => labelOfId(text, id)).join(', ') || 'nothing'}.`, strays.length ? `No list has the letter: ${strays.join(', ')}.` : '']
}

// Presses the buttons Claude named, one at a time, as the person's clicks would. Returns its report.
// e.g. pressNamed($, live, [{ id: 'R1', button: 'yes' }]) answers the config offer as its ✔ does.
const pressNamed = async ($: Dollar, live: Live, presses: readonly { id: string; button: string }[]) => {
  const { text, settings } = live
  const said: string[] = []
  for (const { id, button } of presses) {
    const internal = idFor(text, String(id))
    const item = (await read($, items)).find(each => each.id === internal && isOpen(each))
    if (!item) {
      said.push(`No open item ${id}.`)
      continue
    }
    const offered = buttonsOf(item, text)
    const found = buttonOf(offered, String(button ?? ''))
    if (!found) {
      said.push(`${labelOf(text, item)} has no ${button} button now; it has ${offered.map(each => each.button).join(', ') || 'none'}.`)
      continue
    }
    await pressItem($, item, found, settings.answeredMs, (own, kind) => actOn($, live, own, kind))
    said.push(`Pressed ${found.button} on ${labelOf(text, item)}.`)
  }

  return said
}

// Opens or closes the pane for Claude. Returns its report.
// e.g. paneTo($, '0.5.0', 'close') closes it for good and says so.
const paneTo = async ($: Dollar, version: string, to: string) => {
  if (to === 'close') {
    const refused = await closePane($)

    return refused ? `The pane didn't close: ${refused}` : 'Pane closed. It stays closed, the band with it, until /docket or you open it again.'
  }
  if (to !== 'open') return `No pane action ${to}: it's open or close.`

  return (await openPane($, version))
    ? 'Pane opened.'
    : "The pane is open but not placed yet: a surface places a pane nobody asked for from 144 columns, or at once when the user runs /docket."
}

export const register: Register = on => {
  // The settings come from docket's config files, read at the session's start and on every prompt.
  let settings = settingsOf(merged())
  let version = ''
  let paths: ConfigPaths = { user: '' }
  let files: LoadedConfig = { notes: [] }
  // docket's own words, in the language its config names, or Claude Code's.
  let text = EN
  let language: Language = 'en'
  let isUnheard = false
  let dialect = ''
  let spoken: Voice = { all: '', lists: {} }
  let voice: Voice = { all: '', lists: {} }
  let languages = ['en']
  let locales: Record<string, FileState> = {}
  let dialects: Dialect[] = []
  let voiceSetting = ''
  let casts: Cast[] = []

  const apply = (loaded: LoadedConfig) => {
    files = loaded
    settings = settingsOf(merged(loaded.user, loaded.project))
  }

  // Takes what a reload found.
  const adopt = (next: Reloaded) => {
    apply(next.loaded)
    text = next.text
    language = next.language
    isUnheard = next.isUnheard
    dialect = next.dialect
    spoken = next.spoken
    voice = next.voice
    languages = next.languages
    locales = next.locales
    dialects = next.dialects
    voiceSetting = next.voiceSetting
    casts = next.casts
  }

  // What a reload compares against: everything the last one settled.
  const was = (): Reloaded => ({ loaded: files, language, isUnheard, dialect, voiceSetting, casts, text, spoken, voice, languages, locales, dialects })

  // register's state, read live by the functions the hooks share.
  const live: Live = {
    get settings() {
      return settings
    },
    get text() {
      return text
    },
    get voice() {
      return voice
    },
    get paths() {
      return paths
    },
    get files() {
      return files
    },
    get locales() {
      return locales
    },
    get version() {
      return version
    },
    was,
    adopt,
  }

  // Set once the session's setup has run to its end; until then each prompt tries it again.
  let isSetUp = false

  on('session.start', async ($, e, next) => {
    // The tool first, in English: whatever fails after this, Claude has it, and the config's language
    // registers it again in a moment.
    await $.tool.register(toolSpec(text))
    ;({ version, paths } = await startOf($, e.cwd))
    // Settled afresh in each process, so the tool is registered whatever the language.
    adopt(await reloadConfig($, paths))
    await settle($, live)
    isSetUp = true

    return next(e)
  })

  // The docket is the mod's own bookkeeping: it never needs the user's permission.
  on('tool.check', { tool: TOOL }, () => ({ decision: 'allow' }))

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const input = e as unknown as UpdateInput
    // The user's language, as Claude hears it: kept, and taken at once where docket is on auto.
    const heard = typeof input.language === 'string' ? codeOf(input.language) : undefined
    if (heard && heard !== (await $.store.get('heardLanguage'))) {
      await $.store.set('heardLanguage', heard)
      adopt(await reloadConfig($, paths, was()))
    }
    // Clearing comes first, so a clear and an add in one call start the docket afresh.
    const cleared = Array.isArray(input.clear) && input.clear.length ? await clearNamed($, text, input.clear) : []
    const now = await $.clock.now()
    const at = await read($, turn)
    await update($, updatedTurn, () => at)

    const added: Item[] = []
    // Adds naming no list of this language, reported rather than dropped without a word.
    const strays: string[] = []
    await update($, counters, current => {
      const next = { ...current }
      added.length = 0
      strays.length = 0
      for (const spec of input.add ?? []) {
        // The list comes in the language's letter.
        const list = letterFor(text, String(spec.list ?? ''))
        if (!list || typeof spec.text !== 'string') {
          strays.push(String(spec.list ?? '?'))
          continue
        }
        const n = (next[list] ?? 0) + 1
        next[list] = n
        added.push({
          ...fieldsOf(spec),
          id: `${list}${n}`,
          list,
          n,
          text: spec.text,
          addedTurn: at,
          changedTurn: at,
          changedAt: now,
        })
      }

      return next
    })

    // Labels come in the language's letters too; one naming no list is reported back as written.
    const idOf = (label: string) => idFor(text, String(label)) ?? `?${label}`
    const changes = new Map((input.change ?? []).map(spec => [idOf(spec.id), fieldsOf(spec)]))
    const closes = new Map((input.close ?? []).map(spec => [idOf(spec.id), spec.unasked === true]))
    const known = new Set<string>()
    let isUnaskedClose = false

    await update($, items, current => {
      known.clear()
      isUnaskedClose = false
      const next = current.map(item => {
        const change = changes.get(item.id)
        const isUnasked = closes.get(item.id)
        if (change === undefined && isUnasked === undefined) {
          return item
        }
        known.add(item.id)
        // A change is Claude's answer to the reply, so the row takes its buttons back.
        let out: Item = change ? { ...withoutAnswer(item), ...change, changedTurn: at, changedAt: now } : item
        if (isUnasked !== undefined && isOpen(out)) {
          out = { ...out, closed: { at: now, isUnasked }, changedTurn: at }
          isUnaskedClose ||= isUnasked
        }

        return out
      })

      const closed = next.filter(item => !isOpen(item))
      const dropped = new Set(closed.slice(0, Math.max(0, closed.length - CLOSED_KEPT)))

      return [...next.filter(item => !dropped.has(item)), ...added]
    })

    // Redraw once the new and changed items are settled enough for the bulk buttons to count them.
    if (added.length || changes.size) {
      $.clock.after(BULK_SETTLE_MS + 200, () => $.ui.invalidate('ui.render'))
    }
    if (isUnaskedClose) {
      // Redraw once the struck-through items have outstayed their linger.
      $.clock.after(settings.lingerMs + 1000, () => $.ui.invalidate('ui.render'))
    }

    // Presses after the adds and changes, so one call can add an item and press it; the pane last.
    const pressed = Array.isArray(input.press) && input.press.length ? await pressNamed($, live, input.press) : []
    const paned = typeof input.pane === 'string' ? await paneTo($, version, input.pane) : ''

    const shown = (id: string) => (id.startsWith('?') ? id.slice(1) : labelOfId(text, id))
    const unknown = [...new Set([...changes.keys(), ...closes.keys()])].filter(id => !known.has(id))
    const report = [
      ...cleared,
      added.length && `Added ${added.map(item => labelOf(text, item)).join(', ')}.`,
      changes.size && `Changed ${[...changes.keys()].filter(id => known.has(id)).map(shown).join(', ') || 'nothing'}.`,
      closes.size && `Closed ${[...closes.keys()].filter(id => known.has(id)).map(shown).join(', ') || 'nothing'}.`,
      unknown.length && `No such items: ${unknown.map(shown).join(', ')}.`,
      strays.length && `Not added, as no list has the letter: ${strays.join(', ')}.`,
      // The language may have changed since those labels were read: say what the letters are now.
      (unknown.length || strays.length) && `The docket's letters are now ${LETTERS.map(letter => `${text.lists[letter].letter} ${text.lists[letter].name}`).join(', ')}.`,
      ...pressed,
      paned,
    ]
      .filter(Boolean)
      .join(' ')

    return { result: report || 'No changes.' }
  })

  // Deep dive's visible send-back. The review itself rides each prompt as hidden context (REVIEW); this
  // is the fallback for when Claude skipped it: a turn the user started whose reply spoke of pending work
  // while the docket stayed as it was. Background turns never get one, and no turn gets two: the Stop
  // hook says when it's already been sent back.
  on('classic.Stop', async ($, e, next) => {
    const result = await next(e)
    if (result.block) {
      return result
    }
    const isSent = sendsBack({
      isDeepDiving: await isDeepDiving($, settings),
      isUserTurn: await read($, isUserTurn),
      isStopHookActive: e.stop_hook_active,
      answer: e.last_assistant_message,
      isChanged: (await read($, updatedTurn)) === (await read($, turn)),
    })

    return isSent ? { ...result, block: SEND_BACK } : result
  })

  // The end-of-turn check: a main-loop answer that speaks of pending work but changed nothing is flagged.
  on('turn.complete', async ($, e, next) => {
    if (!e.agentId && e.reason === 'answer' && speaksOfPending(e.answer)) {
      const isChanged = (await read($, updatedTurn)) === (await read($, turn))
      await update($, isUnreconciled, () => !isChanged)
    }
    // The main loop's turn is over: what Claude's presses held goes now, as the user's prompt.
    if (!e.agentId) await sendHeld($)

    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)

    return {
      sections: [
        ...composed.sections,
        { id: 'docket:instructions', text: instructions(settings, e.surfaces.length === 0, text, voice), scope: 'session' },
      ],
    }
  })

  // Each prompt starts a turn: the deltas count from here, and the model gets the docket, with Deep
  // dive's review when it's on. Every prompt, meta or not, says whether the user started the turn.
  on('prompt.submit', async ($, e, next) => {
    await update($, isUserTurn, was => userTurnAfter(was, e.origin, e.turnId))
    if (e.isMeta) {
      return next(e)
    }

    await update($, turn, n => n + 1)
    void checkForUpdate($, version, settings, text)
    if (!isSetUp) {
      // The setup never finished (it failed, or the start never reached docket): try it again here.
      try {
        ;({ version, paths } = await startOf($, await $.session.cwd()))
        adopt(await reloadConfig($, paths))
        await settle($, live)
        isSetUp = true
      } catch {
        // Next prompt, then.
      }
    } else if (paths.user) {
      adopt(await reloadConfig($, paths, was()))
    }
    // A tool the model has lost, or never got, is registered again before the turn's request.
    if (!(await hasTool($))) await $.tool.register(toolSpec(text))
    const all = await read($, items)
    await update($, baseline, () => openCounts(all))
    const gone = await read($, dismissed)
    await update($, dismissed, () => [])

    const context = [snapshot(all, gone, text)]
    const now = nowNote(text, voice)
    if (now) context.push(now)
    if (isUnheard) {
      context.push(
        "docket is on auto and nothing told it the user's language, so it shows English. In your next docket update, say which language the user writes to you in, with the tool's language field (a code such as de, or en for English): docket will switch to it, and stop asking.",
      )
    }
    // Switched into a voice, out of one, or to another language: the open items follow.
    const speech = speechOf(text, voice)
    const wasSpoken = await read($, spokenAs)
    if (wasSpoken && wasSpoken !== speech && all.some(item => isOpen(item) && !item.action)) {
      context.push(rewriteNote(text, voice))
    }
    await update($, spokenAs, () => speech)
    if (await read($, isUnreconciled)) {
      context.push(RECONCILE)
      await update($, isUnreconciled, () => false)
    }
    const named = references(e.text, all, text)
    if (named) {
      context.push(named)
    }
    if (await isDeepDiving($, settings)) {
      context.push(REVIEW)
    }

    return next({ ...e, context: [...(e.context ?? []), ...context] })
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) {
      isPaneShown = false
      // Closed on purpose, not dropped by an unload: keep docket out of the band too.
      isPaneClosed = e.origin.kind !== 'unload'
      $.ui.invalidate('ui.render')
    }

    return next(e)
  })

  on('command.run', { command: 'docket' }, async $ => {
    const isPlaced = await openPane($, version)

    return { text: isPlaced ? 'Docket pane opened.' : 'This surface draws no pane, so the docket stays above the prompt.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    // Drawn, so placed: the engine may place the pane later than asked (a wider terminal, a surface
    // attaching), and the band must stand down then.
    if (!isPaneShown) {
      isPaneShown = true
      isPaneClosed = false
      $.ui.invalidate('ui.render')
    }
    const kit = $.ui.resolve(e)
    const { Box, Text } = kit

    // The mod's own items are answered here, not by Claude.
    const onAction: OnAction = (item, kind) => actOn($, live, item, kind)

    if (await read($, isSettings)) {
      const target = files.project ? paths.project : paths.user
      const view: SettingsView = {
        onDone: () => {
          // A group opened but never picked from is forgotten.
          void update($, languageGroup, () => '')
          void update($, isSettings, () => false)
        },
        values: merged(files.user, files.project) as Record<string, string | number | boolean>,
        path: target ?? paths.user,
        isProject: Boolean(files.project),
        userPath: paths.user,
        speaking: language,
        version,
        languages,
        dialects,
        casts,
        dialectCast: dialects.find(each => each.tag.toLowerCase().endsWith(`-${dialect}`))?.cast ?? '',
        noVoice: text.settings.noVoice,
        group: await read($, languageGroup),
        onGroup: group => void update($, languageGroup, () => group),
        onSave: async (key, value) => {
          const path = target ?? paths.user
          // A file that won't parse is the person's to fix: saving over it would lose their edits.
          if (files.notes.some(note => note.kind === 'unreadable' && note.path === path)) return
          if (key === 'language') await update($, languageGroup, () => '')
          const current = (files.project ? files.project : files.user) ?? defaults()
          await $.fs.write(path, serialize({ ...current, [key]: value }))
          adopt(await reloadConfig($, paths, { loaded: files, language, isUnheard, dialect, voiceSetting, casts, text, spoken, voice, languages, locales, dialects }))
          $.ui.invalidate('ui.render')
        },
        onCopyToProject:
          paths.project && !files.project
            ? async () => {
                await $.fs.write(paths.project ?? '', serialize(files.user ?? defaults()))
                adopt(await reloadConfig($, paths, { loaded: files, language, isUnheard, dialect, voiceSetting, casts, text, spoken, voice, languages, locales, dialects }))
                $.ui.invalidate('ui.render')
              }
            : undefined,
      }
      // The phone draws no fields yet.
      const body =
        e.surface === 'mobile' ? <Text dimColor>{text.settings.mobile}</Text> : drawSettings($.ui.resolve(e), view, text)

      return (
        <Box flexDirection="column" flexGrow={1} justifyContent="space-between">
          {body}
          {await gear($, kit, e.surface, settings, text, markdownOf(kit, e.surface))}
        </Box>
      )
    }

    const lists = await draw($, kit, settings, e.props.bodyColumns, false, e.surface, onAction, text, svgOf(kit, e.surface), markdownOf(kit, e.surface))

    return (
      <Box flexDirection="column" flexGrow={1} justifyContent="space-between">
        {lists ?? <Text dimColor>{text.nothing}</Text>}
        {await gear($, kit, e.surface, settings, text, markdownOf(kit, e.surface))}
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (settings.display === 'pane' && (isPaneShown || isPaneClosed))) {
      return next(e)
    }

    // The band has no settings view; the config offer's buttons still work there, as in the pane.
    const onAction: OnAction = (item, kind) => actOn($, live, item, kind)

    const kit = $.ui.resolve(e)

    return (await draw($, kit, settings, e.props.bodyColumns, true, e.surface, onAction, text, svgOf(kit, e.surface), markdownOf(kit, e.surface))) ?? next(e)
  })
}
