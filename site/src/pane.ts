// Static replicas of docket's pane in VS Code, one per state the page explains.
// Each is drawn at build time from the same markup rules the real pane follows.

export type Item = {
  id: string
  emoji: string
  text: string
  lean?: string
  // Up to three option labels; a question's lean row shows them in place of ✔ and ✗.
  options?: string[]
  // The answer sent: the row is dimmed and struck through, its buttons replaced by this mark.
  sent?: string
  // Closed by Claude on its own: struck through in gray for a few minutes.
  isLingering?: boolean
  isNew?: boolean
  // Unchanged since the last turn.
  isDim?: boolean
}

export type List = {
  name: string
  counter: string
  bulk?: string
  // Confirm items and requests carry ✔ and ✗ on their own line.
  hasAnswers?: boolean
  isInline?: boolean
  items: Item[]
}

const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const buttons = (item: Item, labels: string[]) =>
  item.sent !== undefined
    ? `<span class="mark">${escape(item.sent)}</span>`
    : `<span class="pair">${labels.map(label => `<span class="qbtn">${escape(label)}</span>`).join('')}</span>`

const row = (item: Item, list: List) => {
  const isSent = item.sent !== undefined
  const classes = ['item', item.isDim || isSent || item.isLingering ? 'dim' : '', isSent || item.isLingering ? 'struck' : '']
  const tail = item.isNew && !isSent ? ' <span class="new">(new)</span>' : ''
  const side = item.isLingering
    ? ''
    : `${list.hasAnswers ? buttons(item, ['✔', '✗']) : ''}<span class="qbtn">🗑️</span>`

  return `
    <div class="${classes.filter(Boolean).join(' ')}">
      <div class="line"><span class="text"><b>${item.id}.</b> ${item.emoji} ${escape(item.text)}${tail}</span><span class="side">${side}</span></div>
      ${
        item.lean
          ? `<div class="lean"><span><b>Lean</b>: ${escape(item.lean)}</span><span class="side">${buttons(item, item.options ?? ['✔', '✗'])}</span></div>`
          : ''
      }
    </div>`
}

export const render = (lists: List[], options: { isGear?: boolean } = {}) => `
  <div class="pane-title"><span>Docket</span><span aria-hidden="true">✕</span></div>
  <div class="attr">From the docket plugin</div>
  ${lists
    .map(
      list => `
    <div class="list">
      <div class="head"><b>${list.name}</b> <span class="count">${escape(list.counter)}</span><span class="ctrls">${
        list.bulk ? `<span class="btn">${list.bulk}</span>` : ''
      }<span class="qbtn">✕</span></span></div>
      ${
        list.isInline
          ? `<div class="inline">${list.items.map(item => `<span><b>${item.id}</b> ${item.emoji} ${escape(item.text)}</span>`).join(' · ')}</div>`
          : list.items.map(item => row(item, list)).join('')
      }
    </div>`,
    )
    .join('')}
  ${options.isGear ? '<div class="gear"><span class="qbtn">⚙️</span></div>' : ''}`

// The figures, one per section, with real items from the session that built docket.
export const figures = {
  overview: render(
    [
      {
        name: 'requests',
        counter: '(↑ 1)',
        bulk: 'approve all',
        hasAnswers: true,
        items: [{ id: 'R6', emoji: '🚀', text: 'Push the three local commits to StoneCypher/docket?', isNew: true }],
      },
      {
        name: 'questions',
        counter: '(+0)',
        bulk: 'accept all leans',
        items: [
          {
            id: 'Q12',
            emoji: '🔓',
            text: "Should docket's repository be public or private?",
            lean: 'Public. The point is for others to install it.',
            isDim: true,
          },
        ],
      },
      {
        name: 'queued',
        counter: '(+0)',
        items: [
          { id: 'L1', emoji: '💾', text: 'Build persistent todos, kept across sessions.', isDim: true },
          { id: 'L5', emoji: '🚀', text: 'Deploy the site to GitHub Pages.', isDim: true },
        ],
      },
      {
        name: 'pinned',
        counter: '(↑ 1)',
        isInline: true,
        items: [
          { id: 'P8', emoji: '💬', text: 'self-expression mod: its own session' },
          { id: 'P11', emoji: '⚖️', text: 'Site: rework to be less gimmicky' },
        ],
      },
    ],
    { isGear: true },
  ),

  leans: render([
    {
      name: 'questions',
      counter: '(↑ 2)',
      bulk: 'accept all leans',
      items: [
        {
          id: 'Q14',
          emoji: '📜',
          text: 'Which license?',
          lean: 'MIT. Permissive, and the plugin directory accepts it.',
          isNew: true,
        },
        {
          id: 'Q15',
          emoji: '📁',
          text: 'Where should the kept copy live? The current folder belongs to this session.',
          lean: 'In your projects folder, next to your other projects. It is not inside any git repo.',
          isNew: true,
        },
      ],
    },
  ]),

  sent: render([
    {
      name: 'questions',
      counter: '(+0)',
      bulk: 'accept all leans',
      items: [
        { id: 'Q14', emoji: '📜', text: 'Which license?', lean: 'MIT. Permissive, and the plugin directory accepts it.', sent: '✔' },
        {
          id: 'Q15',
          emoji: '📁',
          text: 'Where should the kept copy live? The current folder belongs to this session.',
          lean: 'In your projects folder, next to your other projects.',
          isDim: true,
        },
      ],
    },
  ]),

  options: render([
    {
      name: 'questions',
      counter: '(↑ 1)',
      bulk: 'accept all leans',
      items: [
        {
          id: 'Q17',
          emoji: '🎨',
          text: 'Which direction for the site: (a) court docket, (b) calm instrument, (c) your call?',
          lean: '(a), with the live pane as the centerpiece.',
          options: ['a', 'b', 'c'],
          isNew: true,
        },
      ],
    },
  ]),

  answers: render([
    {
      name: 'requests',
      counter: '(↑ 1)',
      bulk: 'approve all',
      hasAnswers: true,
      items: [{ id: 'R5', emoji: '🚀', text: 'Push the option-buttons commit to StoneCypher/docket? It is one ahead of origin.', isNew: true }],
    },
    {
      name: 'confirm',
      counter: '(↑ 1)',
      bulk: 'confirm all',
      hasAnswers: true,
      items: [
        {
          id: 'C1',
          emoji: '🔍',
          text: 'I read "switch them out" as: use 🚨 and 🔶 on the terminal only, and keep 🧨 and ⚠ everywhere else. Right?',
          isNew: true,
        },
      ],
    },
  ]),

  clearing: render([
    {
      name: 'underway',
      counter: '(↓ 1)',
      items: [
        { id: 'U4', emoji: '🔧', text: 'Building the settings view.', isLingering: true },
        { id: 'U5', emoji: '📦', text: 'Prepping docket for publishing: README, license, marketplace files.', isNew: true },
      ],
    },
    {
      name: 'needs you',
      counter: '(+0)',
      items: [{ id: 'N2', emoji: '🟢', text: 'Upgrade Node to 23.6 or later so npm test runs locally.', isDim: true }],
    },
  ]),
}
