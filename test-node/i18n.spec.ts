// The language files: each one complete, each one's letters usable as labels, and the helpers that
// map between what the user sees and docket's internal letters.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { describe, test } from 'node:test'

import { EN, LANGUAGES, fill, idFor, labelOf, labelOfId, languageOf, letterFor, mergeStrings, resolveLanguage } from '../hooks/i18n.ts'

const folder = new URL('../locales/', import.meta.url)
const read = (file: string): unknown => JSON.parse(readFileSync(new URL(file, folder), 'utf8'))

// Every key path in a value, arrays counted as leaves.
const paths = (value: unknown, at = ''): string[] =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? Object.entries(value).flatMap(([key, each]) => paths(each, at ? `${at}.${key}` : key))
    : [at]

describe('locale files', () => {
  const files = readdirSync(folder).filter(file => file.endsWith('.json'))

  test('there is one for every language docket offers, and no other', () => {
    assert.deepEqual(files.map(file => file.replace('.json', '')).sort(), [...LANGUAGES].sort())
  })

  test('English in code is exactly en.json', () => {
    assert.deepEqual(read('en.json'), EN)
  })

  for (const file of files) {
    test(`${file} has every key English has, and no others`, () => {
      assert.deepEqual(paths(read(file)).sort(), paths(EN).sort())
    })

    test(`${file} gives each list its own single-character letter`, () => {
      const letters = Object.values(mergeStrings(EN, read(file)).lists).map(list => list.letter)
      assert.equal(new Set(letters.map(letter => letter.toLowerCase())).size, letters.length)
      for (const letter of letters) assert.equal([...letter].length, 1, letter)
    })

    test(`${file} keeps the placeholders English uses`, () => {
      const strings = mergeStrings(EN, read(file))
      const slots = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort()
      const walk = (en: unknown, there: unknown, at: string) => {
        if (typeof en === 'string') {
          assert.deepEqual(slots(String(there)), slots(en), at)
        } else if (en && typeof en === 'object' && !Array.isArray(en)) {
          for (const [key, each] of Object.entries(en)) walk(each, (there as Record<string, unknown>)[key], `${at}.${key}`)
        }
      }
      walk(EN, strings, file)
    })
  }
})

describe('mergeStrings', () => {
  test('keeps English for anything missing, empty or the wrong shape', () => {
    const merged = mergeStrings(EN, { lean: '', more: 3, lists: { Q: { name: 'Fragen' } }, fields: { emoji: ['only one'] } })
    assert.equal(merged.lean, 'Lean')
    assert.equal(merged.more, '+{n} more')
    assert.equal(merged.lists.Q.name, 'Fragen')
    assert.equal(merged.lists.Q.letter, 'Q')
    assert.deepEqual(merged.fields.emoji, EN.fields.emoji)
  })
})

describe('choosing a language', () => {
  test("reads Claude Code's names for languages as well as codes", () => {
    assert.equal(languageOf('japanese'), 'ja')
    assert.equal(languageOf('Español'), 'es')
    assert.equal(languageOf('Deutsch'), 'de')
    assert.equal(languageOf('klingon'), undefined)
  })

  test("docket's own setting wins, auto follows Claude Code, and English is the fallback", () => {
    assert.equal(resolveLanguage('de', 'japanese'), 'de')
    assert.equal(resolveLanguage('auto', 'japanese'), 'ja')
    assert.equal(resolveLanguage(undefined, undefined), 'en')
    assert.equal(resolveLanguage('auto', 'klingon'), 'en')
  })
})

describe('labels', () => {
  const es = mergeStrings(EN, read('es.json'))

  test('show the language letter for an item and an internal id', () => {
    assert.equal(labelOf(es, { list: 'Q', n: 12 }), 'P12')
    assert.equal(labelOfId(es, 'P3'), 'F3')
    assert.equal(labelOfId(es, 'X3'), 'X3')
  })

  test('read back to the internal id, in any case', () => {
    assert.equal(letterFor(es, 'p'), 'Q')
    assert.equal(idFor(es, 'p12'), 'Q12')
    assert.equal(idFor(es, 'Q12'), undefined)
  })

  test('fill leaves a slot it has no value for', () => {
    assert.equal(fill('{id} and {other}', { id: 'P1' }), 'P1 and {other}')
  })
})
