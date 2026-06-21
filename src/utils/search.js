// 聪明搜索 —— 关键词匹配 + 三维加权打分（匹配度 / 重要度 / 时间新鲜度）+ 可选沿藤蔓走一步
//
// 输入：
//   items: 已经归一化的记忆数组（normMemory 后的形状：content/tags/rawImportance/created_at/linked/id）
//   query: 查询字符串
//   opts:  { withLinked?: boolean }  搜到 A 时是否把 A 连着的藤蔓也拉出来（弱分排在后面）
//
// 输出：按总分倒序的记忆数组（空查询返回原数组）

// 分词：英文/数字按词、中文按字（单字也算 token）
function tokenize(s) {
  if (!s) return []
  const lower = s.toLowerCase().trim()
  if (!lower) return []
  const tokens = []
  const regex = /[a-z0-9]+|[一-鿿]/gi
  let m
  while ((m = regex.exec(lower))) tokens.push(m[0])
  return tokens
}

// 关键词匹配分（0~∞）：标签命中权重最高，内容前 20 字命中额外加分，完整短语再加分
function scoreMatch(item, queryTokens, queryRaw) {
  if (!queryTokens.length) return 0
  const haystack = (item.content || '').toLowerCase()
  const tagsBlob = (item.tags || []).map((t) => String(t).toLowerCase()).join(' ')

  let score = 0
  for (const tok of queryTokens) {
    if (tagsBlob.includes(tok)) score += 3
    const idx = haystack.indexOf(tok)
    if (idx >= 0) {
      score += 2
      if (idx < 20) score += 1
    }
  }
  // 完整短语原文命中额外加分（>=2 字时才算）
  const phrase = queryRaw.toLowerCase().replace(/\s+/g, '')
  if (phrase.length >= 2 && haystack.replace(/\s+/g, '').includes(phrase)) score += 3
  return score
}

// 时间新鲜度（0~1）：指数衰减，半衰期 30 天
function freshness(item) {
  const t = item.created_at
  if (!t) return 0
  const age = (Date.now() - new Date(t).getTime()) / 86400000
  if (age <= 0) return 1
  return Math.pow(0.5, age / 30)
}

// 重要度（0~1）：rawImportance 1-10 → 0-1
function importance(item) {
  return ((item.rawImportance || 5) - 1) / 9
}

export function smartSearch(items, query, opts = {}) {
  const q = (query || '').trim()
  if (!q) return [...items]
  const tokens = tokenize(q)
  if (!tokens.length) return []

  // 第一轮：直接命中
  const scored = items
    .map((item) => {
      const m = scoreMatch(item, tokens, q)
      if (m === 0) return null
      const total = m + importance(item) * 2 + freshness(item) * 1.5
      return { item, score: total, matchScore: m, viaLink: false }
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)

  // 第二轮：沿藤蔓走一步（搜到 A 把 A.linked 里没命中的也带出来，分数弱、排在直接命中之后）
  if (opts.withLinked) {
    const seen = new Set(scored.map((x) => x.item.id))
    const extras = []
    for (const { item } of scored) {
      for (const lid of item.linked || []) {
        if (seen.has(lid)) continue
        const linked = items.find((x) => x.id === lid)
        if (!linked) continue
        seen.add(lid)
        extras.push({
          item: linked,
          score: importance(linked) * 0.5 + freshness(linked) * 0.3,
          matchScore: 0,
          viaLink: true,
        })
      }
    }
    extras.sort((a, b) => b.score - a.score)
    scored.push(...extras)
  }

  return scored.map((x) => x.item)
}

// 仅暴露给单元测试 / 调试用，不参与主流程
export const _internals = { tokenize, scoreMatch, freshness, importance }
