// The language files: each one complete, each one's letters usable as labels, and the helpers that
// map between what the user sees and docket's internal letters.
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { describe, test } from 'node:test'

import { AI, EN, STRINGS_VERSION, localeOf, fill, firstLetter, idFor, keysOf, labelOf, labelOfId, letterFor, resolveLanguage, markImage, stateOf, synced, translate, translationOf, voiceOf } from '../hooks/i18n.ts'
import { NAMES, codeOf, englishName, nativeName, normalCode } from '../hooks/languages.ts'
import { instructions, nowNote, rewriteNote, settingsOf } from '../hooks/lists.ts'

const folder = new URL('../locales/', import.meta.url)
const read = (file: string): unknown => JSON.parse(readFileSync(new URL(file, folder), 'utf8'))

const slots = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort()

describe('locale files', () => {
  const files = readdirSync(folder).filter(file => file.endsWith('.json'))

  test('each is named by a language code, written the standard way', () => {
    for (const file of files) {
      const code = file.replace('.json', '')
      assert.equal(normalCode(code), code, file)
    }
  })

  test('every language docket knows has its file', () => {
    for (const code of Object.keys(NAMES).filter(code => code !== 'en')) assert.ok(files.includes(`${code}.json`), code)
  })

  for (const file of files) {
    const raw = readFileSync(new URL(file, folder), 'utf8')
    const words = JSON.parse(raw) as Record<string, unknown>
    const state = stateOf(words)
    const translations = keysOf().map(english => [english, translationOf(words[english])] as const)

    test(`${file} is in line with English (npm run locales)`, () => {
      assert.equal(raw, synced(words))
    })

    test(`${file} keeps each string's placeholders`, () => {
      for (const [english, { text }] of translations) if (text) assert.deepEqual(slots(text), slots(english), english)
    })

    test(`${file} is no readier than its strings`, () => {
      if (state.ready === false) return
      assert.ok(state.version <= STRINGS_VERSION)
      // A file behind English's strings may lack the newer ones, which show in English meanwhile.
      const isBehind = state.version < STRINGS_VERSION
      for (const [english, { text, ready }] of translations) {
        if (isBehind && !text.trim()) continue
        assert.ok(text.trim() && ready !== false, english)
        if (state.ready === true) assert.equal(ready, true, english)
      }
    })

    test(`${file} names its lists so each starts with its own letter`, () => {
      if (state.ready === false) return
      const text = translate(words, file)
      for (const list of Object.values(text.lists)) assert.equal(list.letter, firstLetter(list.name), list.name)
      assert.equal(new Set(Object.values(text.lists).map(list => list.letter)).size, Object.keys(text.lists).length)
    })
  }
})

describe('dialects', () => {
  // docket ships none now, but any added must keep the format.
  const dialects = new URL('dialects/', folder)
  for (const file of existsSync(dialects) ? readdirSync(dialects).filter(file => file.endsWith('.json')) : []) {
    const raw = readFileSync(new URL(file, dialects), 'utf8')
    const words = JSON.parse(raw) as Record<string, unknown>

    test(`dialect ${file} has a name and is in line with English`, () => {
      assert.equal(typeof words.name, 'string')
      assert.equal(raw, synced(words))
    })

    test(`dialect ${file} keeps placeholders and gives each list its own letter`, () => {
      for (const english of keysOf()) {
        const { text } = translationOf(words[english])
        if (text) assert.deepEqual(slots(text), slots(english), english)
      }
      const text = translate(words, String(words.name))
      for (const list of Object.values(text.lists)) assert.equal(list.letter, firstLetter(list.name), list.name)
    })
  }
})

describe('English', () => {
  test("gives each list its name's first letter", () => {
    for (const list of Object.values(EN.lists)) assert.equal(list.letter, firstLetter(list.name))
  })

  test('is its own translation', () => {
    assert.deepEqual(translate({}, 'English'), EN)
  })
})

describe('translate', () => {
  test('keeps English for anything missing, blank, unready or malformed', () => {
    const text = translate(
      { Lean: { text: '', ready: AI }, '+{n} more': { text: '+{n} mehr', ready: false }, fewer: 3, Questions: { text: 'Fragen', ready: true } },
      'German',
    )
    assert.equal(text.lean, 'Lean')
    assert.equal(text.more, '+{n} more')
    assert.equal(text.fewer, 'fewer')
    assert.equal(text.lists.Q.name, 'Fragen')
    assert.equal(text.lists.Q.letter, 'F')
    assert.equal(text.language, 'German')
  })

  test('takes a bare string as a machine translation', () => {
    assert.deepEqual(translationOf('Fragen'), { text: 'Fragen', ready: AI })
    assert.deepEqual(translationOf(''), { text: '', ready: false })
    assert.equal(translate({ Questions: 'Fragen' }, 'German').lists.Q.name, 'Fragen')
  })

  test('keeps every English letter when two names would share one', () => {
    const text = translate({ Questions: 'Fragen', Pinned: 'Fixiert' }, 'German')
    assert.equal(text.lists.Q.letter, 'Q')
    assert.equal(text.lists.P.letter, 'P')
  })

  test("takes a dialect's own buttons, never a translation of them", () => {
    const text = translate({ marks: { yes: '👉', no: '' }, '✔': 'nope' }, 'Starfleet English')
    assert.deepEqual(text.marks, { yes: '👉', no: '✗' })
    assert.ok(!keysOf().includes('✔'))
  })

  test('reads a file that is not an object as nothing translated', () => {
    assert.deepEqual(translate(['x'], 'English'), EN)
  })
})

describe('a file brought in line with English', () => {
  const file = JSON.parse(synced({ ready: AI, version: 1, Questions: { text: 'Fragen', ready: true }, 'Gone from English': 'x' }))

  test('starts with its state, then every English string in order', () => {
    assert.deepEqual(Object.keys(file), ['ready', 'version', ...keysOf()])
    assert.equal(file.ready, AI)
  })

  test('keeps its translations, blanks the rest and drops what English no longer says', () => {
    assert.deepEqual(file.Questions, { text: 'Fragen', ready: true })
    assert.deepEqual(file.Pinned, { text: '', ready: false })
    assert.ok(!('Gone from English' in file))
  })

  test('reads a missing state as unready and unversioned', () => {
    assert.deepEqual(stateOf(undefined), { ready: false, version: 0 })
  })
})

describe('choosing a language', () => {
  test("reads Claude Code's names for languages as well as codes", () => {
    assert.equal(codeOf('japanese'), 'ja')
    assert.equal(codeOf('Español'), 'es')
    assert.equal(codeOf('espanol'), 'es')
    assert.equal(codeOf('Deutsch'), 'de')
    assert.equal(codeOf('Japanese (日本語)'), 'ja')
    assert.equal(codeOf('quenya'), undefined)
    assert.equal(codeOf(''), undefined)
  })

  test('takes the regional language before the general one', () => {
    assert.equal(codeOf('Brazilian Portuguese'), 'pt-BR')
    assert.equal(codeOf('Portuguese'), 'pt')
    assert.equal(codeOf('pt_br'), 'pt-BR')
    assert.equal(codeOf('繁體中文'), 'zh-TW')
    assert.equal(codeOf('Chinese'), 'zh')
  })

  test('names every listed language in English first, then in its own', () => {
    assert.equal(englishName('fr'), 'French')
    assert.equal(englishName('xx'), 'xx')
    assert.equal(nativeName('fr'), 'Français')
    assert.equal(nativeName('af'), 'Afrikaans')
    assert.ok(Object.values(NAMES).every(names => names.length > 0))
  })

  test("docket's own setting wins, auto follows Claude Code, and English is the fallback", () => {
    assert.equal(resolveLanguage('de', 'japanese'), 'de')
    assert.equal(resolveLanguage('auto', 'japanese'), 'ja')
    assert.equal(resolveLanguage('auto', 'french'), 'fr')
    assert.equal(resolveLanguage(undefined, undefined), 'en')
    assert.equal(resolveLanguage('auto', 'quenya'), 'en')
  })

  test('auto takes the first hint that names a language: Claude Code, then the editor, then the locale', () => {
    assert.equal(resolveLanguage('auto', [undefined, 'de', 'fr_FR']), 'de')
    assert.equal(resolveLanguage('auto', ['japanese', 'de']), 'ja')
    assert.equal(resolveLanguage('auto', [undefined, undefined, 'fr_FR']), 'fr-FR')
    assert.equal(resolveLanguage('auto', [undefined, undefined]), 'en')
    assert.equal(resolveLanguage('es', ['de']), 'es')
  })

  test('reads VS Code\'s display language and POSIX locales', () => {
    assert.equal(localeOf('{"userLocale":"de","osLocale":"de-de","resolvedLanguage":"de"}'), 'de')
    assert.equal(localeOf('{"locale":"ja"}'), 'ja')
    assert.equal(localeOf('{broken'), undefined)
    assert.equal(localeOf('de_DE.UTF-8'), 'de_DE')
    assert.equal(localeOf('C'), undefined)
    assert.equal(localeOf('POSIX'), undefined)
    assert.equal(localeOf(undefined), undefined)
  })

  test('takes any code a file exists for, even one the table lacks', () => {
    assert.equal(resolveLanguage('xx', undefined, ['en', 'xx']), 'xx')
    assert.equal(resolveLanguage('xx', 'german', ['en']), 'de')
  })
})

describe('typing a label without its accent', () => {
  const words = (code: string) => JSON.parse(readFileSync(new URL(`${code}.json`, folder), 'utf8'))

  test('finds Turkish İ from i, and Yoruba À from a', () => {
    const tr = translate(words('tr'), 'Turkish')
    assert.equal(letterFor(tr, 'i'), 'R')
    assert.equal(idFor(tr, 'i3'), 'R3')
    assert.equal(letterFor(translate(words('yo'), 'Yoruba'), 'a'), 'R')
  })

  test("keeps letters apart where the unaccented one is another list's, as Czech Ž and Z", () => {
    const cs = translate(words('cs'), 'Czech')
    assert.equal(letterFor(cs, 'z'), 'V')
    assert.equal(letterFor(cs, 'ž'), 'R')
  })
})

describe('labels', () => {
  const es = translate(read('es.json'), 'Spanish')

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

describe('voices', () => {
  test('come from files, later ones winning list by list, by English name or letter', () => {
    const voice = voiceOf({ voice: 'a pirate', voices: { View: 'Uhura', Q: 'Sulu', Bogus: 'x' } }, { voices: { View: 'Kirk' } })
    assert.deepEqual(voice, { all: 'a pirate', lists: { V: 'Kirk', Q: 'Sulu' } })
  })

  test('tell Claude to write in character, list by list, without changing what items say', () => {
    const text = instructions(settingsOf({}), false, EN, { all: 'the Enterprise crew', lists: { V: 'Uhura' } })
    assert.match(text, /Write the docket's items in character, as the Enterprise crew; in these lists, as follows:\n- V: Uhura/)
    assert.match(text, /still say exactly what they need to/)
    assert.doesNotMatch(instructions(settingsOf({}), false, EN), /in character/)
  })

  test("tell Claude the docket's language, letters, buttons and voice with every prompt", () => {
    assert.equal(nowNote(EN, { all: '', lists: {} }), '')
    const jack = nowNote(EN, { all: 'Samurai Jack', lists: { W: 'Aku' } })
    assert.match(jack, /in character, as Samurai Jack; in these lists, as follows:\n- W \(Waiting\): Aku/)
    const es = nowNote(translate(read('es.json'), 'Spanish'), { all: '', lists: {} })
    assert.match(es, /It is in Spanish/)
    assert.match(es, /P Preguntas/)
    assert.match(es, /"Acepto la propuesta de P5\."/)
    assert.doesNotMatch(es, /in character/)
  })

  test('ask for the open items to be rewritten in a new voice, or plainly without one', () => {
    assert.match(rewriteNote(EN, { all: 'Aku', lists: {} }), /in the voice the docket instructions give/)
    assert.match(rewriteNote(EN, { all: '', lists: {} }), /Write them plainly, out of character\./)
  })

  test('keep Georgian labels in the letters its fonts draw', () => {
    assert.equal(firstLetter('თხოვნები'), 'თ')
    assert.equal(firstLetter('énfasis'), 'É')
  })
})

describe('voice files', () => {
  const voicesFolder = new URL('voices/', folder)
  for (const file of readdirSync(voicesFolder).filter(name => name.endsWith('.json'))) {
    const cast = JSON.parse(readFileSync(new URL(file, voicesFolder), 'utf8')) as Record<string, unknown>

    test(`voice ${file} has a name, a voice, and lists it knows`, () => {
      assert.equal(typeof cast.name, 'string')
      const voice = voiceOf(cast)
      assert.ok(voice.all || Object.keys(voice.lists).length)
      const names = Object.values(EN.lists).map(list => list.name)
      for (const key of Object.keys((cast.voices as Record<string, string> | undefined) ?? {})) assert.ok(names.includes(key), key)
    })

    test(`voice ${file} has the pictures its buttons name`, () => {
      for (const key of ['yes', 'no'] as const) {
        const image = markImage(cast, key)
        if (image) assert.ok(readdirSync(voicesFolder).includes(image), image)
      }
    })
  }
})

describe('codes the table lacks', () => {
  test('take their language name, and read Latin American Spanish and Chinese scripts', () => {
    assert.equal(englishName('es-ES'), 'Spanish')
    assert.equal(codeOf('es-419'), 'es-419')
    assert.equal(codeOf('zh-Hant'), 'zh-TW')
    assert.equal(codeOf('zh-hans'), 'zh')
    assert.equal(normalCode('ZH-HANT'), 'zh-Hant')
  })
})
