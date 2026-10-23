// Finding the editor that hosts the session, from where it says it's installed.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { appDirOf, exeDirsOf, exeIn, launchOf, scriptDirsOf, scriptIn } from '../hooks/editor.ts'

const NLS = JSON.stringify({
  userLocale: 'de',
  defaultMessagesFile: String.raw`C:\Users\hans\AppData\Local\Programs\Microsoft VS Code\6d62b1d5da\resources\app\out\nls.messages.json`,
})

describe('the hosting editor', () => {
  test("is found from VS Code's messages file, Windows paths or not", () => {
    assert.equal(appDirOf(NLS), 'C:/Users/hans/AppData/Local/Programs/Microsoft VS Code/6d62b1d5da/resources/app')
    assert.equal(appDirOf('{"defaultMessagesFile":"/Applications/Cursor.app/Contents/Resources/app/out/nls.json"}'), '/Applications/Cursor.app/Contents/Resources/app')
    assert.equal(appDirOf('{"userLocale":"de"}'), undefined)
    assert.equal(appDirOf('not json'), undefined)
    assert.equal(appDirOf(undefined), undefined)
  })

  test('has its executable beside resources, or one up from a versioned folder', () => {
    const app = appDirOf(NLS) ?? ''
    assert.deepEqual(exeDirsOf(app), [
      'C:/Users/hans/AppData/Local/Programs/Microsoft VS Code/6d62b1d5da',
      'C:/Users/hans/AppData/Local/Programs/Microsoft VS Code',
    ])
    assert.equal(exeIn(['unins000.exe', 'new_Code.exe', 'code-tunnel.exe', 'Code.exe']), 'Code.exe')
    assert.equal(exeIn(['Cursor.exe']), 'Cursor.exe')
    assert.equal(exeIn(['LICENSE', 'ffmpeg.dll']), undefined)
  })

  test('opens a file as its own code script does, with no shell', () => {
    assert.deepEqual(launchOf('C:/VS/Code.exe', 'C:/VS/1/resources/app', 'C:/R&D/a.php'), {
      argv: ['C:/VS/Code.exe', 'C:/VS/1/resources/app/out/cli.js', '-r', 'C:/R&D/a.php'],
      env: { ELECTRON_RUN_AS_NODE: '1' },
    })
  })

  test('on macOS and Linux, runs its own launcher script', () => {
    assert.deepEqual(scriptDirsOf('/usr/share/code/resources/app'), ['/usr/share/code/resources/app/bin', '/usr/share/code/bin'])
    assert.equal(scriptIn(['code-tunnel', 'code.sh', 'code']), 'code')
  })
})
