// Whether docket's buttons can work where it's drawn. Claude Code's main-screen terminal layout reports
// no mouse clicks and docks no pane, so there docket shows a notice saying how to switch to the
// fullscreen layout, in place of its lists.
import { fill } from './i18n.ts'
import type { Strings } from './i18n.ts'

export type Screen = {
  // The surface drawing: terminal, desktop, vscode, mobile.
  surface: string
  // Whether a person is at the prompt: session.start's isInteractive.
  isInteractive: boolean
  // The viewport's isFullscreen, or command.run's presentation.isFullscreen; undefined where the surface
  // hasn't said yet.
  isFullscreen: boolean | undefined
}

// Whether to show the notice in place of the lists: only on an interactive terminal that says it's on
// the main screen. An unreported layout (isFullscreen absent) gets the usual docket.
// e.g. isMainScreen({ surface: 'terminal', isInteractive: true, isFullscreen: false }) is true.
export const isMainScreen = ({ surface, isInteractive, isFullscreen }: Screen) =>
  surface === 'terminal' && isInteractive && isFullscreen === false

// The notice's lines, in the user's language: why the buttons don't work, how to switch, and what
// stops a switch.
// e.g. mainScreenLines(EN)[1] is "To switch, type /tui fullscreen. ..."
export const mainScreenLines = (text: Strings) => [
  text.mainScreen.buttons,
  fill(text.mainScreen.howTo, { fullscreen: '/tui fullscreen', back: '/tui default' }),
  // Claude Code's own refusal, quoted as it shows it, in English.
  fill(text.mainScreen.busy, { tasks: '/tasks', refusal: 'Cannot switch renderers while work is running in the background' }),
]
