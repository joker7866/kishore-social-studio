// Exercises the real OpenAI and Anthropic SDK adapters against a local fake HTTP
// server: request shape, JSON parsing, streaming tool use, and SDK error mapping.
// No API key or network access is needed.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runGeneration } from '../../src/main/ai/pipeline'
import { AnthropicProvider, extractJson } from '../../src/main/ai/providers/anthropic'
import { mapProviderError } from '../../src/main/ai/providers/errors'
import { mockPackage } from '../../src/main/ai/providers/mock'
import { OpenAIProvider } from '../../src/main/ai/providers/openai'
import { loadSkill } from '../../src/main/ai/skill-loader'
import { DEFAULT_PROFILE } from '../../src/shared/guards/branding'
import { makeInput } from '../fixtures/inputs'
import { SKILLS_ROOT } from './helpers'

const profile = { id: 1, ...DEFAULT_PROFILE }
const input = makeInput({ contentTypes: ['fb_text', 'ig_story'] })
const answer = { skillVersion: '1.0.0', packages: input.contentTypes.map((id) => mockPackage(id, input, profile)) }

type Handler = (req: IncomingMessage, body: string, res: ServerResponse) => void
let handler: Handler
let server: Server
let base = ''
const seen: { url: string; headers: IncomingMessage['headers']; body: any }[] = []

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      seen.push({ url: req.url ?? '', headers: req.headers, body: body ? JSON.parse(body) : null })
      handler(req, body, res)
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => new Promise<void>((r) => server.close(() => r())))

const json = (res: ServerResponse, status: number, data: unknown, headers: Record<string, string> = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', ...headers })
  res.end(JSON.stringify(data))
}

function deps(provider: OpenAIProvider | AnthropicProvider) {
  return {
    provider,
    providerId: provider.id,
    model: 'test-model',
    timeoutMs: 10_000,
    skill: loadSkill(SKILLS_ROOT),
    profile,
    signal: new AbortController().signal
  }
}

describe('OpenAI adapter', () => {
  it('sends a JSON-schema request and parses the answer through the full pipeline', async () => {
    seen.length = 0
    handler = (_req, _body, res) =>
      json(res, 200, {
        id: 'x',
        object: 'chat.completion',
        created: 0,
        model: 'test-model',
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(answer), refusal: null } }],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }
      })
    const result = await runGeneration(input, deps(new OpenAIProvider('sk-test-key-1234567890', `${base}/v1`)))
    expect(result.packages.map((p) => p.contentType)).toEqual(['fb_text', 'ig_story'])
    expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 50 })
    const req = seen[0]
    expect(req.url).toBe('/v1/chat/completions')
    expect(req.headers.authorization).toBe('Bearer sk-test-key-1234567890')
    expect(req.body.response_format.type).toBe('json_schema')
    expect(req.body.response_format.json_schema.schema.properties.packages.maxItems).toBe(2)
    expect(req.body.messages[0].role).toBe('system')
    expect(req.body.messages[1].content).toContain('<<<BEGIN HEADLINE>>>')
    expect(req.body.max_completion_tokens).toBeGreaterThan(0)
  })

  it('maps a real SDK 401 and 429 to clear codes', async () => {
    handler = (_req, _body, res) => json(res, 401, { error: { message: 'Incorrect API key provided: sk-test-***', type: 'invalid_request_error' } })
    const p = new OpenAIProvider('sk-test-key-1234567890', `${base}/v1`)
    const err1 = await p.testConnection('gpt-x', new AbortController().signal).catch((e) => e)
    expect(mapProviderError(err1, 'openai').code).toBe('invalid_key')

    handler = (_req, _body, res) => json(res, 429, { error: { message: 'quota', code: 'insufficient_quota', type: 'insufficient_quota' } })
    const err2 = await p.testConnection('gpt-x', new AbortController().signal).catch((e) => e)
    expect(mapProviderError(err2, 'openai').code).toBe('quota')
  })

  it('reports a cut-off answer instead of guessing', async () => {
    handler = (_req, _body, res) =>
      json(res, 200, {
        id: 'x', object: 'chat.completion', created: 0, model: 'm',
        choices: [{ index: 0, finish_reason: 'length', message: { role: 'assistant', content: '{"skillVersion":', refusal: null } }]
      })
    const err = await new OpenAIProvider('k'.repeat(20), `${base}/v1`)
      .generate({ model: 'm', system: 's', user: 'u', jsonSchema: {}, schemaName: 'x', maxOutputTokens: 10, timeoutMs: 5000, context: null as never }, new AbortController().signal)
      .catch((e) => e)
    expect(err.code).toBe('schema')
  })
})

describe('Anthropic adapter', () => {
  function sse(res: ServerResponse, events: [string, unknown][]) {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    for (const [event, data] of events) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    res.end()
  }

  it('streams structured JSON output and parses it through the full pipeline', async () => {
    seen.length = 0
    const text = JSON.stringify(answer)
    handler = (_req, _body, res) =>
      sse(res, [
        ['message_start', { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 200, output_tokens: 1 } } }],
        ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } }],
        ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig' } }],
        ['content_block_stop', { type: 'content_block_stop', index: 0 }],
        ['content_block_start', { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } }],
        ['content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: text.slice(0, 50) } }],
        ['content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: text.slice(50) } }],
        ['content_block_stop', { type: 'content_block_stop', index: 1 }],
        ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 300 } }],
        ['message_stop', { type: 'message_stop' }]
      ])
    const d = { ...deps(new AnthropicProvider('sk-ant-test-1234567890', base)), model: 'claude-sonnet-5-5' }
    const result = await runGeneration(input, d)
    expect(result.packages).toHaveLength(2)
    expect(result.usage.outputTokens).toBe(300)
    const req = seen[0]
    expect(req.url).toMatch(/^\/v1\/messages/)
    expect(req.headers['x-api-key']).toBe('sk-ant-test-1234567890')
    expect(req.body.stream).toBe(true)
    // Forced tool use is rejected by current models — structured outputs are used instead.
    expect(req.body.tool_choice).toBeUndefined()
    expect(req.body.tools).toBeUndefined()
    expect(req.body.output_config.format.type).toBe('json_schema')
    const schema = JSON.stringify(req.body.output_config.format.schema)
    expect(schema).not.toMatch(/minItems|maxItems|minLength|minimum|maximum|\$schema/)
    expect(req.body.output_config.format.schema.additionalProperties).toBe(false)
    // Refusal fallback is on for models that support it.
    expect(req.body.fallbacks).toBe('default')
    expect(String(req.headers['anthropic-beta'])).toContain('server-side-fallback-2026-07-01')
  })

  it('does not send fallbacks for models without support (Haiku)', async () => {
    seen.length = 0
    handler = (_req, _body, res) =>
      sse(res, [
        ['message_start', { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } }],
        ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
        ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: JSON.stringify(answer) } }],
        ['content_block_stop', { type: 'content_block_stop', index: 0 }],
        ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } }],
        ['message_stop', { type: 'message_stop' }]
      ])
    await runGeneration(input, { ...deps(new AnthropicProvider('sk-ant-test-1234567890', base)), model: 'claude-haiku-5-5' })
    expect(seen[0].body.fallbacks).toBeUndefined()
    expect(seen[0].headers['anthropic-beta']).toBeUndefined()
  })

  it('falls back to plain JSON when Claude says the schema grammar is too large', async () => {
    AnthropicProvider.resetSchemaLimit()
    seen.length = 0
    let calls = 0
    const fencedAnswer = 'Here you go:\n```json\n' + JSON.stringify(answer) + '\n```'
    handler = (_req, _body, res) => {
      calls++
      const body = seen[seen.length - 1].body
      if (body.output_config) {
        return json(res, 400, {
          type: 'error',
          error: {
            type: 'invalid_request_error',
            message: 'The compiled grammar is too large, which would cause performance issues. Simplify your tool schemas or reduce the number of strict tools.'
          }
        })
      }
      sse(res, [
        ['message_start', { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } }],
        ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
        ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: fencedAnswer } }],
        ['content_block_stop', { type: 'content_block_stop', index: 0 }],
        ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } }],
        ['message_stop', { type: 'message_stop' }]
      ])
    }
    const d = { ...deps(new AnthropicProvider('sk-ant-test-1234567890', base)), model: 'claude-haiku-5-5' }
    const result = await runGeneration(input, d)
    expect(result.packages).toHaveLength(2)
    expect(calls).toBe(2)
    expect(seen[0].body.output_config).toBeDefined()
    expect(seen[1].body.output_config).toBeUndefined()
    expect(seen[1].body.system).toContain('RESPONSE FORMAT')

    // Next generation of the same size skips the rejected schema straight away.
    seen.length = 0
    calls = 0
    await runGeneration(input, d)
    expect(calls).toBe(1)
    expect(seen[0].body.output_config).toBeUndefined()
    AnthropicProvider.resetSchemaLimit()
  })

  it('extracts JSON from plain, fenced or wrapped text', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 })
    expect(extractJson('```json\n{"a":2}\n```')).toEqual({ a: 2 })
    expect(extractJson('Sure! {"a":3} done')).toEqual({ a: 3 })
    expect(extractJson('no json here')).toBeUndefined()
  })

  it('maps an authentication error', async () => {
    handler = (_req, _body, res) => json(res, 401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } })
    const err = await new AnthropicProvider('sk-ant-test-1234567890', base).testConnection('m', new AbortController().signal).catch((e) => e)
    expect(mapProviderError(err, 'anthropic').code).toBe('invalid_key')
  })
})
