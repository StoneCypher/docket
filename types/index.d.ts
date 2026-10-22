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
      // The turn the docket last changed in, and whether the last reply spoke of pending work without changing it.
      updatedTurn: number
      isUnreconciled: boolean
    }
  }
}
