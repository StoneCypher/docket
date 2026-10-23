// Which editor to open a file in: the one hosting the session, found from where it's installed, not
// whatever answers to `code` on PATH (another editor's installer may have put its own `code` there).
// VS Code and its forks tell the processes they start where their app lives, in VSCODE_NLS_CONFIG.

// The editor's app folder, ".../resources/app", from VSCODE_NLS_CONFIG's messages file.
export const appDirOf = (nlsConfig: unknown) => {
  try {
    const { defaultMessagesFile } = JSON.parse(String(nlsConfig ?? '')) as { defaultMessagesFile?: unknown }
    const path = String(defaultMessagesFile ?? '').replace(/\\/g, '/')
    // macOS spells it Resources.
    const at = path.toLowerCase().lastIndexOf('/resources/app/')

    return at < 0 ? undefined : path.slice(0, at + '/resources/app'.length)
  } catch {
    return undefined
  }
}

const parentOf = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/')))

// The folders an editor's executable may sit in, nearest first: beside resources/ (the old Windows
// layout, and Linux), and one up from a versioned folder (the new Windows layout, <root>/<commit>/).
export const exeDirsOf = (appDir: string) => {
  const resources = parentOf(appDir)
  const beside = parentOf(resources)

  return [beside, parentOf(beside)].filter(Boolean)
}

// The editor's own executable among a folder's files: not its uninstaller, tunnel or staged update.
export const exeIn = (names: readonly string[]) =>
  names.find(name => /\.exe$/i.test(name) && !/^(unins|new_)/i.test(name) && !/tunnel/i.test(name))

// The command that opens a file in that editor, reusing its window, as its own `code` script does:
// the executable running its CLI as Node.
export const launchOf = (exe: string, appDir: string, path: string) => ({
  argv: [exe, `${appDir}/out/cli.js`, '-r', path],
  env: { ELECTRON_RUN_AS_NODE: '1' },
})

// On macOS and Linux, the editor's own launcher script: in app/bin (macOS) or <root>/bin (Linux).
export const scriptDirsOf = (appDir: string) => [`${appDir}/bin`, `${parentOf(parentOf(appDir))}/bin`]

export const scriptIn = (names: readonly string[]) => names.find(name => !/[.]/.test(name) && !/tunnel/i.test(name))
