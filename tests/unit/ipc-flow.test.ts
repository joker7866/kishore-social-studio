import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ProviderError, type ProviderAdapter } from '../../src/main/ai/providers/types'
import { CONTENT_TYPE_IDS } from '../../src/shared/platform-types'
import { actorQuestion, feeAllegation, makeInput } from '../fixtures/inputs'
import { makeCtx, rid } from './helpers'

describe('IPC validation', () => {
  it('rejects malformed payloads before any handler runs', async () => {
    const { call } = makeCtx()
    const cases: [string, unknown][] = [
      ['drafts:get', { id: 'one' }],
      ['drafts:get', { id: -1 }],
      ['drafts:get', { id: 1, extra: true }],
      ['drafts:rename', { id: 1, title: '' }],
      ['provider:saveKey', { provider: 'mock', key: 'abcdefghijkl' }],
      ['provider:saveKey', { provider: 'openai', key: 'short' }],
      ['packages:applyField', { packageId: 1, fieldPath: '__proto__.x', value: 'a', source: 'user' }],
      ['packages:applyField', { packageId: 1, fieldPath: 'a/../b', value: 'a', source: 'user' }],
      ['shell:openExternal', { url: 'javascript:alert(1)' }],
      ['gen:run', { requestId: 'bad id!', input: {} }],
      ['settings:set', { key: 'notAKey', value: 1 }]
    ]
    for (const [channel, payload] of cases) {
      const r = await call(channel as never, payload)
      expect(r.ok, `${channel} ${JSON.stringify(payload)}`).toBe(false)
      // javascript: passes the generic URL check and is then refused by the allowlist.
      if (!r.ok) expect(['validation', 'forbidden']).toContain(r.error.code)
    }
  })

  it('rejects unknown channels', async () => {
    const { call } = makeCtx()
    const r = await call('fs:readFile' as never, { path: 'C:/Windows' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('forbidden')
  })

  it('rejects an invalid generation input with a clear message', async () => {
    const { call } = makeCtx()
    const r = await call('gen:run', { requestId: rid(), input: { headline: '', contentTypes: [] } })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('validation')
  })

  it('blocks external links outside the allowlist', async () => {
    const { call } = makeCtx()
    const r = await call('shell:openExternal', { url: 'https://evil.example.com/' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('forbidden')
    expect((await call('shell:openExternal', { url: 'https://platform.openai.com/api-keys' })).ok).toBe(true)
  })

  it('validates setting values', async () => {
    const { call } = makeCtx()
    expect((await call('settings:set', { key: 'activeProvider', value: 'skynet' })).ok).toBe(false)
    expect((await call('settings:set', { key: 'activeProvider', value: 'mock' })).ok).toBe(true)
  })
})

describe('generation in Mock mode', () => {
  it('headline-only input produces all 14 content types with branding and no accuracy warnings', async () => {
    const { ok } = makeCtx()
    const d = await ok('gen:run', { requestId: rid(), input: { headline: 'மெட்ரோ ரயில் சேவை நேர மாற்றம்', contentTypes: [...CONTENT_TYPE_IDS] } })
    expect(d.packages.map((p) => p.contentType)).toEqual([...CONTENT_TYPE_IDS])
    for (const p of d.packages) {
      expect(p.provider).toBe('mock')
      if (p.contentType === 'ig_story') expect(p.current.hashtags).toBeUndefined()
      else expect(p.current.hashtags!.recommended[0]).toBe(p.platform === 'youtube' ? '#growwithkishore' : '#growwithkishorenews')
      expect(p.warnings.filter((w) => w.severity === 'warning')).toEqual([])
      expect(p.current.missingInfoNotes.length).toBeGreaterThan(0)
    }
  })

  it('mock output keeps allegations attributed and questions as questions', async () => {
    const { ok } = makeCtx()
    for (const input of [feeAllegation(), actorQuestion()]) {
      const d = await ok('gen:run', { requestId: rid(), input })
      for (const p of d.packages) expect(p.warnings.filter((w) => w.code === 'uncertainty_dropped')).toEqual([])
    }
  })

  it('uses the selected channel profile', async () => {
    const { ok } = makeCtx()
    const prof = await ok('profiles:save', {
      name: 'Second channel',
      youtubeHandle: 'second',
      facebookPage: 'second',
      instagramHandle: 'second',
      youtubeHashtag: '#SecondYT',
      facebookHashtag: '#SecondFB',
      instagramHashtag: '#SecondIG'
    })
    const d = await ok('gen:run', { requestId: rid(), input: { ...makeInput({ contentTypes: ['yt_shorts', 'fb_reel', 'ig_feed'] }), profileId: prof.id } })
    expect(d.packages.map((p) => p.current.hashtags!.recommended[0])).toEqual(['#SecondYT', '#SecondFB', '#SecondIG'])
  })
})

describe('editing, regeneration and undo', () => {
  async function setup() {
    const t = makeCtx()
    const d = await t.ok('gen:run', { requestId: rid(), input: makeInput({ contentTypes: ['yt_shorts', 'fb_reel'] }) })
    return { ...t, d, yt: d.packages[0] }
  }

  it('regenerating one field never changes other edited fields', async () => {
    const { ok, yt } = await setup()
    await ok('packages:applyField', { packageId: yt.id, fieldPath: 'description', value: 'என் திருத்தம்', source: 'user' })
    const proposal = await ok('gen:regenerateField', { requestId: rid(), packageId: yt.id, fieldPath: 'titleOptions.0' })
    expect(proposal.previous).toBe(yt.current.titleOptions![0])
    const after = await ok('packages:applyField', { packageId: yt.id, fieldPath: 'titleOptions.0', value: proposal.proposal, source: 'regen' })
    expect(after.current.description).toBe('என் திருத்தம்')
    expect(after.current.titleOptions![0]).toBe(proposal.proposal)
    // generated_json is never overwritten by edits
    expect(after.generated.description).toBe(yt.generated.description)
  })

  it('undo restores the previous title, then the previous description', async () => {
    const { ok, yt } = await setup()
    await ok('packages:applyField', { packageId: yt.id, fieldPath: 'description', value: 'திருத்தம் 1', source: 'user' })
    await ok('packages:applyField', { packageId: yt.id, fieldPath: 'titleOptions.1', value: 'புதிய தலைப்பு', source: 'regen' })
    let r = await ok('packages:undo', { packageId: yt.id })
    expect(r.current.titleOptions![1]).toBe(yt.current.titleOptions![1])
    expect(r.current.description).toBe('திருத்தம் 1')
    r = await ok('packages:undo', { packageId: yt.id })
    expect(r.current.description).toBe(yt.current.description)
    expect(r.historyCount).toBe(0)
  })

  it('rejects edits that break the schema or touch fields of another type', async () => {
    const { call, yt } = await setup()
    const bad1 = await call('packages:applyField', { packageId: yt.id, fieldPath: 'titleOptions', value: ['one'], source: 'user' })
    expect(bad1.ok).toBe(false)
    const bad2 = await call('packages:applyField', { packageId: yt.id, fieldPath: 'caption', value: 'x', source: 'user' })
    expect(bad2.ok).toBe(false)
  })

  it('platform regeneration replaces the platform packages and can be undone', async () => {
    const { ok, d, yt } = await setup()
    await ok('packages:applyField', { packageId: yt.id, fieldPath: 'description', value: 'கைத் திருத்தம்', source: 'user' })
    const r = await ok('gen:regeneratePlatform', { requestId: rid(), draftId: d.id, platform: 'youtube', action: 'no_emojis' })
    const ytAfter = r.packages.find((p) => p.contentType === 'yt_shorts')!
    expect(ytAfter.edited).toBeNull()
    const fbAfter = r.packages.find((p) => p.contentType === 'fb_reel')!
    expect(fbAfter.current).toEqual(d.packages[1].current)
    const undone = await ok('packages:undo', { packageId: ytAfter.id })
    expect(undone.current.description).toBe('கைத் திருத்தம்')
  })

  it('reset to generated is undoable', async () => {
    const { ok, yt } = await setup()
    await ok('packages:applyField', { packageId: yt.id, fieldPath: 'cta', value: 'புதிய CTA', source: 'user' })
    const reset = await ok('packages:reset', { packageId: yt.id })
    expect(reset.current.cta).toBe(yt.generated.cta)
    const back = await ok('packages:undo', { packageId: yt.id })
    expect(back.current.cta).toBe('புதிய CTA')
  })
})

describe('drafts', () => {
  it('search, filter, rename, duplicate, delete with undo', async () => {
    const { ok } = makeCtx()
    const a = await ok('gen:run', { requestId: rid(), input: makeInput({ headline: 'மழை எச்சரிக்கை', contentTypes: ['yt_shorts'] }) })
    await ok('gen:run', { requestId: rid(), input: makeInput({ headline: 'கிரிக்கெட் போட்டி', contentTypes: ['ig_reel'] }) })
    expect((await ok('drafts:list', { search: 'மழை' })).map((d) => d.id)).toEqual([a.id])
    expect((await ok('drafts:list', { platform: 'instagram' })).map((d) => d.title)).toEqual(['கிரிக்கெட் போட்டி'])
    expect((await ok('drafts:list', { search: '%' })).length).toBe(0)
    await ok('drafts:rename', { id: a.id, title: 'புதிய பெயர்' })
    const copy = await ok('drafts:duplicate', { id: a.id })
    expect(copy.title).toBe('புதிய பெயர் (copy)')
    expect(copy.packages).toHaveLength(1)
    await ok('drafts:delete', { id: a.id })
    expect((await ok('drafts:list', {})).map((d) => d.id)).not.toContain(a.id)
    await ok('drafts:restore', { id: a.id })
    expect((await ok('drafts:list', {})).map((d) => d.id)).toContain(a.id)
  })
})

describe('provider errors and repair', () => {
  function scripted(responses: unknown[]): ProviderAdapter {
    let i = 0
    return {
      id: 'mock',
      async generate() {
        const r = responses[i++]
        if (r instanceof Error) throw r
        return { json: r, rawText: JSON.stringify(r), model: 'scripted' }
      },
      testConnection: async () => 'ok',
      listModels: async () => []
    }
  }

  it('repairs once, then reports a clear schema error without saving', async () => {
    const provider = scripted([{ wrong: true }, { still: 'wrong' }])
    const { call, ok } = makeCtx({ createProvider: () => provider })
    const r = await call('gen:run', { requestId: rid(), input: makeInput({ contentTypes: ['yt_shorts'] }) })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.code).toBe('schema')
    expect(await ok('drafts:list', {})).toEqual([])
  })

  it('accepts a good answer after one repair', async () => {
    const { mockPackage } = await import('../../src/main/ai/providers/mock')
    const { DEFAULT_PROFILE } = await import('../../src/shared/guards/branding')
    const good = { skillVersion: '1.0.0', packages: [mockPackage('fb_text', makeInput(), { id: 1, ...DEFAULT_PROFILE })] }
    const { ok } = makeCtx({ createProvider: () => scripted(['not json', good]) })
    const d = await ok('gen:run', { requestId: rid(), input: makeInput({ contentTypes: ['fb_text'] }) })
    expect(d.packages).toHaveLength(1)
  })

  it('maps SDK-style errors to distinct codes', async () => {
    const cases: [unknown, string][] = [
      [Object.assign(new Error('bad key sk-proj-ABCDEFGHIJKLMNOPQRSTUV'), { status: 401 }), 'invalid_key'],
      [Object.assign(new Error('slow down'), { status: 429, headers: { 'retry-after': '12' } }), 'rate_limit'],
      [Object.assign(new Error('quota'), { status: 429, error: { error: { code: 'insufficient_quota' } } }), 'quota'],
      [Object.assign(new Error('Your credit balance is too low'), { status: 400 }), 'quota'],
      [Object.assign(new Error('x'), { name: 'APIConnectionTimeoutError' }), 'timeout'],
      [Object.assign(new Error('x'), { name: 'APIConnectionError' }), 'offline'],
      [Object.assign(new Error('x'), { name: 'APIUserAbortError' }), 'cancelled'],
      [Object.assign(new Error('x'), { status: 529 }), 'server']
    ]
    for (const [err, code] of cases) {
      const { call } = makeCtx({ createProvider: () => scripted([err]) })
      const r = await call('gen:run', { requestId: rid(), input: makeInput({ contentTypes: ['fb_text'] }) })
      expect(r.ok).toBe(false)
      if (!r.ok) {
        expect(r.error.code).toBe(code)
        expect(r.error.message).not.toMatch(/sk-proj-ABC/)
        if (code === 'rate_limit') expect(r.error.retryAfterSec).toBe(12)
      }
    }
  })

  it('needs a key for real providers and is honest when offline', async () => {
    const { call, ok } = makeCtx({ isOnline: () => false })
    await ok('settings:set', { key: 'activeProvider', value: 'openai' })
    let r = await call('gen:run', { requestId: rid(), input: makeInput({ contentTypes: ['fb_text'] }) })
    expect(!r.ok && r.error.code).toBe('no_key')
    await ok('provider:saveKey', { provider: 'openai', key: 'sk-proj-TESTKEY1234567890abcdef' })
    r = await call('gen:run', { requestId: rid(), input: makeInput({ contentTypes: ['fb_text'] }) })
    expect(!r.ok && r.error.code).toBe('offline')
  })

  it('cancels a running generation', async () => {
    const { MockProvider } = await import('../../src/main/ai/providers/mock')
    const { call } = makeCtx({ createProvider: () => new MockProvider(2_000) })
    const id = rid()
    const pending = call('gen:run', { requestId: id, input: makeInput({ contentTypes: ['fb_text'] }) })
    await new Promise((r) => setTimeout(r, 50))
    await call('gen:cancel', { requestId: id })
    const r = await pending
    expect(!r.ok && r.error.code).toBe('cancelled')
  })

  it('surfaces ProviderError messages as-is', async () => {
    const { call } = makeCtx({ createProvider: () => scripted([new ProviderError('bad_request', 'nope')]) })
    const r = await call('gen:run', { requestId: rid(), input: makeInput({ contentTypes: ['fb_text'] }) })
    expect(!r.ok && r.error.message).toBe('nope')
  })
})

describe('templates and profiles', () => {
  it('saves and lists templates', async () => {
    const { ok } = makeCtx()
    const t = await ok('templates:save', {
      name: 'Breaking short',
      preset: {
        language: 'ta',
        tone: 'neutral',
        emojiLevel: 'none',
        contentTypes: ['yt_shorts', 'ig_reel'],
        hashtagPrefs: { maxRecommended: 4, includeExpanded: false, extraTags: ['#Chennai'] },
        profileId: null
      }
    })
    expect((await ok('templates:list')).map((x) => x.name)).toEqual(['Breaking short'])
    await ok('templates:delete', { id: t.id })
    expect(await ok('templates:list')).toEqual([])
  })

  it('cannot delete the last profile; default moves when deleting the default', async () => {
    const { ok, call } = makeCtx()
    const [first] = await ok('profiles:list')
    expect((await call('profiles:delete', { id: first.id })).ok).toBe(false)
    const second = await ok('profiles:save', {
      name: 'B',
      youtubeHandle: 'b',
      facebookPage: 'b',
      instagramHandle: 'b',
      youtubeHashtag: '#b',
      facebookHashtag: '#b',
      instagramHashtag: '#b'
    })
    await ok('profiles:delete', { id: first.id })
    const list = await ok('profiles:list')
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(second.id)
    expect(list[0].isDefault).toBe(true)
  })
})

describe('export and import', () => {
  it('exports TXT, JSON, HTML, PDF and CSV files', async () => {
    const { ok } = makeCtx()
    const d = await ok('gen:run', { requestId: rid(), input: makeInput({ contentTypes: ['yt_shorts', 'ig_story'] }) })
    for (const format of ['txt', 'json', 'html', 'pdf'] as const) {
      const r = await ok('export:draft', { draftId: d.id, format })
      expect(r.saved).toBe(true)
      const text = readFileSync(r.path!, 'utf8')
      expect(text).toContain(d.headline)
    }
    const html = readFileSync((await ok('export:draft', { draftId: d.id, format: 'html' })).path!, 'utf8')
    expect(html).not.toMatch(/<script/i)
    const csv = await ok('export:csv', { draftIds: [d.id] })
    expect(readFileSync(csv.path!, 'utf8').startsWith('\uFEFF"draft_id"')).toBe(true)
  })

  it('backup → import round trip with preview', async () => {
    const src = makeCtx()
    const d = await src.ok('gen:run', { requestId: rid(), input: makeInput({ contentTypes: ['fb_reel'] }) })
    await src.ok('packages:applyField', { packageId: d.packages[0].id, fieldPath: 'caption', value: 'திருத்திய caption', source: 'user' })
    const backup = await src.ok('backup:create')

    const dst = makeCtx()
    dst.openQueue.push(backup.path!)
    const preview = await dst.ok('backup:importPreview')
    expect(preview!.counts).toMatchObject({ drafts: 1, packages: 1, profiles: 1 })
    // Nothing is written until apply.
    expect(await dst.ok('drafts:list', {})).toEqual([])
    await dst.ok('backup:importApply', { token: preview!.token })
    const [imported] = await dst.ok('drafts:list', {})
    const full = await dst.ok('drafts:get', { id: imported.id })
    expect(full.packages[0].current.caption).toBe('திருத்திய caption')
    expect(full.packages[0].historyCount).toBe(1)
    // Token is single-use.
    expect((await dst.call('backup:importApply', { token: preview!.token })).ok).toBe(false)
  })

  it('rejects corrupt, foreign, unknown-version and tampered backups', async () => {
    const t = makeCtx()
    const write = (name: string, content: string) => {
      const p = join(t.dir, name)
      writeFileSync(p, content)
      return p
    }
    const valid = JSON.parse(readFileSync((await t.ok('backup:create')).path!, 'utf8'))
    const files = [
      write('corrupt.json', '{not json'),
      write('foreign.json', JSON.stringify({ hello: 'world' })),
      write('future.json', JSON.stringify({ ...valid, backupVersion: 99 })),
      write(
        'tampered.json',
        JSON.stringify({
          ...valid,
          data: {
            ...valid.data,
            drafts: [
              {
                id: 1, title: 'x', headline: 'x', context_json: JSON.stringify(makeInput()), languages: 'ta', tone: 'neutral',
                status: 'generated', profile_id: null, created_at: 'x', updated_at: 'x',
                packages: [{ platform: 'instagram', content_type: 'ig_reel', generated_json: JSON.stringify({ contentType: 'ig_reel', keywords: ['x'] }), edited_json: null, provider: 'mock', model: 'm', skill_version: '1', generated_at: 'x', history: [] }]
              }
            ]
          }
        })
      )
    ]
    for (const f of files) {
      t.openQueue.push(f)
      const r = await t.call('backup:importPreview')
      expect(r.ok, f).toBe(false)
      if (!r.ok) expect(r.error.code).toBe('validation')
    }
  })
})
