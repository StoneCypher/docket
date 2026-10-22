import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'docket',
  component: 'Pane',
  requestId: 'docket',
  props: {
    title: 'Docket',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

// Nothing sits beneath the plugin under test: these hooks stand for the engine.
const standIns = (on: Parameters<Parameters<typeof test>[1]>[1]) => {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.register', () => ({ value: undefined }))
  on('clock.now', () => ({ value: 1_000 }))
  on('command.register', () => ({ value: { command: 'docket' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('config.list', () => ({
    value: [
      { key: 'docket.display', label: 'Display', kind: 'choice', value: 'pane', options: ['pane', 'band'], provider: { plugin: 'docket', tier: 'user' }, isLocked: false },
      { key: 'docket.leanColor', label: 'Lean color', kind: 'text', value: '#b1b1b1', provider: { plugin: 'docket', tier: 'user' }, isLocked: false },
    ],
  }))
}

test('an added question shows in the pane, on every surface', async ($, on) => {
  standIns(on)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ran = await $.tool.call({
    tool: 'mcp__docket__update',
    add: [{ list: 'Q', text: 'Ship it on Friday?', lean: 'yes, after the tests pass', emoji: '🚀' }],
  })
  expect(JSON.stringify(ran)).toContain('Added Q1')

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /Ship it on Friday/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /after the tests pass/ })).toBeDefined()
    await ui.unmount()
  }
})

test('a reply naming an item carries that item to the model', async ($, on) => {
  let context: readonly string[] = []
  standIns(on)
  on('prompt.submit', (_, e) => {
    context = e.context ?? []

    return { text: e.text }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({
    tool: 'mcp__docket__update',
    add: [
      { list: 'C', text: 'Delete the old branch?' },
      { list: 'C', text: 'Rename the repo?' },
    ],
  })
  await $.prompt.submit({ text: 'c1-c2 confirmed' })

  const all = context.join('\n')
  expect(all).toContain('C1 Delete the old branch?')
  expect(all).toContain('named in this prompt')
})

test("a heading's ✕ dismisses that whole list and leaves the others", async ($, on) => {
  standIns(on)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({
    tool: 'mcp__docket__update',
    add: [
      { list: 'Q', text: 'First question?' },
      { list: 'Q', text: 'Second question?' },
      { list: 'P', text: 'Keep this pinned' },
    ],
  })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'x-Q' })
  expect(await ui.find({ type: 'Text', text: /First question/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Keep this pinned/ })).toBeDefined()
  await ui.unmount()
})

test("a lean's ✔ answers that one lean, and the pair goes at once", async ($, on) => {
  const submitted: string[] = []
  standIns(on)
  on('prompt.submit', (_, e) => {
    submitted.push(e.text)

    return { text: e.text }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({
    tool: 'mcp__docket__update',
    add: [{ list: 'Q', text: 'Ship it?', lean: 'yes' }],
  })

  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  await ui.press({ key: 'ok-Q1' })
  expect(submitted).toContain('Accept the lean on Q1.')
  expect(await ui.find({ key: 'no-Q1' })).toBeUndefined()
  // Sent: the question's own text is struck through.
  const struck = (await ui.findAll({ type: 'Text' })).find(found => /Ship it\?/.test(found.text) && found.props.strikethrough === true)
  expect(struck).toBeDefined()
  await ui.unmount()
})

test('the pane puts the most important list first, and the most urgent item first in it', async ($, on) => {
  standIns(on)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({
    tool: 'mcp__docket__update',
    add: [
      { list: 'P', text: 'Pinned thing' },
      { list: 'Q', text: 'Minor question?', rank: 2 },
      { list: 'Q', text: 'Urgent question?', rank: 1 },
    ],
  })

  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  const texts = (await ui.findAll({ type: 'Text' })).map(found => found.text ?? '')
  const at = (pattern: RegExp) => texts.findIndex(text => pattern.test(text))
  expect(at(/^questions/)).toBeLessThan(at(/^pinned/))
  expect(at(/Urgent question/)).toBeLessThan(at(/Minor question/))
  await ui.unmount()
})

test("a request's ✔ and ✗ approve or decline it", async ($, on) => {
  const submitted: string[] = []
  standIns(on)
  on('prompt.submit', (_, e) => {
    submitted.push(e.text)

    return { text: e.text }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'mcp__docket__update', add: [{ list: 'R', text: 'Refactor the parser?' }] })

  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  await ui.press({ key: 'ok-R1' })
  expect(submitted).toEqual(['Approved R1.'])
  // Answered: the pair is gone at once, so it can't be pressed twice.
  expect(await ui.find({ key: 'ok-R1' })).toBeUndefined()
  expect(await ui.find({ key: 'no-R1' })).toBeUndefined()
  await ui.unmount()

  // Claude changing the item hands the buttons back.
  await $.tool.call({ tool: 'mcp__docket__update', change: [{ id: 'R1', text: 'Refactor the parser, without the lexer?' }] })
  const again = await $.ui.mount({ ...PANE, surface: 'vscode' })
  await again.press({ key: 'no-R1' })
  expect(submitted).toEqual(['Approved R1.', 'Declined R1.'])
  await again.unmount()
})

test("an item's ✕ dismisses just that item", async ($, on) => {
  standIns(on)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({
    tool: 'mcp__docket__update',
    add: [
      { list: 'U', text: 'Building the parser' },
      { list: 'U', text: 'Writing the docs' },
    ],
  })

  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  await ui.press({ key: 'x-U1' })
  expect(await ui.find({ type: 'Text', text: /Building the parser/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Writing the docs/ })).toBeDefined()
  await ui.unmount()
})

test("a confirm item's ✔ and ✗ confirm or reject it", async ($, on) => {
  const submitted: string[] = []
  standIns(on)
  on('prompt.submit', (_, e) => {
    submitted.push(e.text)

    return { text: e.text }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({
    tool: 'mcp__docket__update',
    add: [
      { list: 'C', text: 'Delete the old branch?' },
      { list: 'C', text: 'Rename the repo?' },
    ],
  })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'ok-C1' })
  await ui.press({ key: 'no-C2' })
  expect(submitted).toEqual(['Confirmed C1.', 'Not confirmed C2.'])
  await ui.unmount()
})

test('the ⚙ opens the settings view, and a field saves to the config', async ($, on) => {
  const saved: unknown[] = []
  standIns(on)
  on('config.set', (_, e) => {
    saved.push([e.key, e.value])

    return { value: e.value }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  await ui.press({ key: 'gear' })
  expect(await ui.find({ type: 'Text', text: /Lean color/ })).toBeDefined()
  await ui.input({ key: 'leanColor', text: '#aaaaaa' })
  expect(saved).toEqual([['docket.leanColor', '#aaaaaa']])
  await ui.press({ key: 'done' })
  expect(await ui.find({ type: 'Text', text: /Nothing on the docket/ })).toBeDefined()
  await ui.unmount()
})

test('a reply that speaks of pending work without touching the docket gets a reminder next prompt', async ($, on) => {
  let context: readonly string[] = []
  standIns(on)
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('prompt.submit', (_, e) => {
    context = e.context ?? []

    return { text: e.text }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: 'what is left?' })
  await $.turn.complete({ answer: 'Next up is the README, later the repo.', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await $.prompt.submit({ text: 'ok' })
  expect(context.join('\n')).toContain('did not change that turn')

  // A turn that does update the docket is left alone.
  await $.tool.call({ tool: 'mcp__docket__update', add: [{ list: 'P', text: 'README' }] })
  await $.turn.complete({ answer: 'Next up is the README.', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer' })
  await $.prompt.submit({ text: 'ok again' })
  expect(context.join('\n')).not.toContain('did not change that turn')
})

test('an answered item stays up dimmed, then leaves after 20 seconds', async ($, on) => {
  let now = 1_000
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.register', () => ({ value: undefined }))
  on('clock.now', () => ({ value: now }))
  on('clock.after', () => ({ value: undefined }))
  on('command.register', () => ({ value: { command: 'docket' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('prompt.submit', (_, e) => ({ text: e.text }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'mcp__docket__update', add: [{ list: 'Q', text: 'Ship it?', lean: 'yes' }] })

  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  await ui.press({ key: 'ok-Q1' })
  await ui.unmount()

  now += 19_000
  const soon = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await soon.find({ type: 'Text', text: /Ship it/ })).toBeDefined()
  await soon.unmount()

  now += 2_000
  const later = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await later.find({ type: 'Text', text: /Ship it/ })).toBeUndefined()
  await later.unmount()
})

test('queued sits right below underway in the pane', async ($, on) => {
  standIns(on)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({
    tool: 'mcp__docket__update',
    add: [
      { list: 'W', text: 'Waiting on CI' },
      { list: 'L', text: 'Build the todos next' },
      { list: 'U', text: 'Building the settings view' },
    ],
  })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const texts = (await ui.findAll({ type: 'Text' })).map(found => found.text ?? '')
  const at = (pattern: RegExp) => texts.findIndex(text => pattern.test(text))
  expect(at(/^underway/)).toBeLessThan(at(/^queued/))
  expect(at(/^queued/)).toBeLessThan(at(/^waiting/))
  await ui.unmount()
})

test("a question's option buttons replace ✔ and ✗, and send the pick", async ($, on) => {
  const submitted: string[] = []
  standIns(on)
  on('prompt.submit', (_, e) => {
    submitted.push(e.text)

    return { text: e.text }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({
    tool: 'mcp__docket__update',
    add: [{ list: 'Q', text: 'Which direction: (a) docket, (b) instrument, (c) your call?', lean: '(a)', options: ['a', 'b', 'c', 'd'] }, { list: 'Q', text: 'Docs: (🌐) site or (📄) README?', options: ['🌐', 'too long', '📄'] }],
  })

  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await ui.find({ key: 'ok-Q1' })).toBeUndefined()
  expect(await ui.find({ key: 'opt-Q1-3' })).toBeUndefined()
  await ui.press({ key: 'opt-Q1-1' })
  expect(submitted).toEqual(['Q1 (b).'])
  expect(await ui.find({ key: 'opt-Q1-0' })).toBeUndefined()
  // Emoji labels work, and a label that is neither one letter nor one emoji is dropped.
  await ui.press({ key: 'opt-Q2-1' })
  expect(submitted).toEqual(['Q1 (b).', 'Q2 (📄).'])
  await ui.unmount()
})

test('a web address in an item is drawn as a link, without its trailing punctuation', async ($, on) => {
  standIns(on)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({
    tool: 'mcp__docket__update',
    add: [
      { list: 'V', text: 'Look over the site at http://localhost:4321/docket.' },
      { list: 'L', text: 'Then: the [StoneCypher/claude-plugins](https://github.com/StoneCypher/claude-plugins) index repo.' },
    ],
  })

  for (const surface of ['terminal', 'vscode'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const link = await ui.find({ type: 'Link' })
    expect(JSON.stringify(link)).toContain('http://localhost:4321/docket')
    expect(JSON.stringify(link)).not.toContain('docket.')
    // A [label](url) link shows its label, not the brackets or the address.
    const labeled = (await ui.findAll({ type: 'Link' })).map(found => JSON.stringify(found)).join(' ')
    expect(labeled).toContain('https://github.com/StoneCypher/claude-plugins')
    expect(await ui.find({ type: 'Text', text: /\]\(https/ })).toBeUndefined()
    await ui.unmount()
  }
})
