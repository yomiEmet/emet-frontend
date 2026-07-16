// 共读书架 · txt 上架流水线（三期）
// 解码（UTF-8 fatal 试 → GBK 回退）→ 归一化（必须在入库前）→ 分章。
// 关键纪律：入库的正文 = 阅读器逐字渲染的正文，否则字符偏移全错位。

// ① 解码：国内 txt 多为 GBK。先按 UTF-8 严格解，抛错就回退 GBK。
export function decodeTxt(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    try {
      return new TextDecoder('gbk').decode(buffer) // 浏览器原生支持 gbk 标签
    } catch {
      // 最后兜底：非严格 UTF-8（可能有 �，但不抛错）
      return new TextDecoder('utf-8').decode(buffer)
    }
  }
}

// ② 归一化：统一换行（\r\n / \r → \n），去掉 BOM。入库前完成，之后不再动。
export function normalize(text) {
  return text.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
}

// ③ 分章：优先识别章节标题行（第X章/回/卷/节、序章/楔子/引子/序言/前言/后记/尾声）。
// 识别不到就按段落边界约每 1 万字切一章。
const HEADING = /^[ \t　]*(?:第[零一二三四五六七八九十百千两0-9]{1,8}[章回卷节部篇]|序章|序言|楔子|引子|前言|后记|尾声|终章)[^\n]{0,30}$/

export function splitChapters(text) {
  const lines = text.split('\n')
  const headingIdx = []
  for (let i = 0; i < lines.length; i++) {
    if (HEADING.test(lines[i].trim()) && lines[i].trim().length <= 40) headingIdx.push(i)
  }

  // 有明确章节标题：按标题行切
  if (headingIdx.length >= 2) {
    const chapters = []
    // 标题前若有正文（如书籍简介），归为「前言」章
    if (headingIdx[0] > 0) {
      const pre = lines.slice(0, headingIdx[0]).join('\n').trim()
      if (pre) chapters.push({ title: '开篇', text: pre })
    }
    for (let k = 0; k < headingIdx.length; k++) {
      const start = headingIdx[k]
      const end = k + 1 < headingIdx.length ? headingIdx[k + 1] : lines.length
      const title = lines[start].trim().slice(0, 40)
      const body = lines.slice(start + 1, end).join('\n').replace(/^\n+/, '')
      chapters.push({ title, text: (title + '\n\n' + body).trimEnd() })
    }
    return chapters
  }

  // 没有章节标题：按约 1 万字在段落边界切
  return splitByLength(text, 10000)
}

function splitByLength(text, target) {
  const paras = text.split(/\n\s*\n/)
  const chapters = []
  let buf = ''
  let n = 1
  for (const p of paras) {
    if (buf && buf.length + p.length > target) {
      chapters.push({ title: `第 ${n} 节`, text: buf.trimEnd() })
      n++
      buf = ''
    }
    buf += (buf ? '\n\n' : '') + p
  }
  if (buf.trim()) chapters.push({ title: `第 ${n} 节`, text: buf.trimEnd() })
  return chapters.length ? chapters : [{ title: '全文', text: text.trimEnd() }]
}
