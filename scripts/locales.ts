// `npm run locales`: gives every language docket knows a file in locales/, and brings each file in
// line with English's strings, keeping every translation it has. Run it after changing English.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

import { synced } from '../hooks/i18n.ts'
import { NAMES } from '../hooks/languages.ts'

const folder = new URL('../locales/', import.meta.url)
let changed = 0
for (const code of Object.keys(NAMES).filter(code => code !== 'en')) {
  const file = new URL(`${code}.json`, folder)
  const before = existsSync(file) ? readFileSync(file, 'utf8') : ''
  const after = synced(before ? JSON.parse(before) : { ready: false, version: 0 })
  if (after !== before) {
    writeFileSync(file, after)
    changed += 1
  }
}
console.log(`${changed} language file${changed === 1 ? '' : 's'} updated`)
