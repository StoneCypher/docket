// docket's own config: a versioned JSON file in ~/.claude/docket/, and optionally the same file in a
// project's .claude/docket/, whose keys win. Every key is always written, at its default if unset.
import type { PluginOptions } from 'claude-code'

// Raise this whenever FIELDS changes, and say what changed in MIGRATIONS.
export const CONFIG_VERSION = 3

export type FieldKind = 'number' | 'boolean' | 'choice' | 'text'
export type Field = { kind: FieldKind; title: string; description: string; default: string | number | boolean; options?: string[] }

export const FIELDS: Record<string, Field> = {
  language: { kind: 'choice', title: "Language", description: "Language of the docket's own words: auto follows Claude Code's language setting", default: "auto", options: ["auto", "en", "es", "ja", "de"] },
  voice: { kind: 'text', title: "Voice", description: "A character Claude writes the docket's items as, in any language", default: "" },
  display: { kind: 'choice', title: "Display", description: "A pane beside the transcript, or a band above the prompt", default: "pane", options: ["pane", "band"] },
  pinnedCap: { kind: 'number', title: "Pinned cap", description: "Items shown in pinned before \"+N more\"", default: 7 },
  waitingCap: { kind: 'number', title: "Waiting cap", description: "Items shown in waiting before \"+N more\"", default: 7 },
  laterCap: { kind: 'number', title: "Later cap", description: "Items shown in Later before \"+N more\"", default: 7 },
  underwayCap: { kind: 'number', title: "Underway cap", description: "Items shown in underway before \"+N more\"", default: 7 },
  viewCap: { kind: 'number', title: "View cap", description: "Items shown in view before \"+N more\"", default: 7 },
  needsYouCap: { kind: 'number', title: "Needs you cap", description: "Items shown in needs you before \"+N more\"", default: 7 },
  confirmCap: { kind: 'number', title: "Confirm cap", description: "Items shown in confirm before \"+N more\"", default: 7 },
  questionsCap: { kind: 'number', title: "Questions cap", description: "Items shown in questions before \"+N more\"", default: 7 },
  requestsCap: { kind: 'number', title: "Requests cap", description: "Items shown in requests before \"+N more\"", default: 7 },
  emoji: { kind: 'boolean', title: "Emoji", description: "Master switch for every emoji the docket draws", default: true },
  headingEmoji: { kind: 'boolean', title: "Heading emoji", description: "An emoji before each list's heading", default: false },
  noItemEmojiLists: { kind: 'text', title: "Lists without item emoji", description: "Letters of lists whose items draw no emoji, e.g. \"Q,P\"", default: "" },
  inlineLists: { kind: 'text', title: "Inline lists", description: "Letters of lists drawn on one line, separated by dots", default: "P" },
  targetWords: { kind: 'text', title: "Target lengths", description: "Soft word limits per list, e.g. \"P=8,Q=30\"", default: "P=8" },
  stakesDisplay: { kind: 'choice', title: "Stakes display", description: "How stakes markers show", default: "emoji", options: ["emoji", "text", "none"] },
  itemColor: { kind: 'text', title: "Item color", description: "Color of an item changed this turn, a hex or a theme key", default: "#e0e0e0" },
  itemDimColor: { kind: 'text', title: "Dimmed item color", description: "Color of an item unchanged since the last turn", default: "#939393" },
  upArrowColor: { kind: 'text', title: "Growing arrow", description: "Color of the ↑ when a list grew this turn", default: "#5fb878" },
  upNumberColor: { kind: 'text', title: "Growing number", description: "Color of the count beside a growing list's ↑", default: "#7c9a84" },
  downArrowColor: { kind: 'text', title: "Shrinking arrow", description: "Color of the ↓ when a list shrank this turn", default: "#a885e6" },
  downNumberColor: { kind: 'text', title: "Shrinking number", description: "Color of the count beside a shrinking list's ↓", default: "#8f83a8" },
  leanColor: { kind: 'text', title: "Lean color", description: "Color of the lean line, a hex or a theme key; empty for the item's own color", default: "#b1b1b1" },
  leanDimColor: { kind: 'text', title: "Dimmed lean color", description: "Color of the lean line while its item is dimmed as unchanged", default: "#757575" },
  answeredLingerSeconds: { kind: 'number', title: "Answered linger", description: "Seconds an item answered by button stays up, dimmed, before it goes", default: 20 },
  strikeLingerMinutes: { kind: 'number', title: "Strike linger", description: "Minutes an item Claude closed on its own stays up struck through", default: 3 },
}

// What each version added, for the note a migration leaves in View.
export const MIGRATIONS: Record<number, string> = {
  1: 'the first versioned config',
  2: 'adds language',
  3: 'adds voice',
}

export type ConfigFile = { version: number } & Record<string, string | number | boolean>

export const defaults = (): ConfigFile => {
  const config: ConfigFile = { version: CONFIG_VERSION }
  for (const [key, field] of Object.entries(FIELDS)) {
    config[key] = field.default
  }

  return config
}

export type Migration = { config: ConfigFile; from: number; added: string[]; isChanged: boolean }

// Brings a config read from disk up to date: every missing key gets its default, unknown keys are
// kept, and the version is raised. A file that isn't an object starts over from the defaults.
// A project's file holds only what it overrides, so it's raised in version but never filled in.
export const migrate = (raw: unknown, isPartial = false): Migration => {
  const found = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const from = typeof found.version === 'number' ? found.version : 0
  const config: ConfigFile = { ...(found as ConfigFile), version: Math.max(from, CONFIG_VERSION) }
  const added: string[] = []
  for (const [key, field] of Object.entries(FIELDS)) {
    if (!(key in found) && !isPartial) {
      config[key] = field.default
      added.push(key)
    }
  }

  return { config, from, added, isChanged: added.length > 0 || from < CONFIG_VERSION }
}

// The settings in force: the project's keys over the user's, both over the defaults.
export const merged = (user?: ConfigFile, project?: ConfigFile): PluginOptions => {
  const options: Record<string, string | number | boolean> = {}
  for (const [key, field] of Object.entries(FIELDS)) {
    options[key] = project?.[key] ?? user?.[key] ?? field.default
  }

  return options
}

// The file as written: version first, then every field in order, then any keys it kept.
export const serialize = (config: ConfigFile) => {
  const ordered: Record<string, unknown> = { version: config.version }
  for (const key of Object.keys(FIELDS)) ordered[key] = config[key]
  for (const [key, value] of Object.entries(config)) if (!(key in ordered)) ordered[key] = value

  return `${JSON.stringify(ordered, null, 2)}
`
}

// Parses a config file's text; a file that doesn't parse reads as missing.
export const parse = (text: string | undefined): unknown => {
  if (text === undefined) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}
