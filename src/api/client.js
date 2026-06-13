// ════════════════════════════════════════════════════════
// 统一请求模块 —— 所有 v66 后端请求的唯一出口。
//
// 后端已安全加固：所有 /api/* 请求（含 GET）都必须携带 X-Admin-Key，
// 否则返回 401；CORS 已收紧到本前端域名。
//
// 本模块负责：
//   ① 从 localStorage 读访问密钥，自动附加 X-Admin-Key 头；
//   ② 统一 401 处理 —— 友好提示「请到设置页填写」，不让页面白屏或静默失败。
//
// 红线：访问密钥只存在本机 localStorage（键 emet.adminKey），
//       严禁写进代码、严禁提交进仓库。
// ════════════════════════════════════════════════════════

import { showToast } from '../utils/toast.js'

export const BASE_URL = 'https://emet-memoty-v66.aandxiaobao.workers.dev'

// ── 访问密钥：全项目唯一存储键（写操作旧逻辑也用的就是它，无第二套）──
const KEY_STORAGE = 'emet.adminKey'

export function getAdminKey() {
  return localStorage.getItem(KEY_STORAGE) || ''
}

// 存空串 / 纯空白 = 清除
export function setAdminKey(value) {
  const v = (value || '').trim()
  if (v) localStorage.setItem(KEY_STORAGE, v)
  else localStorage.removeItem(KEY_STORAGE)
  return v
}

export function clearAdminKey() {
  localStorage.removeItem(KEY_STORAGE)
}

// 401 提示去重：多页并发请求时只弹一次，避免连环 toast
let lastUnauthAt = -Infinity
function notifyUnauthorized() {
  const now = performance.now()
  if (now - lastUnauthAt > 2000) {
    lastUnauthAt = now
    showToast('访问密钥缺失或错误，请到设置页填写')
  }
}

// 统一请求入口。
//   path  形如 '/api/data'
//   opts  { method='GET', params, body }
// 返回解析后的 JSON；失败抛 Error（带 .status）。401 已在内部统一处理。
export async function request(path, { method = 'GET', params, body } = {}) {
  const url = new URL(BASE_URL + path)
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v != null && v !== '') url.searchParams.set(k, String(v))
    }
  }

  const headers = {}
  const key = getAdminKey()
  if (key) headers['X-Admin-Key'] = key // 读写都带；缺失则后端 401，走下面统一处理

  const init = { method, headers }
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify(body)
  }

  const res = await fetch(url, init)

  if (res.status === 401) {
    clearAdminKey() // 密钥无效，清掉让设置页回到「未设置」
    notifyUnauthorized()
    const err = new Error('访问密钥缺失或错误')
    err.status = 401
    throw err
  }
  if (!res.ok) {
    const err = new Error(`${path} → ${res.status}`)
    err.status = res.status
    throw err
  }
  return res.json()
}
