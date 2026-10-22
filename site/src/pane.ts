// The replica of docket's pane and the scripted session it plays. Shared by the page,
// which draws the opening state at build time, and the script, which plays the rest.

export type Item = {
  id: string
  emoji: string
  text: string
  lean?: string
  options?: string[]
  answered?: string
  isNew?: boolean
}

export type ListName = 'requests' | 'questions' | 'confirm' | 'underway' | 'pinned'

export type State = {
  lists: Record<ListName, Item[]>
  // Each list's length when the turn began, for the counters.
  before: Partial<Record<ListName, number>>
}

export type Entry = { id: string; text: string; isDisposed?: boolean }

const ORDER: ListName[] = ['requests', 'questions', 'confirm', 'underway', 'pinned']
const BULK: Partial<Record<ListName, string>> = {
  requests: 'approve all',
  questions: 'accept all leans',
  confirm: 'confirm all',
}

export const opening = (): State => ({
  lists: {
    requests: [],
    questions: [
      {
        id: 'Q12',
        emoji: '🔓',
        text: 'Should the repo be public or private?',
        lean: 'Public. The point is for others to install it.',
      },
      {
        id: 'Q13',
        emoji: '🎨',
        text: 'Which look for the site: (a) court docket, (b) calm instrument, (c) your call?',
        lean: '(a), with the live pane as the centerpiece.',
        options: ['a', 'b', 'c'],
      },
    ],
    confirm: [{ id: 'C3', emoji: '🔍', text: 'I read "ship it" as: push main, but don\'t tag a release yet. Right?' }],
    underway: [{ id: 'U5', emoji: '📝', text: 'Writing the README.' }],
    pinned: [
      { id: 'P1', emoji: '🖼️', text: 'Icon for the directory listing' },
      { id: 'P2', emoji: '🐣', text: 'Buddy mod, a later session' },
    ],
  },
  before: { questions: 2, confirm: 1, underway: 1, pinned: 2 },
})

export const openingLedger = (): Entry[] => [
  { id: 'Q12', text: 'Filed. Should the repo be public or private?' },
  { id: 'Q13', text: 'Filed. Which look for the site?' },
  { id: 'C3', text: 'Filed. Confirm reading of "ship it".' },
  { id: 'U5', text: 'Underway. Writing the README.' },
]

const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const counter = (name: ListName, state: State) => {
  const delta = state.lists[name].length - (state.before[name] ?? 0)

  return delta > 0 ? `(↑ ${delta})` : delta < 0 ? `(↓ ${-delta})` : '(+0)'
}

const answerButtons = (item: Item) => {
  if (item.answered) {
    return `<span class="mark">${escape(item.answered)}</span>`
  }
  const labels = item.options ?? ['✔', '✗']

  return labels
    .map((label, i) => `<span class="qbtn" data-key="${item.id}-${i}">${escape(label)}</span>`)
    .join('')
}

// Confirm items and requests carry their answer buttons on their own line, as in docket.
const row = (item: Item, hasAnswers: boolean) => {
  const isDim = item.answered !== undefined || !item.isNew
  const tail = item.isNew && !item.answered ? ' <span class="new">(new)</span>' : ''

  return `
    <div class="item${isDim ? ' dim' : ''}${item.answered ? ' answered' : ''}" data-item="${item.id}">
      <div class="line">
        <span><b>${item.id}.</b> ${item.emoji} ${escape(item.text)}${tail}</span>
        <span class="side">${hasAnswers ? answerButtons(item) : ''}<span class="qbtn">🗑️</span></span>
      </div>
      ${
        item.lean
          ? `<div class="lean"><span><b>Lean</b>: ${escape(item.lean)}</span><span class="side">${answerButtons(item)}</span></div>`
          : ''
      }
    </div>`
}

export const render = (state: State) => {
  const sections = ORDER.filter(name => state.lists[name].length > 0).map(name => {
    const items = state.lists[name]
    const bulk = BULK[name] ? `<span class="btn" data-key="bulk-${name}">${BULK[name]}</span>` : ''
    const body =
      name === 'pinned'
        ? `<div class="inline">${items
            .map(item => `<span><b>${item.id}</b> ${item.emoji} ${escape(item.text)}</span>`)
            .join(' · ')}</div>`
        : items.map(item => row(item, name === 'confirm' || name === 'requests')).join('')

    return `
      <div class="list" data-list="${name}">
        <div class="head"><b>${name}</b> <span class="count">${counter(name, state)}</span><span class="ctrls">${bulk}<span class="qbtn">✕</span></span></div>
        ${body}
      </div>`
  })

  return `
    <div class="pane-title"><span>Docket</span><span aria-hidden="true">✕</span></div>
    <div class="attr">From the docket plugin</div>
    ${sections.join('') || '<div class="empty">Nothing on the docket.</div>'}
    <div class="gear"><span class="qbtn">⚙️</span></div>`
}

export const renderLedger = (entries: Entry[]) =>
  entries
    .map(
      entry => `
      <li class="${entry.isDisposed ? 'disposed' : ''}">
        <span class="no">${entry.id}</span>
        <span class="txt">${escape(entry.text)}</span>
        ${entry.isDisposed ? '<span class="stamp">Disposed</span>' : ''}
      </li>`,
    )
    .join('')
