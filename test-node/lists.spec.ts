// Unit tests for docket's pure logic, under Node's own runner (`npm test`).
// The hooks and the pane need the engine: those are tests/*.test.tsx, under `claude plugin test`.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import type { Item } from '../types/index.d.ts'
import {
  ANSWERED_STALE_TURNS,
  LISTS,
  REVIEW,
  SEND_BACK,
  STALE_TURNS,
  ageOf,
  arrange,
  counterParts,
  counterText,
  instructions,
  openCounts,
  isUserOrigin,
  references,
  sendsBack,
  settingsOf,
  snapshot,
  speaksOfPending,
  staleItems,
  staleNote,
  taskNote,
  userTurnAfter,
} from '../hooks/lists.ts'
import { FIELDS } from '../hooks/config.ts'
import { EN, translate } from '../hooks/i18n.ts'
import { readFileSync } from 'node:fs'

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
    const named = references('q10 yes, c23-c25 confirmed', all, EN) ?? ''
    for (const id of ['C23', 'C24', 'C25', 'Q10']) {
      assert.match(named, new RegExp(`\\b${id}\\b`))
    }
    assert.match(named, /Q10.*already closed/)
  })

  test('says nothing when no label names an item', () => {
    assert.equal(references('v0 looks good', all, EN), undefined)
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

describe('isUserOrigin', () => {
  test("counts the user's own prompts", () => {
    for (const kind of ['composer', 'bridge', 'sdk', 'slack-ping']) assert.equal(isUserOrigin({ kind }), true, kind)
    assert.equal(isUserOrigin({ kind: 'plugin', asUser: true }), true)
  })

  test('counts nothing in the background, nor a plugin speaking for itself', () => {
    const background = ['task-notification', 'scheduled-trigger', 'peer', 'peer-send-message', 'projects-relay', 'channel', 'coordinator', 'observer', 'observer-activity', 'auto-continuation', 'unclassified']
    for (const kind of background) assert.equal(isUserOrigin({ kind }), false, kind)
    assert.equal(isUserOrigin({ kind: 'plugin' }), false)
    assert.equal(isUserOrigin(undefined), false)
  })
})

describe('userTurnAfter', () => {
  test("a user prompt makes the turn the user's, whatever came before", () => {
    assert.equal(userTurnAfter(false, { kind: 'composer' }, undefined), true)
    assert.equal(userTurnAfter(false, { kind: 'composer' }, 't1'), true)
  })

  test('a background prompt that starts its own turn makes it background', () => {
    assert.equal(userTurnAfter(true, { kind: 'task-notification' }, undefined), false)
    assert.equal(userTurnAfter(true, { kind: 'scheduled-trigger' }, undefined), false)
  })

  test('a background prompt delivered into a running turn leaves it as it was', () => {
    assert.equal(userTurnAfter(true, { kind: 'task-notification' }, 't1'), true)
    assert.equal(userTurnAfter(false, { kind: 'task-notification' }, 't1'), false)
  })
})

describe('sendsBack', () => {
  const pending = { isDeepDiving: true, isUserTurn: true, isStopHookActive: false, answer: 'Next up is the README.', isChanged: false }

  test('sends back a user turn that spoke of pending work without changing the docket', () => {
    assert.equal(sendsBack(pending), true)
  })

  test('never with Deep dive off, on a background turn, or a second time', () => {
    assert.equal(sendsBack({ ...pending, isDeepDiving: false }), false)
    assert.equal(sendsBack({ ...pending, isUserTurn: false }), false)
    assert.equal(sendsBack({ ...pending, isStopHookActive: true }), false)
  })

  test('not when the docket changed, or the reply left nothing open, or the reply is unknown', () => {
    assert.equal(sendsBack({ ...pending, isChanged: true }), false)
    assert.equal(sendsBack({ ...pending, answer: 'Done. All tests pass.' }), false)
    assert.equal(sendsBack({ ...pending, answer: undefined }), false)
  })
})

describe('snapshot', () => {
  test('tells Claude that clearing cancels nothing', () => {
    const text = snapshot([item('U1')], ['U2'], EN)
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
    const text = instructions(settingsOf({}), false, EN)
    assert.match(text, /never repeat docket items in your prose reply/)
    assert.match(text, /P at most about 8 words/)
  })

  test('asks for the docket as plain text where nothing draws it', () => {
    assert.match(instructions(settingsOf({}), true, EN), /end each reply with the open items as plain text/)
  })

  test('leaves out word targets when none are set', () => {
    assert.doesNotMatch(instructions(settingsOf({ targetWords: '' }), false, EN), /at most about/)
  })
})

describe('in another language', () => {
  const locale = (code: string, name: string) => translate(JSON.parse(readFileSync(new URL(`../locales/${code}.json`, import.meta.url), 'utf8')), name)
  const es = locale('es', 'Spanish')
  const ja = locale('ja', 'Japanese')

  test("names items by the language's letters, so Spanish P12 is a question", () => {
    const all = [item('Q12'), item('P3'), item('C4'), item('C5')]
    const named = references('p12 sí, c4 a c5 confirmados', all, es) ?? ''
    assert.match(named, /P12 item Q12/)
    assert.match(named, /C4 item C4/)
    assert.match(named, /C5 item C5/)
    assert.doesNotMatch(named, /item P3/)
  })

  test('reads a Japanese label right after other text', () => {
    assert.match(references('はい、質12で', [item('Q12')], ja) ?? '', /質12 item Q12/)
  })

  test('finds a label typed without its accent', () => {
    const tr = locale('tr', 'Turkish')
    assert.match(references('i3 olur', [item('R3')], tr) ?? '', /İ3 item R3/)
  })

  test("doesn't take a letter at the end of a word for a label", () => {
    assert.equal(references('vamos2 bien', [item('W2')], es), undefined)
  })

  test("tells Claude the language, its letters and its buttons' messages", () => {
    const text = instructions(settingsOf({}), false, es)
    assert.match(text, /Write every item's text, lean and options in Spanish/)
    assert.match(text, /P \(Preguntas\) questions/)
    assert.match(text, /"Acepto la propuesta de P5\."/)
    assert.match(text, /F at most about 8 words/)
  })

  test('labels cleared items in the language', () => {
    assert.match(snapshot([item('Q1')], ['Q2'], es), /P1 item Q1[\s\S]*since the last prompt: P2\./)
  })
})

describe('settings that a hand-edit gets wrong', () => {
  test('a target length for a letter no list has is ignored, not fatal to the instructions', () => {
    const settings = settingsOf({ targetWords: 'A=10,Q=5,X=3' })
    assert.deepEqual(settings.targetWords, { Q: 5 })
    assert.match(instructions(settings, false, EN), /Q at most about 5 words/)
  })

  test('a linger that is a word, negative or past a day gives way', () => {
    assert.equal(settingsOf({ strikeLingerMinutes: '3 min' }).lingerMs, 3 * 60_000)
    assert.equal(settingsOf({ answeredLingerSeconds: -5 }).answeredMs, 0)
    assert.equal(settingsOf({ strikeLingerMinutes: 10_000_000 }).lingerMs, 24 * 60 * 60_000)
  })

  test('the instructions give the answered linger as set', () => {
    assert.match(instructions(settingsOf({ answeredLingerSeconds: 45 }), false, EN), /about 45 seconds after their button/)
  })

  test("the mod's own items are marked for Claude to leave alone", () => {
    assert.match(snapshot([item('R1', { action: 'createConfig' })], [], EN), /the mod's own item: leave it alone/)
  })

  test('a stale threshold that is a word, negative, fractional or huge gives way', () => {
    assert.equal(settingsOf({ underwayStaleTurns: 'soon' }).staleTurns, STALE_TURNS)
    assert.equal(settingsOf({ underwayStaleTurns: -4 }).staleTurns, 0)
    assert.equal(settingsOf({ underwayStaleTurns: 7.9 }).staleTurns, 7)
    assert.equal(settingsOf({ underwayStaleTurns: 1e12 }).staleTurns, 100_000)
  })
})

describe('underwayStaleTurns', () => {
  test('defaults to STALE_TURNS, in the settings and in the config alike', () => {
    assert.equal(settingsOf({}).staleTurns, STALE_TURNS)
    assert.equal(FIELDS.underwayStaleTurns?.default, STALE_TURNS)
  })

  test('0 turns the underway sweep off', () => {
    assert.equal(settingsOf({ underwayStaleTurns: 0 }).staleTurns, 0)
  })
})

describe('ageOf', () => {
  test('says how long an underway item has sat, and how long since it changed', () => {
    assert.equal(ageOf(item('U34', { addedTurn: 212, changedTurn: 212 }), 601), 'underway since turn 212, unchanged for 389 turns')
    assert.equal(ageOf(item('U2', { addedTurn: 5, changedTurn: 9 }), 10), 'underway since turn 5, unchanged for 1 turn')
  })

  test('says so when the item was added or changed this turn', () => {
    assert.equal(ageOf(item('U1', { addedTurn: 10, changedTurn: 10 }), 10), 'underway since this turn')
    assert.equal(ageOf(item('W3', { addedTurn: 4, changedTurn: 10 }), 10), 'waiting since turn 4, changed this turn')
  })

  test('shows no age for the other lists, nor for the mod itself', () => {
    for (const id of ['P1', 'L1', 'V1', 'N1', 'C1', 'Q1', 'R1']) assert.equal(ageOf(item(id), 50), '', id)
    assert.equal(ageOf(item('U1', { action: 'update' }), 50), '')
  })
})

describe('snapshot with the turn', () => {
  test('gives underway and waiting items their age', () => {
    const text = snapshot([item('U34', { addedTurn: 212, changedTurn: 212, text: 'Rebase #40' }), item('Q1')], [], EN, 601)
    assert.match(text, /^U34 Rebase #40 \| underway since turn 212, unchanged for 389 turns$/m)
    assert.match(text, /^Q1 item Q1$/m)
  })

  test('says when an answered item was answered, and to close it once acted on', () => {
    const text = snapshot([item('R7', { answered: 'yes', answeredAt: 1, answeredTurn: 598 }), item('C5', { answered: 'no', answeredAt: 1, answeredTurn: 601 })], [], EN, 601)
    assert.match(text, /R7 item R7 \| the user answered yes by button 3 turns ago: close it once acted on/)
    assert.match(text, /C5 item C5 \| the user answered no by button this turn: close it once acted on/)
  })

  test('an item answered before docket kept the turn still says to close it', () => {
    assert.match(snapshot([item('Q2', { answered: 'b' })], [], EN, 9), /answered b by button: close it once acted on/)
  })

  test('without the turn, it shows no age, as before', () => {
    assert.doesNotMatch(snapshot([item('U1')], [], EN), /underway since/)
  })

  test("the mod's own answered item isn't told to Claude to close", () => {
    assert.doesNotMatch(snapshot([item('R1', { action: 'createConfig', answered: 'yes', answeredTurn: 1 })], [], EN, 9), /close it once/)
  })
})

describe('staleItems and staleNote', () => {
  test('names an underway item unchanged for the threshold, and not one turn short of it', () => {
    const all = [item('U1', { changedTurn: 10 }), item('U2', { changedTurn: 11 })]
    assert.deepEqual(staleItems(all, 30, 20).underway.map(each => each.id), ['U1'])
    const note = staleNote(all, 30, 20, EN)
    assert.match(note, /^- U1 hasn't changed in 20 turns: close it \(unasked: true\) if its work finished/m)
    assert.doesNotMatch(note, /U2/)
  })

  test('names an answered item still open a few turns on', () => {
    const all = [item('R7', { answered: 'yes', answeredTurn: 10 }), item('R8', { answered: 'yes', answeredTurn: 11 })]
    assert.deepEqual(staleItems(all, 10 + ANSWERED_STALE_TURNS, 20).answered.map(each => each.id), ['R7'])
    assert.match(staleNote(all, 13, 20, EN), /^- R7 was answered 3 turns ago and is still open: act on the answer if you haven't, then close it\.$/m)
  })

  test('leaves out closed items, the mod\'s own, and other lists going stale', () => {
    const all = [
      item('U1', { changedTurn: 1, closed: { at: 1, isUnasked: true } }),
      item('U2', { changedTurn: 1, action: 'update' }),
      item('W1', { changedTurn: 1 }),
      item('L1', { changedTurn: 1 }),
    ]
    assert.equal(staleNote(all, 500, 20, EN), '')
  })

  test('with the sweep off, names no underway item, but still the answered ones', () => {
    const all = [item('U1', { changedTurn: 1 }), item('Q1', { answered: 'yes', answeredTurn: 1 })]
    const { underway, answered } = staleItems(all, 500, 0)
    assert.deepEqual(underway, [])
    assert.deepEqual(answered.map(each => each.id), ['Q1'])
  })

  test("labels items in the docket's language", () => {
    const es = translate(JSON.parse(readFileSync(new URL('../locales/es.json', import.meta.url), 'utf8')), 'Spanish')
    assert.match(staleNote([item('Q4', { answered: 'yes', answeredTurn: 1 })], 9, 20, es), /- P4 was answered/)
  })

  // A seeded generator, so a failure can be replayed: mulberry32.
  const seeded = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  test('stochastic: names exactly the open underway and answered items past their thresholds, each once', () => {
    for (let seed = 1; seed <= 300; seed += 1) {
      const random = seeded(seed)
      const int = (below: number) => Math.floor(random() * below)
      const turn = 1 + int(400)
      const staleTurns = int(4) === 0 ? 0 : 1 + int(60)
      const all = Array.from({ length: 1 + int(25) }, (_, i) => {
        const list = LISTS[int(LISTS.length)]?.letter ?? 'U'
        const addedTurn = int(turn + 1)
        const changedTurn = addedTurn + int(turn - addedTurn + 1)
        const isAnswered = int(3) === 0

        return item(`${list}${i + 1}`, {
          addedTurn,
          changedTurn,
          ...(isAnswered ? { answered: 'yes', answeredTurn: changedTurn + int(turn - changedTurn + 2) } : {}),
          ...(int(5) === 0 ? { closed: { at: 1, isUnasked: false } } : {}),
          ...(int(10) === 0 ? { action: 'update' as const } : {}),
        })
      })
      const { underway, answered } = staleItems(all, turn, staleTurns)
      const live = all.filter(each => each.closed === undefined && !each.action)
      const expectAnswered = live.filter(each => each.answeredTurn !== undefined && turn - each.answeredTurn >= ANSWERED_STALE_TURNS)
      const expectUnderway = live.filter(
        each => staleTurns > 0 && each.list === 'U' && !expectAnswered.includes(each) && turn - each.changedTurn >= staleTurns,
      )
      assert.deepEqual(answered, expectAnswered, `seed ${seed}`)
      assert.deepEqual(underway, expectUnderway, `seed ${seed}`)

      const note = staleNote(all, turn, staleTurns, EN)
      const named = [...note.matchAll(/^- (\w\d+) /gm)].map(([, id]) => id)
      assert.deepEqual(named.toSorted(), [...expectUnderway, ...expectAnswered].map(each => each.id).toSorted(), `seed ${seed}`)
      assert.equal(new Set(named).size, named.length, `seed ${seed}: an item named twice`)
      assert.equal(note === '', named.length === 0, `seed ${seed}`)
      // Each underway item's age in the snapshot agrees with the turns it has sat.
      for (const each of live.filter(one => one.list === 'U' && one.addedTurn < turn)) {
        assert.match(ageOf(each, turn), new RegExp(`since turn ${each.addedTurn}, ${turn === each.changedTurn ? 'changed this turn' : `unchanged for ${turn - each.changedTurn} turn`}`), `seed ${seed}`)
      }
    }
  })
})

describe('taskNote', () => {
  const all = [item('U1', { text: 'Port the parser', emoji: '🔨' }), item('U2', { closed: { at: 1, isUnasked: true } }), item('U3', { action: 'update' }), item('Q1')]

  test('on a task notification, lists the open underway items', () => {
    const note = taskNote(all, { kind: 'task-notification' }, EN)
    assert.match(note, /^A background task just reported back\. If it finished one of these, close it \(unasked: true\), or move its follow-up to V \(Verify\):$/m)
    assert.match(note, /^- U1 🔨 Port the parser$/m)
    assert.doesNotMatch(note, /U2|U3|Q1/)
  })

  test('says nothing for any other origin, or when nothing is underway', () => {
    for (const kind of ['composer', 'scheduled-trigger', 'plugin']) assert.equal(taskNote(all, { kind }, EN), '', kind)
    assert.equal(taskNote(all, undefined, EN), '')
    assert.equal(taskNote([item('Q1')], { kind: 'task-notification' }, EN), '')
  })

  test("names Verify in the docket's language", () => {
    const es = translate(JSON.parse(readFileSync(new URL('../locales/es.json', import.meta.url), 'utf8')), 'Spanish')
    assert.match(taskNote([item('U1')], { kind: 'task-notification' }, es), new RegExp(`follow-up to ${es.lists.V.letter} \\(${es.lists.V.name}\\)`))
  })
})

describe('closing finished work', () => {
  test("Deep dive's review and send-back both ask to close finished underway work and acted-on answers", () => {
    assert.match(REVIEW, /Any underway item whose work finished, this turn or earlier: close it \(unasked\)\. Any answered item you have acted on: close it\./)
    assert.match(SEND_BACK, /Any underway item whose work finished, and any answered item you have acted on: close it\./)
  })

  test('the instructions tell Claude to close underway work as soon as it finishes', () => {
    assert.match(instructions(settingsOf({}), false, EN), /underway: only your own work in progress, never the user's\. Close it \(unasked\) as soon as its work finishes/)
  })
})
