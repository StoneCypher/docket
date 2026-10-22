// `npm run locales`: gives every language docket knows a file in locales/, and brings each file in
// line with English's strings, keeping every translation it has. Run it after changing English.
// Name codes (`npm run locales -- fr de`) to touch only those files.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'

import { synced } from '../hooks/i18n.ts'
import { NAMES } from '../hooks/languages.ts'

const folder = new URL('../locales/', import.meta.url)
let changed = 0
const only = process.argv.slice(2)
for (const code of Object.keys(NAMES).filter(code => code !== 'en' && (!only.length || only.includes(code)))) {
  const file = new URL(`${code}.json`, folder)
  const before = existsSync(file) ? readFileSync(file, 'utf8') : ''
  const after = synced(before ? JSON.parse(before) : { ready: false, version: 0 })
  if (after !== before) {
    writeFileSync(file, after)
    changed += 1
  }
}
// Dialects, in locales/dialects/, are kept in line too, but none is ever made here: each is someone's idea.
const dialects = new URL('dialects/', folder)
if (!only.length && existsSync(dialects)) {
  for (const name of readdirSync(dialects).filter(name => name.endsWith('.json'))) {
    const file = new URL(name, dialects)
    const before = readFileSync(file, 'utf8')
    const after = synced(JSON.parse(before))
    if (after !== before) {
      writeFileSync(file, after)
      changed += 1
    }
  }
}
console.log(`${changed} language file${changed === 1 ? '' : 's'} updated`)
