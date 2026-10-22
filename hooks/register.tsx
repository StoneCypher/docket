import { atom, read, update } from 'claude-code'
import type { ConfigValue, Elements, EngineInterface, Register } from 'claude-code'

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
const updatedTurn = atom({ plugin: 'docket', key: 'updatedTurn' } as const, 0)
const isUnreconciled = atom({ plugin: 'docket', key: 'isUnreconciled' } as const, false)

type Fields = { text?: string; emoji?: string; lean?: string; stakes?: Stakes; rank?: number; options?: string[] }
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

  return out
}

const ITEM_FIELDS = {
  text: { type: 'string', description: 'The item, one to three lines' },
  emoji: { type: 'string', description: 'One emoji for the item' },
  lean: { type: 'string', description: 'Questions only: the answer you would pick' },
  stakes: { type: 'string', enum: STAKES, description: 'Omit for low stakes' },
  rank: { type: 'number', description: 'V, N, C, Q and R only: 1 is the most urgent' },
  options: {
    type: 'array',
    items: { type: 'string' },
    maxItems: 3,
    description: 'Questions only: one to three button labels, each a single letter or a single emoji, such as ["a", "b", "c"] or ["🌐", "📄"]. Each label must appear in the text beside what it picks. Their buttons replace the lean’s ✔ and ✗ and send "Q4 (b)."',
  },
}

const INPUT_SCHEMA = {
  type: 'object',
  properties: {
    add: {
      type: 'array',
      items: {
        type: 'object',
        properties: { list: { type: 'string', enum: LETTERS }, ...ITEM_FIELDS },
        required: ['list', 'text'],
      },
    },
    change: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string', description: 'A label such as Q12' }, ...ITEM_FIELDS },
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
}

const withoutAnswer = ({ answered: _, answeredAt: __, ...item }: Item): Item => item

const STAKES_GLYPH = { emergency: '[🚨emergency]', high: '❗', med: '🔶' }
const STAKES_TEXT = { emergency: '[emergency]', high: '[high stakes]', med: '[med stakes]' }
const STAKES_COLOR = { emergency: 'red', high: '#ff8800', med: 'yellow' }

// Whether the pane is on screen; the band stands in while it isn't.
let isPaneShown = false

// The docket's own pane, docked beside the transcript where the surface docks one.
const openPane = async ($: Dollar) => {
  const { isPlaced } = await $.ui.open({ id: PANE, title: 'Docket' })
  isPaneShown = isPlaced
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
) => {
  // An item's clear button: a trash can, apart from the ✗ beside it, but the terminal can't size 🗑️.
  const trash = surface === 'terminal' ? '✕' : '🗑️'

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
    for (const match of text.matchAll(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|https?:\/\/[^\s<>"')\]]+/g)) {
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
  const sections = order.map(list => ({
    list,
    ...arrange(all, list, settings.caps[list.letter] ?? 7, at, now, settings.lingerMs, isByPrompt, settings.answeredMs),
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
    await $.prompt.submit({ text, asUser: true })
  }

  // Whether a lean fits on one line beside its buttons: an estimate in cells, as no surface reports
  // rendered widths. The lean's margin and the two buttons side by side take about 9.
  const isOneLine = (text: string, reserve = 0) => text.length <= columns - 9 - reserve

  const accept = (verb: string, letter: Letter) => async () => {
    const ids = (await read($, items))
      .filter(item => item.list === letter && isOpen(item))
      .map(item => item.id)
    if (ids.length) {
      await markAnswered(ids, 'yes')
      await $.prompt.submit({ text: `${verb} ${ids.join(', ')}.`, asUser: true })
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
      <Text bold>{item.id}.</Text>
      {marker(item)}
      {stakesTag(item)} {linkify(item.text)}
      {item.addedTurn === at && !isLingering ? ' (new)' : ''}
    </Text>
  )

  // A ✔ and ✗ pair, side by side when the text beside them fits on one line, stacked when it wraps.
  // `reserve` is the cells other controls take on the same line.
  // Once answered, a plain mark of the answer sent stands in for the pair.
  const yesNo = (item: Item, yes: string, no: string, beside: string, reserve = 0) =>
    item.answered ? (
      <Box flexShrink={0} marginLeft={1}>
        <Text size="caption" dimColor>
          {item.answered === 'yes' ? '✔' : item.answered === 'no' ? '✗' : item.answered}
        </Text>
      </Box>
    ) : (
      <Box flexShrink={0} marginLeft={1} flexDirection={isOneLine(beside, reserve) ? 'row' : 'column'} columnGap={1}>
        <Button key={`ok-${item.id}`} plain dimColor onPress={answer(item.id, 'yes', yes)}>
          <Text size="caption" color="green">✔</Text>
        </Button>
        <Button key={`no-${item.id}`} plain dimColor onPress={answer(item.id, 'no', no)}>
          <Text size="caption">✗</Text>
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
          <Button key={`opt-${item.id}-${i}`} plain dimColor onPress={answer(item.id, option, `${item.id} (${option}).`)}>
            <Text size="caption">{option}</Text>
          </Button>
        ))}
      </Box>
    )

  const row = (item: Item, isLingering: boolean) => {
    const isDim = isLingering || item.answered !== undefined || item.changedTurn < at
    const { answers } = LISTS.find(list => list.letter === item.list) ?? {}
    const sayOf = answers && { yes: `${answers.yes} ${item.id}.`, no: `${answers.no} ${item.id}.` }

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
            {sayOf ? yesNo(item, sayOf.yes, sayOf.no, `${item.id}. ${item.text}`, 3) : null}
            {item.options && !item.lean ? choices(item, `${item.id}. ${item.text}`) : null}
            <Box flexShrink={0} marginLeft={1}>
              <Button key={`x-${item.id}`} plain dimColor onPress={dismiss(item.id)}>
                <Text size="caption">{trash}</Text>
              </Button>
            </Box>
          </Box>
        )}
        {item.lean && !isLingering ? (
          <Box marginLeft={3} flexDirection="row" flexWrap="nowrap" alignItems="flex-start">
            <Box flexShrink={1} minWidth={0}>
              {/* Explicit colors, not dimColor: a surface's dim overrides any color given beside it. */}
              <Text color={isDim ? settings.leanDimColor : settings.leanColor} italic>
                <Text bold>Lean</Text>: {linkify(item.lean)}
              </Text>
            </Box>
            {item.options
              ? choices(item, `Lean: ${item.lean}`)
              : yesNo(item, `Accept the lean on ${item.id}.`, `No to the lean on ${item.id}.`, `Lean: ${item.lean}`)}
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
              <Text bold>{item.id}</Text>
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
              {list.name}
            </Text>
            {counter(hidden, (counts[list.letter] ?? 0) - (base[list.letter] ?? 0))}
            {shown.length ? (
              // About 2em past the heading and 1em between buttons: a cell is near 0.6em.
              <Box flexDirection="row" marginLeft={3} columnGap={2}>
                {list.bulk ? (
                  <Button key={`bulk-${list.letter}`} label={list.bulk.label} onPress={accept(list.bulk.verb, list.letter)} />
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
const gear = ($: Dollar, { Box, Button, Text }: Kit, surface: string) => (
  <Box flexDirection="row" justifyContent="flex-end" marginTop={1}>
    <Button key="gear" plain dimColor onPress={() => update($, isSettings, isOn => !isOn)}>
      <Text size="caption">{surface === 'terminal' ? '⚙' : '⚙️'}</Text>
    </Button>
  </Box>
)

// The docket's own config rows, edited in place. A change reloads the mod with the new values.
const drawSettings = async ($: Dollar, { Box, Button, Text, Input, Select }: FieldKit) => {
  const rows = (await $.config.list()).filter(row => row.key.startsWith('docket.'))
  const save = (key: string, value: ConfigValue) => $.config.set({ key, value })

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" marginBottom={1}>
        <Text bold>settings</Text>
        <Box marginLeft={3}>
          <Button key="done" label="done" onPress={() => update($, isSettings, () => false)} />
        </Box>
      </Box>
      {rows.map(row => {
        const field = row.key.slice('docket.'.length)
        const control =
          row.kind === 'boolean' ? (
            <Select
              key={field}
              value={row.value ? 'on' : 'off'}
              options={[{ value: 'on' }, { value: 'off' }]}
              onSelect={value => save(row.key, value === 'on')}
            />
          ) : row.kind === 'choice' && row.options ? (
            <Select
              key={field}
              value={String(row.value)}
              options={row.options.map(value => ({ value }))}
              onSelect={value => save(row.key, value)}
            />
          ) : (
            <Input
              key={field}
              value={String(row.value)}
              submitLabel="save"
              onSubmit={value => save(row.key, row.kind === 'number' ? Number(value) : value)}
            />
          )

        return (
          <Box key={`row-${field}`} flexDirection="column" marginBottom={1}>
            <Text bold={!row.isLocked} dimColor={row.isLocked}>
              {row.label}
              {row.isLocked ? ' (locked by policy)' : ''}
            </Text>
            {row.description ? (
              <Text dimColor size="footnote">
                {row.description}
              </Text>
            ) : null}
            {row.isLocked ? <Text>{String(row.value)}</Text> : control}
          </Box>
        )
      })}
    </Box>
  )
}

export const register: Register = (on, options) => {
  const settings = settingsOf(options)
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'docket', description: 'Open the docket pane' })
    if (settings.display === 'pane') {
      void openPane($)
    }
    await $.tool.register({
      name: 'update',
      description:
        'Add, change and close items on the docket, the numbered lists the user reads above the prompt. Send every change of a turn in one call. Labels are assigned here and returned. Use change only to correct the same item; a new or follow-up question is a close plus an add, so it gets a new number.',
      inputSchema: INPUT_SCHEMA,
      isDeferred: false,
    })

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
        if (!LETTERS.includes(spec.list) || typeof spec.text !== 'string') {
          continue
        }
        const n = (next[spec.list] ?? 0) + 1
        next[spec.list] = n
        added.push({
          ...fieldsOf(spec),
          id: `${spec.list}${n}`,
          list: spec.list,
          n,
          text: spec.text,
          addedTurn: at,
          changedTurn: at,
        })
      }

      return next
    })

    const changes = new Map((input.change ?? []).map(spec => [spec.id.toUpperCase(), fieldsOf(spec)]))
    const closes = new Map((input.close ?? []).map(spec => [spec.id.toUpperCase(), spec.unasked === true]))
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

    const unknown = [...changes.keys(), ...closes.keys()].filter(id => !known.has(id))
    const report = [
      added.length && `Added ${added.map(item => item.id).join(', ')}.`,
      changes.size && `Changed ${[...changes.keys()].filter(id => known.has(id)).join(', ') || 'nothing'}.`,
      closes.size && `Closed ${[...closes.keys()].filter(id => known.has(id)).join(', ') || 'nothing'}.`,
      unknown.length && `No such items: ${unknown.join(', ')}.`,
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
        { id: 'docket', text: instructions(settings, e.surfaces.length === 0), scope: 'session' },
      ],
    }
  })

  // Each prompt starts a turn: the deltas count from here, and the model gets the docket.
  on('prompt.submit', async ($, e, next) => {
    if (e.isMeta) {
      return next(e)
    }

    await update($, turn, n => n + 1)
    const all = await read($, items)
    await update($, baseline, () => openCounts(all))
    const gone = await read($, dismissed)
    await update($, dismissed, () => [])

    const context = [snapshot(all, gone)]
    if (await read($, isUnreconciled)) {
      context.push(RECONCILE)
      await update($, isUnreconciled, () => false)
    }
    const named = references(e.text, all)
    if (named) {
      context.push(named)
    }

    return next({ ...e, context: [...(e.context ?? []), ...context] })
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) {
      isPaneShown = false
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

    if (await read($, isSettings)) {
      // The phone draws no fields yet.
      const body =
        e.surface === 'mobile' ? (
          <Text dimColor>Settings need the terminal, desktop or VS Code.</Text>
        ) : (
          await drawSettings($, $.ui.resolve(e))
        )

      return (
        <Box flexDirection="column" flexGrow={1} justifyContent="space-between">
          {body}
          {gear($, kit, e.surface)}
        </Box>
      )
    }

    const lists = await draw($, kit, settings, e.props.bodyColumns, false, e.surface)

    return (
      <Box flexDirection="column" flexGrow={1} justifyContent="space-between">
        {lists ?? <Text dimColor>Nothing on the docket.</Text>}
        {gear($, kit, e.surface)}
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (settings.display === 'pane' && isPaneShown)) {
      return next(e)
    }

    return (await draw($, $.ui.resolve(e), settings, e.props.bodyColumns, true, e.surface)) ?? next(e)
  })
}
