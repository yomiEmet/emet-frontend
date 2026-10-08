import test from 'node:test'
import assert from 'node:assert/strict'
import { createDataLoader, DATA_TYPES } from '../src/api/dataLoader.js'

test('a failing moment list leaves diaries and letters independently readable', async () => {
  const failure = new Error('Too many API requests by single Worker invocation')
  const requested = []
  const loader = createDataLoader({
    requestType: async (type) => {
      requested.push(type)
      if (type === 'moments') throw failure
      return { [type]: [{ id: `${type}-2026-10-08` }] }
    },
  })

  await assert.rejects(loader.read('moments'), (error) => error === failure)
  assert.equal((await loader.read('diaries'))[0].id, 'diaries-2026-10-08')
  assert.equal((await loader.read('handoffs'))[0].id, 'handoffs-2026-10-08')
  assert.deepEqual(requested, ['moments', 'diaries', 'handoffs'])
})

test('aggregate reads keep successes and preserve each original error', async () => {
  const failure = Object.assign(new Error('access denied'), { status: 401 })
  const loader = createDataLoader({
    requestType: async (type) => {
      if (type === 'moments') throw failure
      return { [type]: [{ id: `${type}-new` }] }
    },
  })

  const data = await loader.readAll()
  assert.deepEqual(data.moments, [])
  assert.equal(data._errors.moments, failure)
  assert.equal(data._errors.moments.status, 401)
  assert.equal(data.diaries[0].id, 'diaries-new')
  assert.equal(data.handoffs[0].id, 'handoffs-new')
  assert.deepEqual(Object.keys(data._errors), ['moments'])
  for (const type of DATA_TYPES) assert.ok(Array.isArray(data[type]))
})

test('expired cache never hides a failed refresh and failure is immediately retriable', async () => {
  let time = 0
  let fail = false
  let requests = 0
  const loader = createDataLoader({
    now: () => time,
    ttlMs: 10,
    requestType: async (type) => {
      requests++
      if (fail) throw new Error('offline')
      return { [type]: [{ id: `version-${requests}` }] }
    },
  })

  assert.equal((await loader.read('diaries'))[0].id, 'version-1')
  assert.equal((await loader.read('diaries'))[0].id, 'version-1')
  assert.equal(requests, 1)
  time = 10
  fail = true
  await assert.rejects(loader.read('diaries'), /offline/)
  fail = false
  assert.equal((await loader.read('diaries'))[0].id, 'version-3')
})

test('forced refresh reports failures instead of returning a fresh memory cache', async () => {
  let fail = false
  const loader = createDataLoader({
    requestType: async (type) => {
      if (fail) throw new Error('refresh failed')
      return { [type]: [{ id: 'recent' }] }
    },
  })
  await loader.read('diaries')
  fail = true
  await assert.rejects(loader.read('diaries', true), /refresh failed/)
  await assert.rejects(loader.read('diaries'), /refresh failed/)
})

test('concurrent readers share only their collection request, including forced refresh', async () => {
  let resolveResponse
  let requests = 0
  const loader = createDataLoader({
    requestType: () => {
      requests++
      return new Promise((resolve) => { resolveResponse = resolve })
    },
  })
  const first = loader.read('moments')
  const second = loader.read('moments', true)
  assert.equal(first, second)
  assert.equal(requests, 1)
  resolveResponse({ moments: [{ id: 'current' }] })
  assert.deepEqual(await first, [{ id: 'current' }])
})

test('stored browser snapshots are neither read nor written during record loading', async () => {
  const previous = globalThis.localStorage
  let storageCalls = 0
  globalThis.localStorage = {
    getItem() {
      storageCalls++
      return JSON.stringify({ data: { diaries: [{ id: '2026-10-02' }] } })
    },
    setItem() { storageCalls++ },
  }
  try {
    const loader = createDataLoader({ requestType: async () => { throw new Error('offline') } })
    const data = await loader.readAll()
    assert.deepEqual(data.diaries, [])
    assert.match(data._errors.diaries.message, /offline/)
    assert.equal(storageCalls, 0)
  } finally {
    if (previous === undefined) delete globalThis.localStorage
    else globalThis.localStorage = previous
  }
})

test('a changed access key clears memory cache and rejects an old in-flight response', async () => {
  let owner = 'owner-a'
  let requests = 0
  let resolveResponse
  const loader = createDataLoader({
    getOwner: () => owner,
    requestType: async (type) => {
      requests++
      if (requests === 2) return new Promise((resolve) => { resolveResponse = resolve })
      return { [type]: [{ id: owner }] }
    },
  })
  assert.equal((await loader.read('diaries'))[0].id, 'owner-a')
  const pending = loader.read('moments')
  owner = 'owner-b'
  resolveResponse({ moments: [{ id: 'owner-a' }] })
  await assert.rejects(pending, /密钥已变更/)
  assert.equal((await loader.read('diaries'))[0].id, 'owner-b')
  assert.equal(requests, 3)
})

test('malformed success responses are visible failures rather than empty collections', async () => {
  const loader = createDataLoader({ requestType: async () => ({ error: 'backend error' }) })
  await assert.rejects(loader.read('diaries'), /列表响应格式错误/)
})

test('paged collections include all pages and incomplete pagination never succeeds', async () => {
  const cursors = []
  const loader = createDataLoader({
    requestType: async (type, cursor) => {
      cursors.push(cursor)
      return cursor
        ? { [type]: [{ id: '2026-10-08' }], list_complete: true }
        : { [type]: [{ id: '2026-10-02' }], next_cursor: 'next', list_complete: false }
    },
  })
  assert.deepEqual(await loader.read('diaries'), [{ id: '2026-10-02' }, { id: '2026-10-08' }])
  assert.deepEqual(cursors, [undefined, 'next'])
  const incomplete = createDataLoader({
    requestType: async (type) => ({ [type]: [{ id: 'old' }], list_complete: false }),
  })
  await assert.rejects(incomplete.read('diaries'), /分页不完整/)
})
