// The language picker in the ⚙ view: three pulldowns, as a pulldown holds at most 64 choices and docket
// knows more languages than that. A group of initials, then a language in it, then its variant: a
// region with a file of its own, or a dialect. Every name is in the language docket speaks.
import { NAMES, englishName, nativeName } from './languages.ts'

export type Choice = { value: string; label: string }
export type Group = Choice & { codes: string[] }
export type Dialect = { tag: string; name: string }

// A language's name in another, from the runtime's own names where it has them, else the table's.
export const nameIn = (speaking: string, code: string) => {
  try {
    const named = new Intl.DisplayNames([speaking], { type: 'language' }).of(code)
    // A runtime without names for a language answers in English, or with the code itself.
    const isMissing = speaking !== 'en' && speaking.split('-')[0] !== 'en' && named === englishName(code)
    if (named && named.toLowerCase() !== code.toLowerCase() && !isMissing) return named
  } catch {
    // No names for that language here.
  }

  return speaking === code ? nativeName(code) : englishName(code)
}

// "Französisch (français)": the name in the language docket speaks, then the language's own, when they differ.
export const labelFor = (speaking: string, code: string) => {
  const own = nameIn(speaking, code)
  const native = nameIn(code, code)

  return native.toLowerCase() === own.toLowerCase() ? own : `${own} (${native})`
}

const initial = (label: string) => ([...label.normalize('NFD').replace(/\p{M}/gu, '')][0] ?? '').toUpperCase()

// The languages docket knows by their base code ("pt", not "pt-BR"), with any that only have a file.
export const basesOf = (files: readonly string[] = []) =>
  [...new Set([...Object.keys(NAMES), ...files].map(code => code.split('-')[0] ?? code))].filter(Boolean)

// The most a pulldown holds is 64; the language pulldown keeps a little under.
export const MOST = 60

// About `count` groups of about the same size, sorted as the language docket speaks sorts, never
// splitting an initial between two groups unless the initial alone is more than a pulldown holds.
// Each is labelled by its first and last initials ("A–D"), or two letters where an initial is split.
export const groupsOf = (speaking: string, codes: readonly string[], count = 6): Group[] => {
  const labelled = codes.map(code => ({ code, label: labelFor(speaking, code) }))
  labelled.sort((a, b) => a.label.localeCompare(b.label, speaking))
  const prefix = (label: string, length: number) => [...label.normalize('NFD').replace(/\p{M}/gu, '')].slice(0, length).join('')
  const buckets: { first: string; last: string; codes: string[] }[] = []
  for (const { code, label } of labelled) {
    const first = initial(label)
    const last = buckets[buckets.length - 1]
    if (last?.first === first) last.codes.push(code)
    else buckets.push({ first, last: first, codes: [code] })
  }
  const named = new Map(labelled.map(({ code, label }) => [code, label]))
  const pieces = buckets.flatMap(bucket => {
    if (bucket.codes.length <= MOST) return [bucket]
    const size = Math.ceil(bucket.codes.length / Math.ceil(bucket.codes.length / MOST))
    const out = []
    for (let i = 0; i < bucket.codes.length; i += size) {
      const slice = bucket.codes.slice(i, i + size)
      const two = (code: string | undefined) => {
        const word = prefix(named.get(code ?? '') ?? '', 2)

        return word.charAt(0).toUpperCase() + word.slice(1)
      }
      out.push({ first: two(slice[0]), last: two(slice[slice.length - 1]), codes: slice })
    }

    return out
  })
  const groups: Group[] = []
  let left = labelled.length
  let current: { first: string; last: string; codes: string[] } | undefined
  pieces.forEach((piece, i) => {
    const wouldBe = (current?.codes.length ?? 0) + piece.codes.length
    if (current && wouldBe > MOST) {
      groups.push({ value: `group-${groups.length}`, label: current.first === current.last ? current.first : `${current.first}–${current.last}`, codes: current.codes })
      left -= current.codes.length
      current = undefined
    }
    current = current ? { first: current.first, last: piece.last, codes: [...current.codes, ...piece.codes] } : { ...piece, codes: [...piece.codes] }
    const target = left / Math.max(1, count - groups.length)
    if (current.codes.length >= target || i === pieces.length - 1) {
      groups.push({ value: `group-${groups.length}`, label: current.first === current.last ? current.first : `${current.first}–${current.last}`, codes: current.codes })
      left -= current.codes.length
      current = undefined
    }
  })

  return groups
}

// The regions people speak a language in, offered whether or not docket has a file for them yet: one
// without a file speaks its language's, until someone writes it.
export const REGIONS: Record<string, readonly string[]> = {
  en: ['US', 'GB', 'AU', 'CA', 'IE', 'NZ', 'IN', 'ZA'],
  es: ['ES', 'MX', 'AR', 'CO', 'CL', 'US'],
  pt: ['PT', 'BR'],
  fr: ['FR', 'CA', 'BE', 'CH'],
  de: ['DE', 'AT', 'CH'],
  zh: ['CN', 'TW', 'HK'],
  nl: ['NL', 'BE'],
  ar: ['SA', 'EG', 'MA'],
}

// A language's variants, as the rest of its tag: (none), then its real regions, from the table and
// any with a file ("BR"), then its dialects ("US-startrek"), named in the language docket speaks.
export const variantsOf = (speaking: string, base: string, files: readonly string[], dialects: readonly Dialect[]): Choice[] => {
  const regions = [
    ...new Set([...(REGIONS[base] ?? []), ...files.filter(code => code.startsWith(`${base}-`)).map(code => code.slice(base.length + 1))]),
  ]
    .map(region => ({ value: region, label: nameIn(speaking, `${base}-${region}`) }))
    .sort((a, b) => a.label.localeCompare(b.label, speaking))

  return [
    { value: '', label: '—' },
    ...regions,
    ...dialects.filter(each => each.tag.startsWith(`${base}-`)).map(each => ({ value: each.tag.slice(base.length + 1), label: each.name })),
  ]
}

// A language setting read back into the pulldowns: its base and the rest of its tag.
export const pickedOf = (setting: unknown) => {
  const text = String(setting ?? '').trim()
  if (!text || text === 'auto') return { base: 'auto', variant: '' }
  const [base = '', ...rest] = text.split(/[-_]/)

  return { base: base.toLowerCase(), variant: rest.join('-') }
}
