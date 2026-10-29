# docket

Claude produces more than a person can keep up with. Questions get buried in long replies, things it's waiting on you for scroll away, and you miss stuff. Docket keeps every open thread between you and Claude in numbered lists in a pane beside the chat, so you can answer by label (`q10 yes`, `c3-c5 confirmed`, `accept all other leans`) or with one click.

## Install

At the prompt of a Claude Code session, add docket's marketplace, then install it from there:

```
/plugin marketplace add StoneCypher/docket
```

```
/plugin install docket@docket
```

Pick a scope when asked. From a shell instead, `claude plugin marketplace add StoneCypher/docket` then `claude plugin install docket@docket`.

docket is also listed in [StoneCypher/claude-plugins](https://github.com/StoneCypher/claude-plugins), alongside StoneCypher's other plugins: `/plugin marketplace add StoneCypher/claude-plugins`, then `/plugin install docket@stonecypher`.

## The lists

In the pane, the most important list comes first:

| Letter | List | What's in it |
| --- | --- | --- |
| R | Requests | Things Claude wants to do on its own initiative. It waits for your ✔ or ✗. |
| Q | Questions | Decisions only you can make. Each has a lean: the answer Claude would pick. |
| C | Confirm | Claude checking that it read you right, or making sure you know something risky is coming. |
| N | Needs you | Things only you can do: consoles, accounts, hardware. |
| V | Verify | Things for you to check: that a change works, reads right or looks right. |
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

Claude can do all of this for you too: ask it to clear a list, press a button or close the pane.

### The terminal needs the fullscreen layout

Buttons work only in Claude Code's fullscreen terminal layout. The regular (main-screen) layout reports no mouse clicks, and it draws the pane inline above the prompt rather than docked beside the transcript; a pane docks only in fullscreen, from 110 columns. So on a main-screen terminal, docket shows a short notice in place of its pane and band: type `/tui fullscreen` to switch. That saves the setting and relaunches with the conversation intact, and `/tui default` switches back. Claude Code refuses the switch while background work is running ("Cannot switch renderers while work is running in the background"), so wait for that work to finish, or stop it in `/tasks`, first. `/docket` says the same there.

The desktop app, VS Code, the phone, and fullscreen terminals are unchanged, as is a remote surface that hasn't yet said which layout it's in. The notice's words are in the language files with the rest of docket's; they show in English until each language translates them.

## Claude's tool

Claude keeps the docket with one tool, `mcp__docket__update`. Everything in one call:

| Field | What it does |
| --- | --- |
| `add` | Adds items to a list, by letter. The tool assigns the labels and returns them. |
| `change` | Corrects an item, by label. A changed item gets its buttons back. |
| `close` | Closes items, by label; `unasked` marks one Claude closed on its own judgment. |
| `clear` | Clears lists, by letter, or `"all"`: what a heading's ✕ does. It runs before `add`, so a clear and an add start the docket afresh. |
| `press` | Presses an item's button, by label and button: `yes` (✔), `no` (✗), an option's own label, `start` (🏗️), `open` (👁️) or `clear` (🗑️). Only the buttons the item shows now can be pressed. |
| `pane` | `open` opens the pane; `close` closes it the way your close does, so it stays closed, the band with it, until `/docket` or Claude opens it again. |
| `language` | The language Claude hears you write in, when docket asks for it. |

A press goes through the same code as your click. The row is answered at once, and a press on docket's own items acts at once: ✔ on the offer to create docket's config writes the config, as your ✔ does. A press on one of Claude's own items sends the same message your click sends, as you, but only once Claude's turn ends, as a prompt can't start while the tool call holds the turn. Several presses in one turn go as one prompt. Claude is told to press its own items' buttons only when you ask.

A pane Claude opens without your asking is placed only on a terminal at least 144 columns wide; `/docket` places it at any width.

### When Claude doesn't have the tool

docket registers the tool with `$.tool.register` when the session starts, and asks for it to be listed up front (`isDeferred: false`), not behind ToolSearch. Two things follow:

- **ToolSearch never finds it.** ToolSearch looks only through deferred tools, so a search for "docket" comes back empty whether the tool is there or not. That alone doesn't mean it's missing.
- **It arrives with the next prompt.** Claude Code runs a plugin's `session.start` once before the first prompt, and waits for it, so the tool is there from the first turn. It runs it again whenever the plugin loads afresh: installed or enabled mid-session, reloaded with `/reload-plugins` after a change, or restarted after its worker was lost. A tool registered then is callable from the next prompt on, not in the turn already running.

Before 0.6.0, docket registered the tool partway through its start, after `/docket`, its version and its config paths. If any of those failed, the tool never arrived, and nothing tried again, so the whole session went without it. That's the likeliest cause of a mid-session install that never gave Claude the tool, though it hasn't been reproduced. Now docket registers the tool first, before anything that can fail. At each prompt it checks the tools Claude has (`$.tool.list()`) and registers its own again if it's missing. A start that didn't finish is tried again at the next prompt.

If the tool is still missing, send one more prompt after `/reload-plugins`, or start a new session, which always registers it before the first turn. Subagents are a separate case: one Claude starts may be given a tool list without docket's, even while the main conversation has it.

## Settings

Settings live in `~/.claude/docket/config.json`, a versioned JSON file with every setting written out. A project can have its own `.claude/docket/config.json`, whose settings win. The first time docket runs without one, the pane offers to create yours with the defaults; when docket adds settings, it updates the file in place and tells you in Verify. Edit the file directly, or use ⚙ at the bottom of the pane:

- `language`: `auto` (the default) follows Claude Code's language setting, then VS Code's display language, then the terminal's locale, then the language Claude hears you write in; or a language code with a file in `locales/`, such as `es`, `ja` or `de`
- `turnReview`: whether the **Deep dive** switch, at the pane's bottom left, starts each session on (it does by default); the switch decides from then on. With it on, each prompt quietly asks Claude, before it ends the turn, to go back over it once for decisions it made on your behalf and threads it left open, and to add them to the docket. You never see that request. Only if a turn you started ends with a reply that speaks of pending work while the docket stayed as it was does Claude get sent back, visibly, once. Turns started by a task notification, a wakeup or another background event are never sent back.
- `updateCheck`: on by default. Once a day docket reads its `plugin.json` on GitHub, its only outside request, and says in Verify when a newer version is out. Off stops the request too.
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

A language can also end in a dialect, as BCP 47 tags end in a variant (`en-US-something`): a file in `locales/dialects/` with its own `"name"` and `"tag"`, laying its words over English and listed below the real Englishes in the picker. docket ships none; the novelty lives in voices.

**Voices** are their own setting, in any language: a character Claude writes the docket's items as. The casts live in `locales/voices/` (Star Trek, Samurai Jack, Yinzer, Hackerman), each a `"voice"` for every item and `"voices"` per list by English name, and each may bring its own ✔ and ✗, as text or a picture: Star Trek has Uhura on Verify, Chekov on Underway and Sulu on Questions, with 👉 and 🤦; Samurai Jack has Aku gloating over Waiting, with a katana and Aku. Pick one in ⚙, or write a character into the config's `"voice"`, such as `"drunk Optimus Prime"`. When the language or voice changes, Claude rewrites the open items to match.

When English changes, `STRINGS_VERSION` in `hooks/i18n.ts` goes up and `npm run locales` brings every file in line: new strings arrive blank, and strings English no longer says are dropped. `npm test` checks that each file is in line, keeps every placeholder, is no readier than its strings, and gives each list its own letter.

## Development

- `npm test` runs the unit tests for the pure logic (`hooks/lists.ts`, `hooks/config.ts`, `hooks/i18n.ts`, `hooks/languages.ts`, `hooks/buttons.ts`, `hooks/screen.ts`) and the language files under Node's own test runner, with coverage: it fails below 80% of lines, branches or functions. Needs Node 23.6 or later, which runs TypeScript directly.
- `npm run test:mod` runs the hooks and pane tests (`tests/*.test.tsx`) inside Claude Code's engine, on every surface.
- `npm run validate` checks the manifest, the marketplace file and the hooks module the way Claude Code loads them.

## How it works

Docket is a Claude Code mod. It adds its rules to Claude's system prompt, gives Claude one tool for adding, changing and closing items (and for clearing lists, pressing buttons and opening or closing the pane), sends Claude the current docket with each of your prompts (with any labels you mention expanded), and draws the lists in a pane. If Claude's reply talks about pending work without updating the docket, your next prompt reminds it to reconcile.
