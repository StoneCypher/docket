// `npm run release -- 0.2.4`: sets docket's version in plugin.json and package.json, and stamps today's
// date into hooks/release.ts as the build date the settings view shows. Run it for every change shipped.
import { readFileSync, writeFileSync } from 'node:fs'

const version = process.argv[2] ?? ''
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('usage: npm run release -- <major.minor.patch>')
  process.exit(1)
}

const root = new URL('../', import.meta.url)
for (const file of ['.claude-plugin/plugin.json', 'package.json']) {
  const path = new URL(file, root)
  const text = readFileSync(path, 'utf8')
  writeFileSync(path, text.replace(/"version": "[^"]*"/, `"version": "${version}"`))
}

const today = new Date().toISOString().slice(0, 10)
writeFileSync(
  new URL('hooks/release.ts', root),
  `// Written by \`npm run release\`: the day this version was cut, shown in the settings view.\nexport const BUILT = '${today}'\n`,
)
console.log(`docket ${version}, built ${today}`)
