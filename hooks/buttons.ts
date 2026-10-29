// The buttons an item offers, by the names Claude presses them with. The pane draws these same
// buttons, and a press of either kind runs the same code in register.tsx; this says which buttons an
// item has right now, and what each one marks and sends.
import type { Item } from '../types'
import { fill, labelOf } from './i18n.ts'
import type { Strings } from './i18n.ts'
import { LISTS, isOpen } from './lists.ts'

// Later's start button marks its item with the crane, as the pane does off the terminal.
export const CRANE = '🏗️'

// What pressing a button does: answers the item (marking it, then sending `send` as the user, or
// handling the mod's own item), opens the file it is about, or clears it from the display.
export type ItemButton =
  | { button: string; kind: 'answer'; answer: string; send: string }
  | { button: 'open'; kind: 'open' }
  | { button: 'clear'; kind: 'clear' }

// One answering button: its name, the answer it marks, and the words it sends.
const answering = (button: string, answer: string, send: string): ItemButton => ({ button, kind: 'answer', answer, send })

// The buttons an item shows now, in the order the pane draws them. A closed item shows none; a sent
// one keeps only its Open, as the pane drops its answers and its clear until Claude changes it.
// `button` is what Claude names: "yes", "no", an option's own label, "start", "open" or "clear".
// e.g. buttonsOf({ id: 'R3', list: 'R', n: 3, ... }, EN) gives yes ("Approved R3."), no
// ("Declined R3.") and clear.
export const buttonsOf = (item: Item, text: Strings): ItemButton[] => {
  if (!isOpen(item)) return []
  const label = labelOf(text, item)
  const open: ItemButton[] = item.open ? [{ button: 'open', kind: 'open' }] : []
  if (item.answered !== undefined) return open
  const { answers } = LISTS.find(list => list.letter === item.list) ?? {}
  const pair = answers
    ? [answering('yes', 'yes', fill(text.send[answers.yes], { id: label })), answering('no', 'no', fill(text.send[answers.no], { id: label }))]
    : []
  const options = (item.options ?? []).map(option => answering(option, option, fill(text.send.pick, { id: label, option })))
  // A lean's own ✔ and ✗, where the item has no options and its list no pair of its own.
  const lean =
    item.lean && !options.length && !pair.length
      ? [answering('yes', 'yes', fill(text.send.acceptLean, { id: label })), answering('no', 'no', fill(text.send.rejectLean, { id: label }))]
      : []
  const start = item.list === 'L' ? [answering('start', CRANE, fill(text.send.start, { id: label }))] : []

  return [...pair, ...options, ...lean, ...start, ...open, { button: 'clear', kind: 'clear' }]
}

// The button Claude named, by its exact name, else ignoring case; ✔ and ✗ stand for yes and no.
// Undefined when the item offers no such button now.
// e.g. buttonOf(buttonsOf(question, EN), 'B') finds the option labelled "b".
export const buttonOf = (buttons: readonly ItemButton[], named: string): ItemButton | undefined => {
  const name = named.trim() === '✔' ? 'yes' : named.trim() === '✗' ? 'no' : named.trim()

  return buttons.find(each => each.button === name) ?? buttons.find(each => each.button.toLowerCase() === name.toLowerCase())
}
