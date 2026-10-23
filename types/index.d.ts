export type Letter = 'P' | 'W' | 'L' | 'U' | 'V' | 'N' | 'C' | 'Q' | 'R'
export type Stakes = 'emergency' | 'high' | 'med'

export type Closure = {
  at: number
  // Closed on Claude's own judgment rather than on the user's word.
  isUnasked: boolean
}

export type Item = {
  id: string
  list: Letter
  n: number
  text: string
  emoji?: string
  lean?: string
  stakes?: Stakes
  // 1 is most urgent; only the ranked lists read it.
  rank?: number
  // Up to three lettered options a question offers; their buttons replace ✔ and ✗.
  options?: string[]
  addedTurn: number
  changedTurn: number
  closed?: Closure
  // The user pressed ✔ or ✗ and the reply is on its way; cleared when Claude changes the item.
  // 'yes', 'no', or the option picked.
  answered?: string
  // When it was answered: the docket hides it a little later, whatever Claude has done by then.
  answeredAt?: number
  // When Claude last added or changed it: a bulk button leaves it out for a few seconds after.
  changedAt?: number
  // An item the mod itself handles, rather than Claude: its buttons act locally.
  action?: 'createConfig' | 'translate'
  // For a translate offer: the language it asks for.
  language?: string
  // A local file the item is about: it gets an Open button that opens the file in the editor.
  open?: string
}

export type Counts = Partial<Record<Letter, number>>

declare module 'claude-code' {
  interface PluginState {
    docket: {
      items: Item[]
      counters: Counts
      turn: number
      // Open counts per list when the current turn began, for the deltas.
      baseline: Counts
      // Ids the user dismissed from the band since the last prompt.
      dismissed: string[]
      // Whether the pane shows the settings view instead of the lists.
      isSettings: boolean
      // Letters of the lists the user expanded past their cap.
      expanded: string[]
      // The turn the docket last changed in, and whether the last reply spoke of pending work without changing it.
      updatedTurn: number
      isUnreconciled: boolean
      // The group of initials open in the language picker, before a language in it is picked.
      languageGroup: string
      // The language and voice the open items were last written in, to see when they need rewriting.
      spokenAs: string
    }
  }
}
