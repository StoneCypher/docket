// Unit tests for the main-screen notice's logic, under Node's own runner (`npm test`). Drawing it
// needs the engine: those are in tests/docket.test.tsx.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { EN, translate } from '../hooks/i18n.ts'
import { isMainScreen, mainScreenLines } from '../hooks/screen.ts'

describe('isMainScreen', () => {
  test('is true only for an interactive terminal on the main screen', () => {
    assert.equal(isMainScreen({ surface: 'terminal', isInteractive: true, isFullscreen: false }), true)
    assert.equal(isMainScreen({ surface: 'terminal', isInteractive: true, isFullscreen: true }), false)
    assert.equal(isMainScreen({ surface: 'terminal', isInteractive: false, isFullscreen: false }), false)
  })

  test('says nothing where the layout is unreported', () => {
    assert.equal(isMainScreen({ surface: 'terminal', isInteractive: true, isFullscreen: undefined }), false)
  })

  test('leaves every other surface alone, whatever it reports', () => {
    for (const surface of ['desktop', 'vscode', 'mobile', '']) {
      assert.equal(isMainScreen({ surface, isInteractive: true, isFullscreen: false }), false, surface)
    }
  })
})

describe('mainScreenLines', () => {
  test('says why, how to switch and back, and what stops a switch', () => {
    assert.deepEqual(mainScreenLines(EN), [
      "Buttons in mods only work in Claude Code's fullscreen layout.",
      'To switch, type /tui fullscreen. It saves the setting and relaunches with the conversation intact. /tui default switches back.',
      'The switch is refused while background work is running ("Cannot switch renderers while work is running in the background"), so wait for that work to finish, or stop it in /tasks, first.',
    ])
  })

  test('is English until a language translates it, and keeps the commands as they are', () => {
    const untranslated = translate({}, 'German')
    assert.deepEqual(mainScreenLines(untranslated), mainScreenLines(EN))
    const de = translate(
      { 'To switch, type {fullscreen}. It saves the setting and relaunches with the conversation intact. {back} switches back.': { text: 'Tippe {fullscreen}; {back} schaltet zurück.', ready: true } },
      'German',
    )
    assert.equal(mainScreenLines(de)[1], 'Tippe /tui fullscreen; /tui default schaltet zurück.')
  })
})
