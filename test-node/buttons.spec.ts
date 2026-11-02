// Unit tests for the buttons an item offers Claude, under Node's own runner (`npm test`). The presses
// themselves need the engine: those are in tests/docket.test.tsx.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import type { Item } from '../types/index.d.ts'
import { buttonOf, buttonsOf } from '../hooks/buttons.ts'
import { EN, translate } from '../hooks/i18n.ts'

const item = (id: string, extra: Partial<Item> = {}): Item => ({
  id,
  list: id[0] as Item['list'],
  n: Number(id.slice(1)),
  text: `item ${id}`,
  addedTurn: 1,
  changedTurn: 1,
  ...extra,
})

// Each button as "name: what it sends", or the bare name for one that sends nothing.
const shown = (found: Item) => buttonsOf(found, EN).map(each => (each.kind === 'answer' ? `${each.button}: ${each.send}` : each.button))

describe('buttonsOf', () => {
  test("a request's and a confirm's ✔ and ✗ send their list's own words", () => {
    assert.deepEqual(shown(item('R3')), ['yes: Approved R3.', 'no: Declined R3.', 'clear'])
    assert.deepEqual(shown(item('C2')), ['yes: Confirmed C2.', 'no: Not confirmed C2.', 'clear'])
  })

  test("a question's lean gets ✔ and ✗; its options replace them", () => {
    assert.deepEqual(shown(item('Q5', { lean: 'yes' })), ['yes: Accept the lean on Q5.', 'no: No to the lean on Q5.', 'clear'])
    assert.deepEqual(shown(item('Q4', { lean: 'b', options: ['a', 'b'] })), ['a: Q4 (a).', 'b: Q4 (b).', 'clear'])
    assert.deepEqual(shown(item('Q6', { options: ['🌐', '📄'] })), ['🌐: Q6 (🌐).', '📄: Q6 (📄).', 'clear'])
    // No lean and no options: nothing to answer with.
    assert.deepEqual(shown(item('Q7')), ['clear'])
  })

  test('a Later item starts, and an item about a file opens', () => {
    assert.deepEqual(shown(item('L1')), ['start: Start L1 now.', 'clear'])
    assert.deepEqual(shown(item('V2', { open: '/tmp/a.md' })), ['open', 'clear'])
    const [start] = buttonsOf(item('L1'), EN)
    assert.equal(start?.kind === 'answer' && start.answer, '🏗️')
  })

  test('an answer marks the item with what was picked', () => {
    const answers = buttonsOf(item('Q4', { options: ['a', 'b'] }), EN).map(each => (each.kind === 'answer' ? each.answer : ''))
    assert.deepEqual(answers, ['a', 'b', ''])
    assert.deepEqual(
      buttonsOf(item('R1'), EN).map(each => (each.kind === 'answer' ? each.answer : '')),
      ['yes', 'no', ''],
    )
  })

  test('a sent item keeps only its Open, and a closed one has no buttons', () => {
    assert.deepEqual(shown(item('R1', { answered: 'yes', answeredAt: 5 })), [])
    assert.deepEqual(shown(item('V1', { answered: 'yes', open: '/tmp/a.md' })), ['open'])
    assert.deepEqual(shown(item('R1', { closed: { at: 5, isUnasked: false } })), [])
  })

  test("the words are the language's, and so is the label", () => {
    const es = translate({ Requests: { text: 'Solicitudes', ready: true }, 'Approved {id}.': { text: 'Aprobado {id}.', ready: true } }, 'Spanish')
    const [yes] = buttonsOf(item('R2'), es)
    assert.equal(yes?.kind === 'answer' && yes.send, 'Aprobado S2.')
  })
})

describe('buttonOf', () => {
  const offered = buttonsOf(item('Q4', { options: ['a', 'b'] }), EN)
  const pair = buttonsOf(item('R1'), EN)

  test('finds a button by its name, then ignoring case', () => {
    assert.equal(buttonOf(offered, 'b')?.button, 'b')
    assert.equal(buttonOf(offered, ' B ')?.button, 'b')
    assert.equal(buttonOf(pair, 'YES')?.button, 'yes')
  })

  test('takes ✔ and ✗ for yes and no', () => {
    assert.equal(buttonOf(pair, '✔')?.button, 'yes')
    assert.equal(buttonOf(pair, '✗')?.button, 'no')
  })

  test("is undefined for a button the item doesn't show", () => {
    assert.equal(buttonOf(offered, 'yes'), undefined)
    assert.equal(buttonOf(pair, 'start'), undefined)
    assert.equal(buttonOf([], 'clear'), undefined)
  })
})
