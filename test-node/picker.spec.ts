// The language picker's pulldowns: groups a pulldown can hold, names in the language docket speaks.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { MOST, basesOf, groupsOf, labelFor, nameIn, pickedOf, variantsOf } from '../hooks/picker.ts'

describe('groups', () => {
  for (const speaking of ['en', 'de', 'ja']) {
    test(`in ${speaking}, hold every language once, in about six groups no pulldown overflows`, () => {
      const bases = basesOf()
      const groups = groupsOf(speaking, bases)
      assert.deepEqual(groups.flatMap(group => group.codes).sort(), [...bases].sort())
      assert.ok(groups.length >= 5 && groups.length <= 7, String(groups.length))
      assert.ok(groups.every(group => group.codes.length <= MOST))
      assert.equal(new Set(groups.map(group => group.value)).size, groups.length)
    })
  }

  test('never split an initial that fits, and label each group by its first and last', () => {
    const groups = groupsOf('en', basesOf())
    assert.equal(groups[0]?.label.charAt(0), 'A')
    const initials = groups.map(group => new Set(group.codes.map(code => labelFor('en', code).normalize('NFD').charAt(0).toUpperCase())))
    for (let i = 1; i < initials.length; i += 1) {
      for (const each of initials[i] ?? []) assert.ok(!initials[i - 1]?.has(each), each)
    }
  })

  test('split an initial too big for one pulldown by its first two letters', () => {
    const many = Array.from({ length: 130 }, (_, i) => `q${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`)
    const groups = groupsOf('en', many)
    assert.ok(groups.every(group => group.codes.length <= MOST))
    assert.equal(groups.flatMap(group => group.codes).length, 130)
  })
})

describe('names', () => {
  test('are in the language docket speaks, with the language’s own beside', () => {
    assert.equal(labelFor('de', 'fr'), 'Französisch (français)')
    assert.equal(labelFor('en', 'en'), 'English')
  })

  test('fall back to the table where the runtime has none', () => {
    assert.equal(labelFor('en', 'tlh'), 'Klingon (tlhIngan Hol)')
    assert.equal(nameIn('xx', 'xx'), 'xx')
  })
})

describe('variants', () => {
  test('are none, each region with a file, and each dialect, as the rest of the tag', () => {
    const variants = variantsOf('en', 'en', ['en', 'es', 'pt-BR'], [{ tag: 'en-US-startrek', name: 'Starfleet English' }])
    assert.deepEqual(variants.map(each => each.value), ['', 'US-startrek'])
    assert.deepEqual(variantsOf('en', 'pt', ['pt', 'pt-BR'], []).map(each => each.value), ['', 'BR'])
  })

  test('read a saved setting back into its base and the rest of its tag', () => {
    assert.deepEqual(pickedOf('en-US-startrek'), { base: 'en', variant: 'US-startrek' })
    assert.deepEqual(pickedOf('auto'), { base: 'auto', variant: '' })
    assert.deepEqual(pickedOf(undefined), { base: 'auto', variant: '' })
    assert.deepEqual(pickedOf('ES'), { base: 'es', variant: '' })
  })
})
