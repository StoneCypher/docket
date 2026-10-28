// docket's update tool, served over stdio so Claude Code lists it.
//
// The engine's own server for `$.tool.register` answers its client's tools/list with a response the
// client can't read (InvalidHTTPResponse), so a tool registered that way never reaches the model. This
// server only lists the tool: the hooks module answers each call in its `tool.call` hook before the
// call gets here. Plain JavaScript with no dependencies, so any Node that runs Claude Code's plugins
// runs it.
import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

const STAKES = ['emergency', 'high', 'med']

const itemFields = {
  text: { type: 'string', description: 'The item, one to three lines' },
  emoji: { type: 'string', description: 'One emoji for the item' },
  lean: { type: 'string', description: 'Questions only: the answer you would pick' },
  stakes: { type: 'string', enum: STAKES, description: 'Omit for low stakes' },
  rank: { type: 'number', description: 'Verify, Needs you, Confirm, Questions and Requests only: 1 is the most urgent' },
  open: { type: 'string', description: 'A local file path the item is about. The item gets an Open button that opens it in the editor.' },
  options: {
    type: 'array',
    items: { type: 'string' },
    maxItems: 3,
    description:
      'Questions only: one to three button labels, each a single letter or a single emoji, such as ["a", "b", "c"] or ["🌐", "📄"]. Each label must appear in the text beside what it picks. Their buttons replace the lean’s ✔ and ✗ and send the pick, as "Q4 (b)." does in English.',
  },
}

/**
 * The update tool as tools/list gives it: one schema for every language.
 *
 * The lists' letters differ by language, so `list` and `id` take them as the docket's instructions
 * give them, with no enum; the hooks module reports any it can't place, with the letters in force.
 *
 * @example
 * TOOL.name // 'update', which Claude Code lists as mcp__plugin_docket_docket__update
 */
export const TOOL = {
  name: 'update',
  description:
    'Add, change and close items on the docket, the numbered lists the user reads above the prompt. Send every change of a turn in one call. Labels are assigned here and returned. Use change only to correct the same item; a new or follow-up question is a close plus an add, so it gets a new number.',
  inputSchema: {
    type: 'object',
    properties: {
      add: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            list: { type: 'string', description: "The list's letter, as the docket's instructions give it: P, W, L, U, V, N, C, Q or R in English" },
            ...itemFields,
          },
          required: ['list', 'text'],
        },
      },
      change: {
        type: 'array',
        items: {
          type: 'object',
          properties: { id: { type: 'string', description: 'A label such as Q12, in the docket’s letters' }, ...itemFields },
          required: ['id'],
        },
      },
      close: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            unasked: { type: 'boolean', description: "True when you close it on your own judgment, not on the user's word" },
          },
          required: ['id'],
        },
      },
      language: {
        type: 'string',
        description:
          "The language the user writes to you in, as a code such as de or pt-BR. Set it only when the docket asks you to: it's on auto and nothing else told it the user's language.",
      },
    },
  },
}

/**
 * What a call that reaches this server says: the hooks module, which answers every call, didn't.
 */
export const UNANSWERED =
  "docket's hooks didn't answer this call, so nothing changed. Is docket enabled, and does /docket open its pane?"

// docket's version, for the handshake; the manifest sits one folder up.
const versionOf = () => {
  try {
    const { version } = JSON.parse(readFileSync(fileURLToPath(new URL('../.claude-plugin/plugin.json', import.meta.url)), 'utf8'))

    return typeof version === 'string' ? version : '0'
  } catch {
    return '0'
  }
}

/**
 * The reply to one JSON-RPC message from the client, or undefined for a notification.
 *
 * @param message A parsed JSON-RPC request or notification.
 * @param version docket's version, given in the handshake.
 * @returns The response to write back, or undefined when none is due.
 * @example
 * respond({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
 * // { jsonrpc: '2.0', id: 2, result: { tools: [TOOL] } }
 * @example
 * respond({ jsonrpc: '2.0', method: 'notifications/initialized' }) // undefined
 */
export const respond = (message, version = '0') => {
  if (message?.id === undefined || message.id === null) return undefined
  const { id, method, params } = message
  const result = (value) => ({ jsonrpc: '2.0', id, result: value })
  switch (method) {
    case 'initialize':
      return result({
        protocolVersion: typeof params?.protocolVersion === 'string' ? params.protocolVersion : '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'docket', version },
      })
    case 'ping':
      return result({})
    case 'tools/list':
      return result({ tools: [TOOL] })
    case 'tools/call':
      return result({ content: [{ type: 'text', text: UNANSWERED }], isError: true })
    default:
      return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } }
  }
}

/**
 * Serves `respond` over newline-delimited JSON on stdin and stdout until stdin closes.
 *
 * A line that isn't JSON is answered with a parse error, as JSON-RPC asks, and the server carries on.
 */
export const serve = (input = process.stdin, output = process.stdout) => {
  const version = versionOf()
  createInterface({ input }).on('line', (line) => {
    if (!line.trim()) return
    let message
    try {
      message = JSON.parse(line)
    } catch {
      output.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })}\n`)

      return
    }
    const reply = respond(message, version)
    if (reply) output.write(`${JSON.stringify(reply)}\n`)
  })
}
