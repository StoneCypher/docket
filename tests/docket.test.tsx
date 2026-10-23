import { expect, test } from 'claude-code/testing'

import { CONFIG_VERSION, defaults, serialize } from '../hooks/config'
import { STRINGS_VERSION } from '../hooks/i18n'
import { groupsOf } from '../hooks/picker'

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

// Nothing sits beneath the plugin under test: these hooks stand for the engine, with an in-memory
// file system, environment and store.
const USER_CONFIG = '/home/tester/.claude/docket/config.json'
const files = new Map<string, string>()
const store = new Map<string, unknown>()
// The environment beyond HOME, for a test to set.
const env = new Map<string, string>()
// The time, for a test to move on.
const clock = { now: 1_000 }
// Folders a test fills, beyond the plugin's own locales: an editor's install, say.
const folders = new Map<string, string[]>()
// What the mod put on the clipboard, and the titles it opened its pane with.
const copied: string[] = []
const titles: string[] = []
// The engine hands fs calls absolute native paths (C:\\home\\...): key files by the plain form.
const plain = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')


// Text as the pane shows it: in a Text, or, off the terminal, in an item's Markdown line.
type Found = { props: Record<string, unknown> }
type Mounted = { find: (query: never) => Promise<Found | undefined>; findAll: (query: never) => Promise<readonly Found[]> }
const findText = async (ui: Mounted, text: RegExp) =>
  ((await ui.find({ type: 'Text', text } as never)) as Found | undefined) ??
  ((await ui.findAll({ type: 'Markdown' } as never)) as readonly Found[]).find(found => text.test(String(found.props.text)))

// `locales` stands for the plugin's own language files, wherever the engine puts the plugin.
const standIns = (on: Parameters<Parameters<typeof test>[1]>[1], locales: Record<string, unknown> = {}) => {
  files.clear()
  store.clear()
  env.clear()
  folders.clear()
  copied.length = 0
  titles.length = 0
  clock.now = 1_000
  // A complete config by default, so the offer to create one only shows where a test removes it.
  files.set(USER_CONFIG, serialize(defaults()))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.register', () => ({ value: undefined }))
  on('clock.now', () => ({ value: clock.now }))
  on('clock.after', () => ({ value: undefined }))
  on('command.register', () => ({ value: { command: 'docket' } }))
  on('ui.open', (_, e) => {
    titles.push(String((e as { title?: string }).title))

    return { value: { isPlaced: true } }
  })
  on('ui.copy', (_, e) => {
    copied.push(String((e as { text: string }).text))

    return { value: { isCopied: true } }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('env.get', (_, e) => {
    const { name } = e as { name: string }

    return { value: name === 'HOME' ? '/home/tester' : env.get(name) }
  })
  on('fs.exists', (_, e) => ({ value: files.has(plain((e as { path: string }).path)) }))
  on('fs.list', (_, e) => {
    const listed = folders.get(plain((e as { path: string }).path))
    if (listed) return { value: listed.map(name => ({ name, kind: 'file', size: 1, mtimeMs: 0, isLink: false })) }
    const folder = /\/(dialects|voices)$/.exec(plain((e as { path: string }).path))?.[1]
    const names = Object.keys(locales)
      .filter(key => (folder ? key.startsWith(`${folder}/`) : !key.includes('/')))
      .map(key => key.replace(/^(dialects|voices)\//, ''))
      .map(name => (/\.\w+$/.test(name) ? name : `${name}.json`))

    return { value: names.map(name => ({ name, kind: 'file', size: 1, mtimeMs: 0, isLink: false })) }
  })
  on('fs.read', (_, e) => {
    const path = plain((e as { path: string }).path)
    if (path.endsWith('/.claude-plugin/plugin.json')) return { value: JSON.stringify({ name: 'docket', version: '9.9.9' }) }
    const picture = /\/locales\/((?:dialects|voices)\/[\w.-]+\.svg)$/.exec(path)?.[1]
    if (picture && typeof locales[picture] === 'string') return { value: locales[picture] }
    const locale = /\/locales\/((?:dialects\/|voices\/)?[\w-]+)\.json$/.exec(path)?.[1]

    return { value: locale && locales[locale] ? JSON.stringify(locales[locale]) : (files.get(path) ?? '') }
  })
  on('fs.write', (_, e) => {
    const { path, text } = e as { path: string; text: string }
    files.set(plain(path), text)

    return { value: undefined }
  })
  on('store.get', (_, e) => ({ value: store.get((e as { key: string }).key) }))
  on('store.set', (_, e) => {
    const { key, value } = e as { key: string; value: unknown }
    store.set(key, value)

    return { value: undefined }
  })
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
    expect(await findText(ui, /Ship it on Friday/)).toBeDefined()
    expect(await findText(ui, /after the tests pass/)).toBeDefined()
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
  expect(await findText(ui, /First question/)).toBeUndefined()
  expect(await findText(ui, /Keep this pinned/)).toBeDefined()
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
  // Sent: the question's own text is struck through, as Markdown off the terminal.
  const struck = (await ui.findAll({ type: 'Markdown' })).find(found => /^~~.*Ship it\?.*~~$/.test(String(found.props.text)))
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

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const texts = (await ui.findAll({ type: 'Text' })).map(found => found.text ?? '')
  const at = (pattern: RegExp) => texts.findIndex(text => pattern.test(text))
  expect(at(/^Questions/)).toBeLessThan(at(/^Pinned/))
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
  // And the 🗑️ goes too: a sent row leaves on its own.
  expect(await ui.find({ key: 'x-R1' })).toBeUndefined()
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
  expect(await findText(ui, /Building the parser/)).toBeUndefined()
  expect(await findText(ui, /Writing the docs/)).toBeDefined()
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

test('the ⚙ opens the settings view, and a field saves to the config file', async ($, on) => {
  standIns(on)
  files.set(USER_CONFIG, JSON.stringify({ version: 1, leanColor: '#b1b1b1' }))

  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  await ui.press({ key: 'gear' })
  expect(await findText(ui, /Lean color/)).toBeDefined()
  // Which docket this is, above the copy button.
  expect(await findText(ui, /^Docket 📋 version 9\.9\.9, built [A-Z][a-z]{2} \d{1,2} \d{4}$/)).toBeDefined()
  await ui.input({ key: 'leanColor', text: '#aaaaaa' })
  expect(JSON.parse(files.get(USER_CONFIG) ?? '{}').leanColor).toBe('#aaaaaa')
  await ui.press({ key: 'done' })
  await ui.unmount()
})

test("with no config, the pane offers one, and its ✔ writes every key at its default", async ($, on) => {
  const submitted: string[] = []
  standIns(on)
  on('prompt.submit', (_, e) => {
    submitted.push(e.text)

    return { text: e.text }
  })

  files.delete(USER_CONFIG)

  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await findText(ui, /Create docket's config/)).toBeDefined()
  await ui.press({ key: 'ok-R1' })
  await ui.unmount()

  const written = JSON.parse(files.get(USER_CONFIG) ?? '{}')
  expect(written.version).toBe(CONFIG_VERSION)
  expect(written.leanColor).toBe('#b1b1b1')
  expect(written.laterCap).toBe(7)
  // The offer is the mod's own: answering it sends nothing to Claude.
  expect(submitted).toEqual([])

  const after = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await findText(after, /Look at your new config/)).toBeDefined()
  await after.unmount()
})

test('an old config is migrated in place, and View says so', async ($, on) => {
  standIns(on)
  files.set(USER_CONFIG, JSON.stringify({ leanColor: '#123456' }))

  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const migrated = JSON.parse(files.get(USER_CONFIG) ?? '{}')
  expect(migrated.version).toBe(CONFIG_VERSION)
  expect(migrated.leanColor).toBe('#123456')
  expect(migrated.questionsCap).toBe(7)

  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await findText(ui, /updated its config/)).toBeDefined()
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
  expect(await findText(soon, /Ship it/)).toBeDefined()
  await soon.unmount()

  now += 2_000
  const later = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await findText(later, /Ship it/)).toBeUndefined()
  await later.unmount()
})

test('Later sits right below Underway in the pane', async ($, on) => {
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
  expect(at(/^Underway/)).toBeLessThan(at(/^Later/))
  expect(at(/^Later/)).toBeLessThan(at(/^Waiting/))
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

  // The terminal draws its own Link elements.
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const link = await ui.find({ type: 'Link' })
  expect(JSON.stringify(link)).toContain('http://localhost:4321/docket')
  expect(JSON.stringify(link)).not.toContain('docket.')
  // A [label](url) link shows its label, not the brackets or the address.
  const labeled = (await ui.findAll({ type: 'Link' })).map(found => JSON.stringify(found)).join(' ')
  expect(labeled).toContain('https://github.com/StoneCypher/claude-plugins')
  expect(await findText(ui, /\]\(https/)).toBeUndefined()
  await ui.unmount()

  // Elsewhere the line is Markdown: a bare address becomes a link, its full stop left as text.
  const md = await $.ui.mount({ ...PANE, surface: 'vscode' })
  const lines = (await md.findAll({ type: 'Markdown' })).map(found => String(found.props.text)).join('\n')
  expect(lines).toContain('[http://localhost:4321/docket](http://localhost:4321/docket).')
  expect(lines).toContain('[StoneCypher/claude-plugins](https://github.com/StoneCypher/claude-plugins)')
  await md.unmount()
})

test("a growing list's counter draws its arrow and number in greens", async ($, on) => {
  standIns(on)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'mcp__docket__update', add: [{ list: 'Q', text: 'One?' }, { list: 'Q', text: 'Two?' }] })

  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  const texts = await ui.findAll({ type: 'Text' })
  expect(texts.find(found => found.text === '↑' && found.props.color === '#5fb878')).toBeDefined()
  expect(texts.find(found => found.text === '2' && found.props.color === '#7c9a84')).toBeDefined()
  await ui.unmount()
})

test('a bulk button shows only when more than one item can take it', async ($, on) => {
  standIns(on)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'mcp__docket__update', add: [{ list: 'Q', text: 'One?', lean: 'yes' }, { list: 'Q', text: 'No lean here?' }] })

  clock.now += 10_000
  const one = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await one.find({ key: 'bulk-Q' })).toBeUndefined()
  await one.unmount()

  await $.tool.call({ tool: 'mcp__docket__update', add: [{ list: 'Q', text: 'Two?', lean: 'no' }] })
  // Just added: not counted for a few seconds, so there's still only one to answer.
  const fresh = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await fresh.find({ key: 'bulk-Q' })).toBeUndefined()
  await fresh.unmount()

  clock.now += 10_000
  const two = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect((await two.find({ key: 'bulk-Q' }))?.props.label).toBe('Accept all leans (2)')
  await two.unmount()
})

test('the pane links to docket\'s repository beside the ⚙', async ($, on) => {
  standIns(on)

  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  for (const surface of ['vscode', 'desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const links = (await ui.findAll({ type: 'Link' })).map(found => JSON.stringify(found))
    expect(links.some(link => link.includes('https://github.com/StoneCypher/docket'))).toBe(true)
    expect(await ui.find({ key: 'gear' })).toBeDefined()
    await ui.unmount()
  }
})

test("an item about a file gets an Open button that opens it", async ($, on) => {
  const runs: string[][] = []
  standIns(on)
  on('process.run', (_, e) => {
    runs.push([...(e as { argv: readonly string[] }).argv])

    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })

  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'mcp__docket__update', add: [{ list: 'V', text: 'Look at the config.', open: '/home/tester/.claude/docket/config.json' }] })

  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  await ui.press({ key: 'open-V1' })
  expect(runs.length).toBe(1)
  expect(runs[0]).toContain('/home/tester/.claude/docket/config.json')
  // Opening a file isn't an answer: the row stays as it was.
  expect(await ui.find({ key: 'open-V1' })).toBeDefined()
  await ui.unmount()
})

test('a bulk button answers only the items on screen, not the ones past the cap', async ($, on) => {
  const submitted: string[] = []
  standIns(on)
  files.set(USER_CONFIG, serialize({ ...defaults(), questionsCap: 2 }))
  on('prompt.submit', (_, e) => {
    submitted.push(e.text)

    return { text: e.text }
  })

  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await $.tool.call({
    tool: 'mcp__docket__update',
    add: [
      { list: 'Q', text: 'One?', lean: 'yes', rank: 1 },
      { list: 'Q', text: 'Two?', lean: 'yes', rank: 2 },
      { list: 'Q', text: 'Three?', lean: 'yes', rank: 3 },
    ],
  })
  // Items added this turn always show; a new prompt starts a turn, so the cap applies.
  await $.prompt.submit({ text: 'next' })
  submitted.length = 0
  clock.now += 10_000

  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  await ui.press({ key: 'bulk-Q' })
  expect(submitted).toEqual(['Accept the leans on Q1, Q2.'])
  await ui.unmount()
})

test("a Later item's 🏗️ asks for it to start now", async ($, on) => {
  const submitted: string[] = []
  standIns(on)
  on('prompt.submit', (_, e) => {
    submitted.push(e.text)

    return { text: e.text }
  })

  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'mcp__docket__update', add: [{ list: 'L', text: 'Build the index repo' }] })

  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  await ui.press({ key: 'go-L1' })
  expect(submitted).toEqual(['Start L1 now.'])
  // Sent: the button gives way, so it can't be pressed twice.
  expect(await ui.find({ key: 'go-L1' })).toBeUndefined()
  await ui.unmount()
})

test('"+N more" expands its list, and "fewer" folds it back', async ($, on) => {
  standIns(on)
  on('prompt.submit', (_, e) => ({ text: e.text }))
  files.set(USER_CONFIG, serialize({ ...defaults(), questionsCap: 2 }))

  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await $.tool.call({
    tool: 'mcp__docket__update',
    add: [
      { list: 'Q', text: 'One?', rank: 1 },
      { list: 'Q', text: 'Two?', rank: 2 },
      { list: 'Q', text: 'Three?', rank: 3 },
    ],
  })
  await $.prompt.submit({ text: 'next' })

  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await findText(ui, /Three\?/)).toBeUndefined()
  await ui.press({ key: 'more-Q' })
  expect(await findText(ui, /Three\?/)).toBeDefined()
  await ui.press({ key: 'fewer-Q' })
  expect(await findText(ui, /Three\?/)).toBeUndefined()
  await ui.unmount()
})

test('in Spanish, the pane, the tool and the buttons all use Spanish names and letters', async ($, on) => {
  const submitted: string[] = []
  // What the Spanish file leaves out stays English.
  standIns(on, {
    es: {
      ready: 'ai translated',
      version: 1,
      Questions: { text: 'Preguntas', ready: 'ai translated' },
      Pinned: { text: 'Fijado', ready: 'ai translated' },
      Lean: { text: 'Propuesta', ready: 'ai translated' },
      'Accept the lean on {id}.': { text: 'Acepto la propuesta de {id}.', ready: 'ai translated' },
    },
  })
  on('prompt.submit', (_, e) => {
    submitted.push(e.text)

    return { text: e.text }
  })
  files.set(USER_CONFIG, serialize({ ...defaults(), language: 'es' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  // P is Preguntas, questions, in Spanish; F is Fijado, pinned.
  const ran = await $.tool.call({
    tool: 'mcp__docket__update',
    add: [
      { list: 'P', text: '¿Publicamos el viernes?', lean: 'sí, tras las pruebas' },
      { list: 'F', text: 'Revisar el logo' },
    ],
  })
  expect(JSON.stringify(ran)).toContain('Added P1, F1')

  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await findText(ui, /^Preguntas$/)).toBeDefined()
  expect(await findText(ui, /^Propuesta$/)).toBeDefined()
  await ui.press({ key: 'ok-Q1' })
  await ui.unmount()
  expect(submitted).toEqual(['Acepto la propuesta de P1.'])

  const closed = await $.tool.call({ tool: 'mcp__docket__update', close: [{ id: 'p1' }, { id: 'Q9' }] })
  expect(JSON.stringify(closed)).toContain('Closed P1.')
  expect(JSON.stringify(closed)).toContain('No such items: Q9.')
  expect(JSON.stringify(closed)).toContain("The docket's letters are now")
  expect(JSON.stringify(closed)).toContain('P Preguntas')

  // An add with a letter no Spanish list has is reported, not dropped in silence.
  const stray = await $.tool.call({ tool: 'mcp__docket__update', add: [{ list: 'Q', text: 'Una pregunta' }] })
  expect(JSON.stringify(stray)).toContain('Not added, as no list has the letter: Q.')
  expect(JSON.stringify(stray)).toContain('P Preguntas')
})

test('a language docket has no file for gets English, and one offer to help translate it', async ($, on) => {
  const ran: string[][] = []
  standIns(on, { fr: { ready: false, version: 0 } })
  on('process.run', (_, e) => {
    ran.push([...(e as { argv: string[] }).argv])

    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  files.set(USER_CONFIG, serialize({ ...defaults(), language: 'fr' }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await findText(ui, /^Requests$/)).toBeDefined()
  const offer = (await ui.findAll({ type: 'Markdown' })).map(found => String(found.props.text)).join('\n')
  expect(offer).toContain('(https://github.com/StoneCypher/docket/edit/main/locales/fr.json)')
  await ui.press({ key: 'ok-R1' })
  await ui.unmount()
  expect(ran.some(argv => argv.includes('https://github.com/StoneCypher/docket/edit/main/locales/fr.json'))).toBe(true)
  expect(store.get('translateAsked')).toEqual(['fr'])

  // Asked once: a new session doesn't ask again.
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const again = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await findText(again, /speak French/)).toBeUndefined()
  await again.unmount()
})

test('a machine-translated language is used, with one offer, in that language, to make it read naturally', async ($, on) => {
  standIns(on, {
    de: {
      ready: 'ai translated',
      version: STRINGS_VERSION,
      Requests: { text: 'Anfragen', ready: 'ai translated' },
      "docket's {language} was machine-translated. Help make it read naturally? ✔ opens [its file]({link}) in GitHub's editor: fix any string, set its \"ready\" to true, and save to propose it.":
        { text: 'Das {language} von docket wurde maschinell übersetzt. [Datei]({link})', ready: 'ai translated' },
    },
  })
  files.set(USER_CONFIG, serialize({ ...defaults(), language: 'de' }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await findText(ui, /^Anfragen$/)).toBeDefined()
  expect(await findText(ui, /Das Deutsch von docket wurde maschinell/)).toBeDefined()
  await ui.press({ key: 'no-R1' })
  await ui.unmount()
  expect(store.get('translateAsked')).toEqual([`de:machine@${STRINGS_VERSION}`])
})

test('a dialect set by hand in the config lays its words over the language', async ($, on) => {
  const submitted: string[] = []
  standIns(on, {
    'dialects/yinzer': {
      name: 'Pittsburgh English (Yinzer)',
      ready: 'ai translated',
      version: 1,
      // Every list renamed: one left English could share a letter, and then every list keeps English's.
      Requests: { text: 'Can I', ready: 'ai translated' },
      Questions: { text: 'Whaddaya think', ready: 'ai translated' },
      Confirm: { text: 'Yinz sure?', ready: 'ai translated' },
      'Needs you': { text: 'Needs yinz', ready: 'ai translated' },
      View: { text: 'Lookit', ready: 'ai translated' },
      Underway: { text: 'On it', ready: 'ai translated' },
      Later: { text: 'Dahn the road', ready: 'ai translated' },
      Waiting: { text: 'Stuck in the tunnel', ready: 'ai translated' },
      Pinned: { text: 'Redd up later', ready: 'ai translated' },
      Lean: { text: 'Gut call', ready: 'ai translated' },
      'Accept the lean on {id}.': { text: 'Yeah, go wit your gut on {id}.', ready: 'ai translated' },
    },
  })
  on('prompt.submit', (_, e) => {
    submitted.push(e.text)

    return { text: e.text }
  })
  files.set(USER_CONFIG, JSON.stringify({ ...defaults(), dialect: 'yinzer' }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'mcp__docket__update', add: [{ list: 'W', text: 'Pierogies or haluski?', lean: 'pierogies' }] })
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await findText(ui, /^Whaddaya think$/)).toBeDefined()
  expect(await findText(ui, /^Gut call$/)).toBeDefined()
  await ui.press({ key: 'ok-Q1' })
  await ui.unmount()
  expect(submitted).toEqual(['Yeah, go wit your gut on W1.'])
})

test("a dialect's picture marks a sent answer where the surface draws SVG; its text stands in elsewhere", async ($, on) => {
  standIns(on, {
    'dialects/samuraijack': {
      name: 'Samurai Jack English',
      marks: { yes: { text: '🗡', image: 'samuraijack-sword.svg' }, no: { text: '👹', image: 'samuraijack-aku.svg' } },
      ready: 'ai translated',
      version: 1,
    },
    'dialects/samuraijack-sword.svg': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M2 22 L22 2" stroke="#ccc"/></svg>',
    'dialects/samuraijack-aku.svg': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/></svg>',
  })
  on('prompt.submit', (_, e) => ({ text: e.text }))
  files.set(USER_CONFIG, JSON.stringify({ ...defaults(), dialect: 'samuraijack' }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'mcp__docket__update', add: [{ list: 'C', text: 'Face Aku at dawn?' }] })
  const pictured = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await findText(pictured, /^🗡$/)).toBeDefined()
  expect(await pictured.find({ type: 'Svg' })).toBeUndefined()
  // A button holds only text: the picture marks the answer once it's sent.
  await pictured.press({ key: 'ok-C1' })
  await pictured.unmount()
  const sent = await $.ui.mount({ ...PANE, surface: 'vscode' })
  const sword = await sent.find({ type: 'Svg' })
  expect(sword?.props.alt).toBe('🗡')
  expect(String(sword?.props.source)).toContain('<svg')
  await sent.unmount()
  const plain = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await plain.find({ type: 'Svg' })).toBeUndefined()
  expect(await findText(plain, /^🗡$/)).toBeDefined()
  await plain.unmount()
})

test('the language picker is three pulldowns: a group, a language in it, and its variant', async ($, on) => {
  const many = Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`x${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`, { ready: 'ai translated', version: 1 }]))
  standIns(on, {
    ...many,
    es: { ready: 'ai translated', version: 1, Settings: { text: 'Ajustes', ready: 'ai translated' } },
    'dialects/startrek': { name: 'Starfleet English (Star Trek)', tag: 'en-US-startrek', ready: 'ai translated', version: 1 },
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  await ui.press({ key: 'gear' })
  const group = await ui.find({ type: 'Select', key: 'language-group' })
  expect(group?.props.value).toBe('auto')
  expect(await ui.find({ type: 'Select', key: 'language' })).toBeUndefined()
  // No pulldown holds more than 64.
  const bases = ['en', 'es', ...Object.keys(many)]
  const groups = groupsOf('en', bases)
  expect(groups.every(each => each.codes.length <= 64)).toBe(true)

  await ui.select({ key: 'language-group', value: groups.find(each => each.codes.includes('en'))?.value ?? '' })
  await ui.select({ key: 'language', value: 'en' })
  // English has variants, so picking it picks US English, its first region.
  expect(JSON.parse(files.get(USER_CONFIG) ?? '{}').language).toBe('en-US')
  expect((await ui.find({ type: 'Select', key: 'language-variant' }))?.props.value).toBe('US')
  await ui.select({ key: 'language-variant', value: 'US-startrek' })
  expect(JSON.parse(files.get(USER_CONFIG) ?? '{}').language).toBe('en-US-startrek')
  // The divider picks nothing.
  await ui.select({ key: 'language-variant', value: '-' })
  expect(JSON.parse(files.get(USER_CONFIG) ?? '{}').language).toBe('en-US-startrek')
  expect((await ui.find({ type: 'Select', key: 'language-variant' }))?.props.value).toBe('US-startrek')

  await ui.select({ key: 'language-group', value: groups.find(each => each.codes.includes('es'))?.value ?? '' })
  await ui.select({ key: 'language', value: 'es' })
  // Spanish has regions in the table: Spain is its first.
  expect(JSON.parse(files.get(USER_CONFIG) ?? '{}').language).toBe('es-ES')
  await ui.select({ key: 'language-group', value: groups.find(each => each.codes.includes('xaa'))?.value ?? '' })
  await ui.select({ key: 'language', value: 'xaa' })
  // A language with no variants has no third pulldown, and saves as itself.
  expect(await ui.find({ type: 'Select', key: 'language-variant' })).toBeUndefined()
  expect(JSON.parse(files.get(USER_CONFIG) ?? '{}').language).toBe('xaa')
  await ui.select({ key: 'language-group', value: groups.find(each => each.codes.includes('es'))?.value ?? '' })
  await ui.select({ key: 'language', value: 'es' })
  await ui.unmount()

  const after = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await findText(after, /^Ajustes$/)).toBeDefined()
  await after.unmount()
})

test('a language tag can end in a dialect, as en-US-startrek', async ($, on) => {
  standIns(on, {
    'dialects/startrek': {
      name: 'Starfleet English (Star Trek)',
      ready: 'ai translated',
      version: 1,
      Requests: { text: 'Requesting permission', ready: 'ai translated' },
      Questions: { text: 'Orders, Captain?', ready: 'ai translated' },
      Confirm: { text: 'Confirm, Number One', ready: 'ai translated' },
      'Needs you': { text: 'Bridge to Captain', ready: 'ai translated' },
      View: { text: 'Viewscreen', ready: 'ai translated' },
      Underway: { text: 'At warp', ready: 'ai translated' },
      Later: { text: 'Log for later', ready: 'ai translated' },
      Waiting: { text: 'Holding position', ready: 'ai translated' },
      Pinned: { text: 'Tractor beam', ready: 'ai translated' },
    },
  })
  files.set(USER_CONFIG, JSON.stringify({ ...defaults(), language: 'en-US-startrek' }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'mcp__docket__update', add: [{ list: 'O', text: 'Set course for Risa?' }] })
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await findText(ui, /^Orders, Captain\?$/)).toBeDefined()
  expect(await findText(ui, /Set course for Risa/)).toBeDefined()
  await ui.unmount()
})

test('a language the picker does not know shows as itself, and an unpicked group is forgotten on Done', async ($, on) => {
  standIns(on, { es: { ready: 'ai translated', version: 1 } })
  files.set(USER_CONFIG, JSON.stringify({ ...defaults(), language: 'qq-handmade' }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  await ui.press({ key: 'gear' })
  expect((await ui.find({ type: 'Select', key: 'language-group' }))?.props.value).toBe('current')

  const groups = groupsOf('en', ['en', 'es'])
  await ui.select({ key: 'language-group', value: groups[groups.length - 1]?.value ?? '' })
  await ui.press({ key: 'done' })
  await ui.press({ key: 'gear' })
  expect((await ui.find({ type: 'Select', key: 'language-group' }))?.props.value).toBe('current')
  await ui.unmount()
})

test('switching into a voice or out of one asks Claude to rewrite the open items', async ($, on) => {
  let context: readonly string[] = []
  standIns(on)
  on('prompt.submit', (_, e) => {
    context = e.context ?? []

    return { text: e.text }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'mcp__docket__update', add: [{ list: 'Q', text: 'Ship on Friday?' }] })
  await $.prompt.submit({ text: 'hello' })
  expect(context.join('\n')).not.toContain('rewrite every open item')

  files.set(USER_CONFIG, JSON.stringify({ ...defaults(), voice: 'drunk Optimus Prime' }))
  await $.prompt.submit({ text: 'now in a voice' })
  expect(context.join('\n')).toContain('rewrite every open item')
  expect(context.join('\n')).toContain('in the voice the docket instructions give')

  await $.prompt.submit({ text: 'same voice' })
  expect(context.join('\n')).not.toContain('rewrite every open item')
  // The voice comes with every prompt, since the system prompt is composed once.
  expect(context.join('\n')).toContain('Write every item, new or changed, in character, as drunk Optimus Prime.')

  files.set(USER_CONFIG, JSON.stringify({ ...defaults() }))
  await $.prompt.submit({ text: 'voice off' })
  expect(context.join('\n')).toContain('Write them plainly, out of character.')
})

test('a voice is its own setting, apart from the language: Samurai Jack in Spanish', async ($, on) => {
  let context: readonly string[] = []
  standIns(on, {
    es: { ready: 'ai translated', version: 2, Questions: { text: 'Preguntas', ready: 'ai translated' }, Pinned: { text: 'Fijado', ready: 'ai translated' } },
    'voices/samuraijack': {
      name: 'Samurai Jack',
      voice: 'Samurai Jack: calm, formal, few words',
      voices: { Waiting: 'Aku, gloating' },
      marks: { yes: { text: '🗡', image: 'samuraijack-sword.svg' }, no: '👹' },
    },
    'voices/samuraijack-sword.svg': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M2 22 L22 2"/></svg>',
  })
  on('prompt.submit', (_, e) => {
    context = e.context ?? []

    return { text: e.text }
  })
  files.set(USER_CONFIG, JSON.stringify({ ...defaults(), language: 'es', voice: 'samuraijack' }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'mcp__docket__update', add: [{ list: 'P', text: '¿Al amanecer?' }, { list: 'C', text: '¿Vamos?' }] })
  await $.prompt.submit({ text: 'hola' })
  const told = context.join('\n')
  expect(told).toContain('It is in Spanish')
  expect(told).toContain('in character, as Samurai Jack: calm, formal, few words')
  expect(told).toContain('Aku, gloating')

  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await findText(ui, /^Preguntas$/)).toBeDefined()
  expect(await findText(ui, /^🗡$/)).toBeDefined()
  await ui.press({ key: 'gear' })
  expect((await ui.find({ type: 'Select', key: 'voice' }))?.props.value).toBe('samuraijack')
  await ui.select({ key: 'voice', value: 'none' })
  expect(JSON.parse(files.get(USER_CONFIG) ?? '{}').voice).toBe('none')
  await ui.unmount()
})

test("the config offer's ✔ never writes over a file made since, and 🗑️ declines it for good", async ($, on) => {
  standIns(on)
  files.delete(USER_CONFIG)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  // The person made their own file after the offer appeared.
  files.set(USER_CONFIG, JSON.stringify({ ...defaults(), leanColor: '#123456' }))
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  await ui.press({ key: 'ok-R1' })
  await ui.unmount()
  expect(JSON.parse(files.get(USER_CONFIG) ?? '{}').leanColor).toBe('#123456')

  files.delete(USER_CONFIG)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const again = await $.ui.mount({ ...PANE, surface: 'vscode' })
  const offer = await findText(again, /Create docket's config/)
  expect(offer).toBeDefined()
  await again.press({ key: 'x-R2' })
  await again.unmount()
  expect(store.get('configDeclined')).toBe(true)
  const after = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await findText(after, /Create docket's config/)).toBeUndefined()
  await after.unmount()
})

test('a config that will not parse is noted once, and settings never save over it', async ($, on) => {
  standIns(on)
  on('prompt.submit', (_, e) => ({ text: e.text }))
  files.set(USER_CONFIG, '{ "language": "es", }')

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: 'one' })
  await $.prompt.submit({ text: 'two' })
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  const notes = (await ui.findAll({ type: 'Markdown' })).filter(found => /couldn't read its config/.test(String(found.props.text)))
  expect(notes.length).toBe(1)
  // No offer to create a file that's there.
  expect(await findText(ui, /Create docket's config/)).toBeUndefined()
  await ui.press({ key: 'gear' })
  await ui.input({ key: 'leanColor', text: '#aaaaaa' })
  await ui.unmount()
  expect(files.get(USER_CONFIG)).toBe('{ "language": "es", }')
})

test('a file path cmd would reparse opens without cmd', async ($, on) => {
  const ran: string[][] = []
  standIns(on)
  on('process.run', (_, e) => {
    ran.push([...(e as { argv: string[] }).argv])

    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  env.set('OS', 'Windows_NT')

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'mcp__docket__update', add: [{ list: 'V', text: 'Look at the notes', open: 'C:\\R&D\\notes.md' }] })
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  await ui.press({ key: 'open-V1' })
  await ui.unmount()
  expect(ran.some(argv => argv[0] === 'cmd')).toBe(false)
  expect(ran.some(argv => argv[0] === 'rundll32' && argv.includes('C:\\R&D\\notes.md'))).toBe(true)
})

test("auto follows VS Code's display language when Claude Code names none", async ($, on) => {
  standIns(on, {
    de: {
      ready: 'ai translated',
      version: 2,
      Questions: { text: 'Fragen', ready: 'ai translated' },
      Pinned: { text: 'Geparkt', ready: 'ai translated' },
    },
  })
  env.set('VSCODE_NLS_CONFIG', '{"userLocale":"de","osLocale":"de-de","resolvedLanguage":"de"}')
  env.set('LANG', 'fr_FR.UTF-8')

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'mcp__docket__update', add: [{ list: 'F', text: 'Freitag?' }] })
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await findText(ui, /^Fragen$/)).toBeDefined()
  await ui.unmount()
})

test('the 👁️ opens a file in the editor hosting the session, not whatever answers to code', async ($, on) => {
  const ran: { argv: string[]; env?: Record<string, string> }[] = []
  standIns(on)
  on('process.run', (_, e) => {
    const { argv, init } = e as { argv: string[]; init?: { env?: Record<string, string> } }
    ran.push({ argv: [...argv], env: init?.env })

    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  env.set('OS', 'Windows_NT')
  env.set('VSCODE_NLS_CONFIG', JSON.stringify({ defaultMessagesFile: String.raw`C:\VS Code\6d62\resources\app\out\nls.messages.json` }))
  folders.set('/VS Code/6d62', ['LICENSE', 'ffmpeg.dll'])
  folders.set('/VS Code', ['unins000.exe', 'Code.exe', 'new_Code.exe'])

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'mcp__docket__update', add: [{ list: 'V', text: 'Look at it', open: String.raw`C:\site\index.php` }] })
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  await ui.press({ key: 'open-V1' })
  await ui.unmount()
  expect(ran.length).toBe(1)
  expect(ran[0]?.argv).toEqual(['C:/VS Code/Code.exe', 'C:/VS Code/6d62/resources/app/out/cli.js', '-r', String.raw`C:\site\index.php`])
  expect(ran[0]?.env).toEqual({ ELECTRON_RUN_AS_NODE: '1' })
})

test("an item's label copies the item, as text can't be selected in the pane", async ($, on) => {
  standIns(on)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'mcp__docket__update', add: [{ list: 'Q', text: 'Ship it on Friday?', lean: 'yes, after the tests pass' }] })
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  await ui.press({ key: 'line-Q1', link: { href: 'https://stonecypher.github.io/docket/#copy-Q1' } })
  await ui.unmount()
  expect(copied).toEqual(['Q1. Ship it on Friday?\nLean: yes, after the tests pass'])

  // The terminal, which may open a link itself, keeps a plain label.
  const plain = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await plain.find({ type: 'Markdown' })).toBeUndefined()
  expect(await findText(plain, /Ship it on Friday/)).toBeDefined()
  await plain.unmount()
})

test("the pane's title carries docket's version", async ($, on) => {
  standIns(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(titles).toContain('Docket 📋 9.9.9')
})
