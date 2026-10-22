# docket

Claude produces more than a person can keep up with. Questions get buried in long replies, things it's waiting on you for scroll away, and you miss stuff. Docket keeps every open thread between you and Claude in numbered lists in a pane beside the chat, so you can answer by label (`q10 yes`, `c3-c5 confirmed`, `accept all other leans`) or with one click.

## Install

At the prompt of a Claude Code session:

```
/plugin install docket --marketplace StoneCypher/docket
```

Answer `y` to add the marketplace, then pick a scope.

docket is also listed in [StoneCypher/claude-plugins](https://github.com/StoneCypher/claude-plugins), alongside StoneCypher's other plugins: `/plugin marketplace add StoneCypher/claude-plugins`, then `/plugin install docket@stonecypher`. From a shell instead:

```
claude plugin install docket --marketplace StoneCypher/docket
```

## The lists

In the pane, the most important list comes first:

| Letter | List | What's in it |
| --- | --- | --- |
| R | Requests | Things Claude wants to do on its own initiative. It waits for your ✔ or ✗. |
| Q | Questions | Decisions only you can make. Each has a lean: the answer Claude would pick. |
| C | Confirm | Claude checking that it read you right, or making sure you know something risky is coming. |
| N | Needs you | Things only you can do: consoles, accounts, hardware. |
| V | View | Things for you to look at or check. |
| U | Underway | Claude's work in progress. |
| L | Later | Claude's work that's decided but not started, in order. |
| W | Waiting | Things stalled on something other than you. |
| P | Pinned | Parked for later, drawn on one line. |

Numbers only ever go up, so `Q12` always means the same question. Unchanged items are dimmed and new ones are marked.

## Buttons

- **✔ / ✗** on a lean, a request or a confirm item answers it. The row dims at once and leaves about 20 seconds later.
- **🗑️** on an item clears just that item. **✕** on a heading clears the whole list. Clearing only empties the display: it never cancels work, answers a question or approves a request.
- **Accept all leans**, **Confirm all** and **Approve all** answer a whole list.
- **⚙** at the bottom of the pane opens the settings.

`/docket` reopens the pane if you close it.

## Settings

Settings live in `~/.claude/docket/config.json`, a versioned JSON file with every setting written out. A project can have its own `.claude/docket/config.json`, whose settings win. The first time docket runs without one, the pane offers to create yours with the defaults; when docket adds settings, it updates the file in place and tells you in View. Edit the file directly, or use ⚙ at the bottom of the pane:

- `language`: `auto` (the default) follows Claude Code's language setting; or a language code with a file in `locales/`, such as `es`, `ja` or `de`
- `display`: `pane` beside the chat (the default), or `band` above the prompt
- a cap for each list (7 by default) before "+N more"
- `itemColor`, `itemDimColor`, `leanColor`, `leanDimColor`: hex colors or theme keys
- `emoji`, `headingEmoji`, `noItemEmojiLists`: emoji on or off, overall or per list
- `stakesDisplay`: `emoji`, `text` or `none`
- `inlineLists`, `targetWords`: which lists draw on one line, and soft word limits per list
- `answeredLingerSeconds`, `strikeLingerMinutes`: how long answered and auto-closed items stay up

## Languages

docket speaks English, Spanish, Japanese and German: the headings, buttons, settings, and the messages its buttons send. Each language names its lists so each starts with its own letter, and items are labeled with those letters, so a Spanish question is P12 under Preguntas, and a Japanese one is 質12 under 質問. Claude is told to write items in the same language. The config file keeps docket's internal English letters, whatever the language.

Every language but English is one JSON file in [`locales/`](locales), mapping each English string to its translation, so translating docket needs no code. Each translation, and the file as a whole, says how ready it is: `false` (not translated, so English shows), `"ai translated"`, or `true` (checked by a person):

```json
{
  "ready": "ai translated",
  "version": 1,
  "Questions": { "text": "Preguntas", "ready": true },
  "Accept the lean on {id}.": { "text": "Acepto la propuesta de {id}.", "ready": "ai translated" }
}
```

docket uses any file not marked `false`. A list's letter is the first character of its translated name, so name the lists to start with different letters, and keep anything in `{braces}` as it is. A regional file, such as `es-MX.json`, holds only what differs from `es.json`.

Every language docket recognizes already has a file, so helping means editing one: open it on GitHub, press the pencil, fill in or fix each `text`, set its `ready`, and commit. GitHub copies docket to your account and offers to open a pull request. When Claude Code is set to a language whose file isn't ready, machine-translated, or behind English, docket asks once, in Requests, whether you'd like to help, and its ✔ opens that file in GitHub's editor.

When English changes, `STRINGS_VERSION` in `hooks/i18n.ts` goes up and `npm run locales` brings every file in line: new strings arrive blank, and strings English no longer says are dropped. `npm test` checks that each file is in line, keeps every placeholder, is no readier than its strings, and gives each list its own letter.

## Development

- `npm test` runs the unit tests for the pure logic (`hooks/lists.ts`, `hooks/config.ts`, `hooks/i18n.ts`, `hooks/languages.ts`) and the language files under Node's own test runner, with coverage: it fails below 80% of lines, branches or functions. Needs Node 23.6 or later, which runs TypeScript directly.
- `npm run test:mod` runs the hooks and pane tests (`tests/*.test.tsx`) inside Claude Code's engine, on every surface.
- `npm run validate` checks the manifest, the marketplace file and the hooks module the way Claude Code loads them.

## How it works

Docket is a Claude Code mod. It adds its rules to Claude's system prompt, gives Claude one tool for adding, changing and closing items, sends Claude the current docket with each of your prompts (with any labels you mention expanded), and draws the lists in a pane. If Claude's reply talks about pending work without updating the docket, your next prompt reminds it to reconcile.
