import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, Register } from 'claude-code'

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
  references,
  settingsOf,
  snapshot,
  speaksOfPending,
} from './lists'
import type { Settings } from './lists'
import { CONFIG_VERSION, FIELDS, defaults, merged, migrate, parse, serialize } from './config'
import type { ConfigFile } from './config'
import { AI, EN, STRINGS_VERSION, fill, idFor, labelOf, labelOfId, letterFor, resolveLanguage, stateOf, translate, voiceOf } from './i18n'
import type { FileState, Voice } from './i18n'
import { englishName, nativeName } from './languages'
import type { Language, Strings } from './i18n'

const TOOL = 'mcp__docket__update'
const PANE = 'docket'
const CLOSED_KEPT = 200

type Dollar = EngineInterface
type Kit = Pick<Elements['terminal'], 'Box' | 'Button' | 'Text' | 'Link'>
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

type Fields = { text?: string; emoji?: string; lean?: string; stakes?: Stakes; rank?: number; options?: string[]; open?: string }
type UpdateInput = {
  add?: (Fields & { list: Letter; text: string })[]
  change?: (Fields & { id: string })[]
  close?: { id: string; unasked?: boolean }[]
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
const openPane = async ($: Dollar) => {
  const { isPlaced } = await $.ui.open({ id: PANE, title: 'Docket' })
  isPaneShown = isPlaced
  isPaneClosed = false
  $.ui.invalidate('ui.render')

  return isPlaced
}

// Every list with something to show, or null when the docket is empty.
const draw = async (
  $: Dollar,
  { Box, Button, Text, Link }: Kit,
  settings: Settings,
  columns: number,
  isByPrompt: boolean,
  surface: string,
  onAction: (item: Item, kind: string) => Promise<void>,
  text: Strings,
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

  // An item's ✕: clears just that item.
  const dismiss = (id: string) => async () => {
    const at = await $.clock.now()
    await update($, items, current =>
      current.map(item => (item.id === id && isOpen(item) ? { ...item, closed: { at, isUnasked: false } } : item)),
    )
    await update($, dismissed, gone => [...gone, id])
  }

  // The heading's ✕: dismisses every open item in the list.
  const dismissList = (letter: Letter) => async () => {
    const at = await $.clock.now()
    const ids: string[] = []
    await update($, items, current => {
      ids.length = 0

      return current.map(item => {
        if (item.list !== letter || !isOpen(item)) {
          return item
        }
        ids.push(item.id)

        return { ...item, closed: { at, isUnasked: false } }
      })
    })
    await update($, dismissed, gone => [...gone, ...ids])
  }

  // Marks items answered at once, so the row dims and drops its buttons before Claude acts on the reply.
  const markAnswered = async (ids: readonly string[], answer: string) => {
    const answeredAt = await $.clock.now()
    await update($, items, current =>
      current.map(item => (ids.includes(item.id) && isOpen(item) ? { ...item, answered: answer, answeredAt } : item)),
    )
    // Redraw once the answered rows are due to go.
    $.clock.after(settings.answeredMs + 500, () => $.ui.invalidate('ui.render'))
  }

  // A ✔ or ✗: answers one item, as if the user had typed it.
  const answer = (id: string, kind: string, text: string) => async () => {
    await markAnswered([id], kind)
    // The mod's own items are handled here and never reach Claude.
    const item = all.find(each => each.id === id)
    if (item?.action) {
      await onAction(item, kind)

      return
    }
    await $.prompt.submit({ text, asUser: true })
  }

  // Whether a lean fits on one line beside its buttons: an estimate in cells, as no surface reports
  // rendered widths. The lean's margin and the two buttons side by side take about 9.
  const isOneLine = (text: string, reserve = 0) => text.length <= columns - 9 - reserve

  // What a list's bulk button would answer: open items not already sent, and for questions only
  // those with a lean to accept.
  const bulkable = (list: readonly Item[], letter: Letter) =>
    list.filter(item => item.list === letter && isOpen(item) && !item.answered && (letter !== 'Q' || item.lean))

  // A bulk button answers only the items on screen: never the ones hidden past the cap.
  const accept = (send: keyof Strings['send'], letter: Letter, shown: readonly Item[]) => async () => {
    const onScreen = new Set(shown.map(item => item.id))
    const ids = bulkable(await read($, items), letter)
      .filter(item => onScreen.has(item.id))
      .map(item => item.id)
    if (ids.length) {
      await markAnswered(ids, 'yes')
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

  // An item's own line: label, emoji, stakes, text.
  const line = (item: Item, isLingering: boolean, isDim: boolean) => (
    // Struck through while lingering, and once sent: the answer is out, the item is on its way.
    <Text {...itemColor(isLingering, isDim)} strikethrough={isLingering || item.answered !== undefined}>
      <Text bold>{label(item)}.</Text>
      {marker(item)}
      {stakesTag(item)} {linkify(item.text)}
      {item.addedTurn === at && !isLingering ? ` ${text.new}` : ''}
    </Text>
  )

  // A ✔ and ✗ pair, side by side when the text beside them fits on one line, stacked when it wraps.
  // `reserve` is the cells other controls take on the same line.
  // Once answered, a plain mark of the answer sent stands in for the pair.
  const yesNo = (item: Item, yes: string, no: string, beside: string, reserve = 0) =>
    item.answered ? (
      <Box flexShrink={0} marginLeft={1}>
        <Text size="caption" dimColor>
          {item.answered === 'yes' ? text.marks.yes : item.answered === 'no' ? text.marks.no : item.answered}
        </Text>
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
                {list.bulk && bulkable(shown, list.letter).length > 1 ? (
                  <Button key={`bulk-${list.letter}`} label={text.bulk[list.letter as 'Q' | 'C' | 'R']} onPress={accept(list.bulk, list.letter, shown)} />
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

const gear = ($: Dollar, { Box, Button, Link, Text }: Kit, surface: string) => (
  <Box flexDirection="row" justifyContent="flex-end" alignItems="center" columnGap={2} marginTop={1}>
    <Text dimColor size="caption">
      <Link href={REPO}>GitHub</Link>
    </Text>
    <Button key="gear" plain dimColor onPress={() => update($, isSettings, isOn => !isOn)}>
      <Text size="caption">{surface === 'terminal' ? '⚙' : '⚙️'}</Text>
    </Button>
  </Box>
)

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
    const migration = migrate(raw)
    if (migration.isChanged) {
      await $.fs.write(path, serialize(migration.config))
      loaded.notes.push({ kind: 'updated', path, from: migration.from, added: migration.added })
    }
    loaded[scope] = migration.config
  }

  return loaded
}

// Opens a file in VS Code, reusing its window, or else in the system's default app for it. Windows
// needs cmd for both, since code is a .cmd script there and start is a shell command.
const openFile = async ($: Dollar, path: string) => {
  const isWindows = (await $.env.get('OS')) === 'Windows_NT'
  const tries = isWindows
    ? [['cmd', '/c', 'code', '-r', path], ['cmd', '/c', 'start', '', path]]
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
  // The language setting's choices: auto, then each language docket has a file for.
  languages: string[]
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
      {view.onCopyToProject ? (
        <Box marginTop={1}>
          <Button key="copy-project" label={text.settings.copyToProject} onPress={view.onCopyToProject} />
        </Box>
      ) : null}
    </Box>
    {Object.entries(FIELDS).map(([key, field]) => {
      const value = view.values[key] ?? field.default
      const control =
        field.kind === 'boolean' ? (
          <Select key={key} value={value ? 'on' : 'off'} options={[{ value: 'on' }, { value: 'off' }]} onSelect={choice => view.onSave(key, choice === 'on')} />
        ) : field.kind === 'choice' && field.options ? (
          <Select
            key={key}
            value={String(value)}
            options={(key === 'language' ? ['auto', ...view.languages] : field.options).map(option => ({ value: option }))}
            onSelect={choice => view.onSave(key, choice)}
          />
        ) : (
          <Input key={key} value={String(value)} submitLabel="save" onSubmit={text => view.onSave(key, field.kind === 'number' ? Number(text) : text)} />
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

// The tool, described in the user's language.
const toolSpec = (text: Strings) => ({
  name: 'update',
  description:
    'Add, change and close items on the docket, the numbered lists the user reads above the prompt. Send every change of a turn in one call. Labels are assigned here and returned. Use change only to correct the same item; a new or follow-up question is a close plus an add, so it gets a new number.',
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
// underlies all of them. A dialect's name is what Claude is told the docket is written in. Any of
// the files may give Claude a voice to write in, the later ones winning.
const stringsOf = async ($: Dollar, language: Language, dialect = ''): Promise<{ text: Strings; voice: Voice }> => {
  const [base = 'en'] = language.split('-')
  const spoken = dialect ? await wordsOf($, `dialects/${dialect}`) : {}
  const words = base === 'en' ? {} : await wordsOf($, base)
  const regional = language === base ? {} : await wordsOf($, language)
  const voice = voiceOf(words, regional, spoken)
  if (base === 'en' && !dialect) {
    return { text: EN, voice }
  }
  const name = typeof spoken.name === 'string' ? spoken.name : englishName(language)

  return { text: translate({ ...words, ...regional, ...spoken }, name), voice }
}

// The voice in force: the config's own, set by hand, over any file's. Claudeville.
const voiceFor = (loaded: LoadedConfig, files: Voice): Voice => {
  const own = String(loaded.project?.voice ?? loaded.user?.voice ?? '').trim()

  return own ? { all: own, lists: {} } : files
}

// The forced dialect, if any: a key docket never writes or shows, set by hand in a config file.
const dialectOf = (loaded: LoadedConfig) => {
  const named = String(loaded.project?.dialect ?? loaded.user?.dialect ?? '').trim()

  return /^[a-z0-9-]+$/i.test(named) ? named.toLowerCase() : ''
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
  await $.fs.write(paths.user, serialize(defaults()))

  return true
}

// The language docket's config names, or else Claude Code's own.
const languageFor = async ($: Dollar, loaded: LoadedConfig, available: readonly string[]) => {
  let claudeCode: unknown
  try {
    claudeCode = (await $.config.list()).find(row => row.key === 'language')?.value
  } catch {
    // No settings menu to ask: docket's own setting, or English.
  }

  return resolveLanguage(merged(loaded.user, loaded.project).language, claudeCode, available)
}

// What a reload settles. `spoken` is the files' voice, kept to reuse; `voice` is what's in force.
export type Reloaded = {
  loaded: LoadedConfig
  language: Language
  dialect: string
  text: Strings
  spoken: Voice
  voice: Voice
  languages: string[]
  locales: Record<string, FileState>
}

// Loads the config, then the language it names, registering the tool again in a new language, then
// adds its notes in that language. With nothing before it, the tool is registered regardless.
const reloadConfig = async ($: Dollar, paths: ConfigPaths, was?: Reloaded): Promise<Reloaded> => {
  const loaded = await loadConfig($, paths)
  // The files are read once a session: they change only with docket itself.
  const locales = was?.locales ?? (await localesOf($))
  const languages = readyOf(locales)
  const language = await languageFor($, loaded, languages)
  const dialect = dialectOf(loaded)
  const isSame = was !== undefined && was.language === language && was.dialect === dialect
  const { text, voice: spoken } = isSame ? { text: was.text, voice: was.spoken } : await stringsOf($, language, dialect)
  const voice = voiceFor(loaded, spoken)
  if (!isSame) {
    await $.tool.register(toolSpec(text))
    $.ui.invalidate('ui.render')
  }
  if (loaded.notes.length) {
    await addOwn($, loaded.notes.map(note => ({ list: 'V', emoji: '⚙️', rank: 1, text: noteText(text, note) })))
  }
  if (!was || was.language !== language) {
    await offerTranslation($, language, locales, text)
  }

  return { loaded, language, dialect, text, spoken, voice, languages, locales }
}

export const register: Register = on => {
  // The settings come from docket's config files, read at the session's start and on every prompt.
  let settings = settingsOf(merged())
  let paths: ConfigPaths = { user: '' }
  let files: LoadedConfig = { notes: [] }
  // docket's own words, in the language its config names, or Claude Code's.
  let text = EN
  let language: Language = 'en'
  let dialect = ''
  let spoken: Voice = { all: '', lists: {} }
  let voice: Voice = { all: '', lists: {} }
  let languages = ['en']
  let locales: Record<string, FileState> = {}

  const apply = (loaded: LoadedConfig) => {
    files = loaded
    settings = settingsOf(merged(loaded.user, loaded.project))
  }

  // Takes what a reload found.
  const adopt = (next: Reloaded) => {
    apply(next.loaded)
    text = next.text
    language = next.language
    dialect = next.dialect
    spoken = next.spoken
    voice = next.voice
    languages = next.languages
    locales = next.locales
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'docket', description: 'Open the docket pane' })
    paths = await configPaths($, e.cwd)
    // Settled afresh in each process, so the tool is registered whatever the language.
    adopt(await reloadConfig($, paths))
    const loaded = files
    // With no config of the user's own, offer to write one: once, and not again after a no.
    const isOffered = (await read($, items)).some(item => item.action === 'createConfig' && isOpen(item))
    if (!loaded.user && !isOffered && !(await $.store.get('configDeclined'))) {
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
      void openPane($)
    }

    return next(e)
  })

  // The docket is the mod's own bookkeeping: it never needs the user's permission.
  on('tool.check', { tool: TOOL }, () => ({ decision: 'allow' }))

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const input = e as unknown as UpdateInput
    const now = await $.clock.now()
    const at = await read($, turn)
    await update($, updatedTurn, () => at)

    const added: Item[] = []
    await update($, counters, current => {
      const next = { ...current }
      added.length = 0
      for (const spec of input.add ?? []) {
        // The list comes in the language's letter.
        const list = letterFor(text, String(spec.list ?? ''))
        if (!list || typeof spec.text !== 'string') {
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
        let out: Item = change ? { ...withoutAnswer(item), ...change, changedTurn: at } : item
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

    if (isUnaskedClose) {
      // Redraw once the struck-through items have outstayed their linger.
      $.clock.after(settings.lingerMs + 1000, () => $.ui.invalidate('ui.render'))
    }

    const shown = (id: string) => (id.startsWith('?') ? id.slice(1) : labelOfId(text, id))
    const unknown = [...new Set([...changes.keys(), ...closes.keys()])].filter(id => !known.has(id))
    const report = [
      added.length && `Added ${added.map(item => labelOf(text, item)).join(', ')}.`,
      changes.size && `Changed ${[...changes.keys()].filter(id => known.has(id)).map(shown).join(', ') || 'nothing'}.`,
      closes.size && `Closed ${[...closes.keys()].filter(id => known.has(id)).map(shown).join(', ') || 'nothing'}.`,
      unknown.length && `No such items: ${unknown.map(shown).join(', ')}.`,
    ]
      .filter(Boolean)
      .join(' ')

    return { result: report || 'No changes.' }
  })

  // The end-of-turn check: a main-loop answer that speaks of pending work but changed nothing is flagged.
  on('turn.complete', async ($, e, next) => {
    if (!e.agentId && e.reason === 'answer' && speaksOfPending(e.answer)) {
      const isChanged = (await read($, updatedTurn)) === (await read($, turn))
      await update($, isUnreconciled, () => !isChanged)
    }

    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)

    return {
      sections: [
        ...composed.sections,
        { id: 'docket', text: instructions(settings, e.surfaces.length === 0, text, voice), scope: 'session' },
      ],
    }
  })

  // Each prompt starts a turn: the deltas count from here, and the model gets the docket.
  on('prompt.submit', async ($, e, next) => {
    if (e.isMeta) {
      return next(e)
    }

    await update($, turn, n => n + 1)
    if (paths.user) {
      adopt(await reloadConfig($, paths, { loaded: files, language, dialect, text, spoken, voice, languages, locales }))
    }
    const all = await read($, items)
    await update($, baseline, () => openCounts(all))
    const gone = await read($, dismissed)
    await update($, dismissed, () => [])

    const context = [snapshot(all, gone, text)]
    if (await read($, isUnreconciled)) {
      context.push(RECONCILE)
      await update($, isUnreconciled, () => false)
    }
    const named = references(e.text, all, text)
    if (named) {
      context.push(named)
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
    const isPlaced = await openPane($)

    return { text: isPlaced ? 'Docket pane opened.' : 'This surface draws no pane, so the docket stays above the prompt.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const kit = $.ui.resolve(e)
    const { Box, Text } = kit

    // The mod's own items are answered here, not by Claude.
    const onAction = async (item: Item, kind: string) => {
      if (kind === 'open') {
        if (item.open) await openFile($, item.open)

        return
      }
      if (!(await ownAnswer($, item, kind, paths, locales))) return
      adopt(await reloadConfig($, paths, { loaded: files, language, dialect, text, spoken, voice, languages, locales }))
      await addOwn($, [{ list: 'V', emoji: '⚙️', rank: 1, text: fill(text.config.lookAt, { path: fileLink(paths.user) }), open: paths.user }])
    }

    if (await read($, isSettings)) {
      const target = files.project ? paths.project : paths.user
      const view: SettingsView = {
        onDone: () => void update($, isSettings, () => false),
        values: merged(files.user, files.project) as Record<string, string | number | boolean>,
        path: target ?? paths.user,
        isProject: Boolean(files.project),
        userPath: paths.user,
        languages,
        onSave: async (key, value) => {
          const path = target ?? paths.user
          const current = (files.project ? files.project : files.user) ?? defaults()
          await $.fs.write(path, serialize({ ...current, [key]: value }))
          adopt(await reloadConfig($, paths, { loaded: files, language, dialect, text, spoken, voice, languages, locales }))
          $.ui.invalidate('ui.render')
        },
        onCopyToProject:
          paths.project && !files.project
            ? async () => {
                await $.fs.write(paths.project ?? '', serialize(files.user ?? defaults()))
                adopt(await reloadConfig($, paths, { loaded: files, language, dialect, text, spoken, voice, languages, locales }))
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
          {gear($, kit, e.surface)}
        </Box>
      )
    }

    const lists = await draw($, kit, settings, e.props.bodyColumns, false, e.surface, onAction, text)

    return (
      <Box flexDirection="column" flexGrow={1} justifyContent="space-between">
        {lists ?? <Text dimColor>{text.nothing}</Text>}
        {gear($, kit, e.surface)}
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (settings.display === 'pane' && (isPaneShown || isPaneClosed))) {
      return next(e)
    }

    // The band has no settings view; the config offer's buttons still work there.
    const onAction = async (item: Item, kind: string) => {
      if (kind === 'open') {
        if (item.open) await openFile($, item.open)

        return
      }
      if (await ownAnswer($, item, kind, paths, locales)) {
        adopt(await reloadConfig($, paths, { loaded: files, language, dialect, text, spoken, voice, languages, locales }))
      }
    }

    return (await draw($, $.ui.resolve(e), settings, e.props.bodyColumns, true, e.surface, onAction, text)) ?? next(e)
  })
}
