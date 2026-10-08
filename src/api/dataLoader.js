export const DATA_TYPES = ['memories', 'moments', 'diaries', 'messages', 'handoffs', 'ideas', 'games']

// Each collection owns its request and a short-lived, authenticated memory cache.
// Failed refreshes never return an older value or a persisted browser snapshot.
export function createDataLoader({ requestType, getOwner = () => '', now = Date.now, ttlMs = 15000 }) {
  let owner = getOwner()
  const entries = new Map()

  function invalidate() {
    entries.clear()
  }

  function syncOwner() {
    const current = getOwner()
    if (current !== owner) {
      owner = current
      invalidate()
    }
    return current
  }

  async function fetchType(type, requestOwner) {
    const items = []
    const cursors = new Set()
    let cursor
    for (let page = 0; page < 100; page++) {
      const response = await requestType(type, cursor)
      if (getOwner() !== requestOwner) throw new Error('访问密钥已变更，请重新加载')
      if (!Array.isArray(response?.[type])) throw new Error(`${type} 列表响应格式错误，请重试`)
      items.push(...response[type])
      const next = response.next_cursor
      if (!next && response.list_complete !== false) return items
      if (typeof next !== 'string' || !next || cursors.has(next)) {
        throw new Error(`${type} 列表分页不完整，请重试`)
      }
      cursors.add(next)
      cursor = next
    }
    throw new Error(`${type} 列表分页过多，请重试`)
  }

  function read(type, force = false) {
    if (!DATA_TYPES.includes(type)) return Promise.reject(new Error(`未知数据类型：${type}`))
    const requestOwner = syncOwner()
    const cached = entries.get(type)
    if (cached?.pending) return cached.promise
    if (!force && cached && now() < cached.expiresAt) return Promise.resolve(cached.value)

    const entry = { pending: true }
    const promise = fetchType(type, requestOwner).then(
      (value) => {
        if (entries.get(type) === entry && getOwner() === requestOwner) {
          entry.pending = false
          entry.value = value
          entry.expiresAt = now() + ttlMs
        }
        return value
      },
      (error) => {
        if (entries.get(type) === entry) entries.delete(type)
        throw error
      },
    )
    entry.promise = promise
    entries.set(type, entry)
    return promise
  }

  async function readAll(force = false) {
    const pairs = await Promise.all(DATA_TYPES.map(async (type) => {
      try {
        return [type, await read(type, force), null]
      } catch (error) {
        return [type, [], error]
      }
    }))
    const data = { _errors: {} }
    for (const [type, value, error] of pairs) {
      data[type] = value
      if (error) data._errors[type] = error
    }
    return data
  }

  return { read, readAll, invalidate }
}
