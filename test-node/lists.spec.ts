// Unit tests for docket's pure logic, under Node's own runner (`npm test`).
// The hooks and the pane need the engine: those are tests/*.test.tsx, under `claude plugin test`.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import type { Item } from '../types/index.d.ts'
import {
  LISTS,
  arrange,
  counterParts,
  counterText,
  instructions,
  openCounts,
  references,
  settingsOf,
  snapshot,
  speaksOfPending,
} from '../hooks/lists.ts'

const item = (id: string, extra: Partial<Item> = {}): Item => ({
  id,
  list: id[0] as Item['list'],
  n: Number(id.slice(1)),
  text: `item ${id}`,
  addedTurn: 1,
  changedTurn: 1,
  ...extra,
})

const listOf = (letter: string) => {
  const list = LISTS.find(each => each.letter === letter)
  assert.ok(list, `no list ${letter}`)

  return list
}

describe('settingsOf', () => {
  test('fills in the defaults', () => {
    const settings = settingsOf({})
    assert.equal(settings.display, 'pane')
    assert.equal(settings.caps.Q, 7)
    assert.equal(settings.targetWords.P, 8)
    assert.ok(settings.inline.has('P'))
    assert.equal(settings.answeredMs, 20_000)
  })

  test('falls back from a color the engine would refuse, keeps one it takes', () => {
    assert.equal(settingsOf({ leanColor: 'not a color' }).leanColor, '#b1b1b1')
    assert.equal(settingsOf({ leanColor: '#abc' }).leanColor, '#abc')
    assert.equal(settingsOf({ leanColor: 'subtle' }).leanColor, 'subtle')
    assert.equal(settingsOf({ leanColor: '' }).leanColor, undefined)
  })

  test('reads letter lists and word targets loosely', () => {
    const settings = settingsOf({ noItemEmojiLists: 'q, p', targetWords: 'p=5,Q=30' })
    assert.ok(settings.noItemEmoji.has('Q') && settings.noItemEmoji.has('P'))
    assert.deepEqual(settings.targetWords, { P: 5, Q: 30 })
  })
})

describe('counterText', () => {
  test('says +0 rather than nothing, so an unchanged list never looks broken', () => {
    assert.equal(counterText(0, 0), '+0')
  })

  test('splits a counter into its direction, arrow and number', () => {
    assert.deepEqual(counterParts(0, 3), { more: '', arrow: '↑', number: '3', direction: 'up' })
    assert.deepEqual(counterParts(2, -1), { more: '+2 more · ', arrow: '↓', number: '1', direction: 'down' })
    assert.equal(counterParts(0, 0).direction, 'none')
  })

  test('puts the hidden count before the delta', () => {
    assert.equal(counterText(3, 2), '+3 more · ↑2')
    assert.equal(counterText(0, -4), '↓4')
  })
})

describe('arrange', () => {
  const now = 100_000

  test('caps a list, but always shows items new this turn', () => {
    const all = [item('P1'), item('P2'), item('P3', { addedTurn: 5 })]
    const { shown, hidden } = arrange(all, listOf('P'), 1, 5, now, 0, false, 20_000)
    assert.deepEqual(shown.map(each => each.id), ['P1', 'P3'])
    assert.equal(hidden, 1)
  })

  test('puts the most urgent first in the pane, and last beside the prompt', () => {
    const all = [item('Q1', { rank: 2 }), item('Q2', { rank: 1 })]
    assert.deepEqual(arrange(all, listOf('Q'), 7, 1, now, 0, false, 20_000).shown.map(each => each.id), ['Q2', 'Q1'])
    assert.deepEqual(arrange(all, listOf('Q'), 7, 1, now, 0, true, 20_000).shown.map(each => each.id), ['Q1', 'Q2'])
  })

  test('hides an answered item once its time is up', () => {
    const all = [item('Q1', { answered: 'yes', answeredAt: now - 21_000 }), item('Q2', { answered: 'yes', answeredAt: now - 5_000 })]
    assert.deepEqual(arrange(all, listOf('Q'), 7, 1, now, 0, false, 20_000).shown.map(each => each.id), ['Q2'])
  })

  test('keeps an item Claude closed on its own struck through for a while', () => {
    const all = [item('U1', { closed: { at: now - 1_000, isUnasked: true } }), item('U2', { closed: { at: now - 1_000, isUnasked: false } })]
    const { lingering, shown } = arrange(all, listOf('U'), 7, 1, now, 60_000, false, 20_000)
    assert.deepEqual(lingering.map(each => each.id), ['U1'])
    assert.deepEqual(shown, [])
  })
})

describe('references', () => {
  const all = [item('C23'), item('C24'), item('C25'), item('Q10', { closed: { at: 1, isUnasked: false } })]

  test('expands a range and names closed items as closed', () => {
    const named = references('q10 yes, c23-c25 confirmed', all) ?? ''
    for (const id of ['C23', 'C24', 'C25', 'Q10']) {
      assert.match(named, new RegExp(`\\b${id}\\b`))
    }
    assert.match(named, /Q10.*already closed/)
  })

  test('says nothing when no label names an item', () => {
    assert.equal(references('v0 looks good', all), undefined)
  })
})

describe('speaksOfPending', () => {
  test('catches a reply that leaves work open', () => {
    assert.ok(speaksOfPending('Next up is the README.'))
    assert.ok(speaksOfPending("Once you've set up git, I'll push."))
  })

  test('leaves a reply with nothing open alone', () => {
    assert.ok(!speaksOfPending('Done. All tests pass.'))
  })

  test('leaves explanations of how things work alone', () => {
    // Real false alarms from the session that built docket.
    assert.ok(!speaksOfPending('The row goes away once I settle it on my next turn.'))
    assert.ok(!speaksOfPending('Later sits right below Underway in the pane.'))
    assert.ok(!speaksOfPending('Your answer waits in the queue until I finish, and the pending state ends there.'))
    assert.ok(!speaksOfPending('Then the chaining gives you the logic; a long game hits a ceiling.'))
  })

  test('ignores phrases inside code', () => {
    assert.ok(!speaksOfPending(`Run \`npm test\`, or see:\n\`\`\`\n// next up: todo\n\`\`\``))
  })
})

describe('snapshot', () => {
  test('tells Claude that clearing cancels nothing', () => {
    const text = snapshot([item('U1')], ['U2'])
    assert.match(text, /U1/)
    assert.match(text, /cancels no work/)
  })
})

describe('openCounts', () => {
  test('counts only open items, per list', () => {
    const all = [item('Q1'), item('Q2'), item('Q3', { closed: { at: 1, isUnasked: false } }), item('P1')]
    assert.deepEqual(openCounts(all), { Q: 2, P: 1 })
  })
})

describe('instructions', () => {
  test('tells Claude not to repeat the docket in prose when the pane draws it', () => {
    const text = instructions(settingsOf({}), false)
    assert.match(text, /never repeat docket items in your prose reply/)
    assert.match(text, /P at most about 8 words/)
  })

  test('asks for the docket as plain text where nothing draws it', () => {
    assert.match(instructions(settingsOf({}), true), /end each reply with the open items as plain text/)
  })

  test('leaves out word targets when none are set', () => {
    assert.doesNotMatch(instructions(settingsOf({ targetWords: '' }), false), /at most about/)
  })
})
