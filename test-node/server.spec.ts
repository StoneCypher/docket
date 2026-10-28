// docket's stdio tool server: the handshake, the tool it lists, and what it says to a call it gets.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { PassThrough } from 'node:stream'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { TOOL, UNANSWERED, respond, serve } from '../server/tools.mjs'

const MAIN = fileURLToPath(new URL('../server/main.mjs', import.meta.url))
const MANIFEST = JSON.parse(readFileSync(new URL('../.claude-plugin/plugin.json', import.meta.url), 'utf8')) as { version: string }

// Sends each message as one line and reads back as many replies as it should get.
const converse = async (messages: readonly unknown[], replies: number, write: (line: string) => void, read: AsyncIterable<string>) => {
  for (const message of messages) write(`${typeof message === 'string' ? message : JSON.stringify(message)}\n`)
  const got: Record<string, unknown>[] = []
  let buffered = ''
  for await (const chunk of read) {
    buffered += chunk
    const lines = buffered.split('\n')
    buffered = lines.pop() ?? ''
    got.push(...lines.filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>))
    if (got.length >= replies) break
  }

  return got
}

describe('respond', () => {
  test('answers the handshake with the version the client asked for, and tools', () => {
    const reply = respond({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } }, '1.2.3')
    assert.deepEqual(reply, {
      jsonrpc: '2.0',
      id: 1,
      result: { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'docket', version: '1.2.3' } },
    })
    assert.equal((respond({ jsonrpc: '2.0', id: 2, method: 'initialize' }) as { result: { protocolVersion: string } }).result.protocolVersion, '2025-06-18')
  })

  test('lists the one update tool', () => {
    assert.deepEqual(respond({ jsonrpc: '2.0', id: 'a', method: 'tools/list' }), { jsonrpc: '2.0', id: 'a', result: { tools: [TOOL] } })
    assert.equal(TOOL.name, 'update')
  })

  test('says a call reached it unanswered, as an error, since the hooks answer every call', () => {
    assert.deepEqual(respond({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'update', arguments: {} } }), {
      jsonrpc: '2.0',
      id: 3,
      result: { content: [{ type: 'text', text: UNANSWERED }], isError: true },
    })
  })

  test('answers ping, refuses what it does not know, and stays silent for notifications', () => {
    assert.deepEqual(respond({ jsonrpc: '2.0', id: 4, method: 'ping' }), { jsonrpc: '2.0', id: 4, result: {} })
    assert.deepEqual(respond({ jsonrpc: '2.0', id: 5, method: 'resources/list' }), {
      jsonrpc: '2.0',
      id: 5,
      error: { code: -32601, message: 'Method not found: resources/list' },
    })
    assert.equal(respond({ jsonrpc: '2.0', method: 'notifications/initialized' }), undefined)
    assert.equal(respond({ jsonrpc: '2.0', id: null, method: 'tools/list' }), undefined)
    assert.equal(respond(undefined), undefined)
  })
})

describe('the update tool', () => {
  const add = TOOL.inputSchema.properties.add.items

  test('takes a list letter in any language: no enum of English letters', () => {
    assert.equal(add.properties.list.type, 'string')
    assert.equal('enum' in add.properties.list, false)
    assert.deepEqual(add.required, ['list', 'text'])
  })

  test('takes the same item fields to add as to change', () => {
    const { list: _, ...adding } = add.properties
    const { id: __, ...changing } = TOOL.inputSchema.properties.change.items.properties
    assert.deepEqual(adding, changing)
    assert.deepEqual(Object.keys(adding).sort(), ['emoji', 'lean', 'open', 'options', 'rank', 'stakes', 'text'])
  })
})

describe('serve', () => {
  test('answers line by line, a parse error for a line that is not JSON, and nothing for a blank one', async () => {
    const input = new PassThrough()
    const output = new PassThrough({ encoding: 'utf8' })
    serve(input, output)
    const got = await converse(
      ['', 'not json', { jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', id: 1, method: 'tools/list' }],
      2,
      line => input.write(line),
      output,
    )
    input.end()
    assert.deepEqual(got[0], { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
    assert.deepEqual(got[1], { jsonrpc: '2.0', id: 1, result: { tools: [TOOL] } })
  })

  test("runs as .mcp.json starts it, giving docket's version in the handshake", async () => {
    const child = spawn(process.execPath, [MAIN], { stdio: ['pipe', 'pipe', 'inherit'] })
    child.stdout.setEncoding('utf8')
    try {
      const got = await converse(
        [
          { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '0' } } },
          { jsonrpc: '2.0', method: 'notifications/initialized' },
          { jsonrpc: '2.0', id: 2, method: 'tools/list' },
        ],
        2,
        line => child.stdin.write(line),
        child.stdout,
      )
      assert.equal((got[0]?.result as { serverInfo: { version: string } }).serverInfo.version, MANIFEST.version)
      assert.deepEqual(got[1], { jsonrpc: '2.0', id: 2, result: { tools: [TOOL] } })
    } finally {
      child.kill()
    }
  })
})
