// ═══════════════════════════════════════════════════════════
// 设置云同步：把本地设置打包成一个 blob 存 KV settings:global。
// "一个密钥全同步"——输入访问密钥即从云端拉取覆盖本地。
//
// 同步的 localStorage 键（不含 emet.adminKey，密钥本身不上云）：
//   emet.assistant / emet.providers / emet.todos / emet.moods
//
// 策略：整块 last-write-wins（按 updated_at）。pull 应用更新后由调用方决定是否
// 刷新页面让各组件重读（见 App.jsx / Settings.jsx）。
// ═══════════════════════════════════════════════════════════

import { request } from '../api/client.js'

export const SYNCED_KEYS = ['emet.assistant', 'emet.providers', 'emet.todos', 'emet.moods']
const AT_KEY = 'emet.settingsAt' // 本地设置最后修改时间（last-write-wins 依据）

// ── 同步状态（设置页订阅 'emet:settings-sync' 事件显示）──
let _state = 'idle' // idle | syncing | synced | error
export function getSyncState() {
  return _state
}
function notify(state) {
  _state = state
  try {
    window.dispatchEvent(new CustomEvent('emet:settings-sync', { detail: state }))
  } catch {
    /* 非浏览器环境忽略 */
  }
}

function readKey(k) {
  try {
    const v = localStorage.getItem(k)
    return v == null ? null : JSON.parse(v)
  } catch {
    return null
  }
}
function writeKey(k, val) {
  if (val == null) localStorage.removeItem(k)
  else localStorage.setItem(k, JSON.stringify(val))
}

export function getSettingsAt() {
  return localStorage.getItem(AT_KEY) || ''
}
function setSettingsAt(t) {
  if (t) localStorage.setItem(AT_KEY, t)
}

// 组装本地设置 blob
function buildBlob(updatedAt) {
  return {
    updated_at: updatedAt,
    assistant: readKey('emet.assistant'),
    providers: readKey('emet.providers'),
    todos: readKey('emet.todos'),
    moods: readKey('emet.moods'),
  }
}

// 把云端 blob 写回本地（覆盖）。返回是否写了东西。
function applyBlob(blob) {
  if (!blob || typeof blob !== 'object') return false
  for (const k of SYNCED_KEYS) {
    const field = k.replace('emet.', '')
    if (field in blob) writeKey(k, blob[field])
  }
  if (blob.updated_at) setSettingsAt(blob.updated_at)
  return true
}

// ── 推送（防抖）：本地设置变更后调用 ──
let _timer = null
export function schedulePushSettings(delay = 1500) {
  clearTimeout(_timer)
  _timer = setTimeout(() => {
    pushSettings().catch(() => {})
  }, delay)
}

export async function pushSettings() {
  const at = new Date().toISOString()
  setSettingsAt(at)
  notify('syncing')
  try {
    await request('/api/settings', { method: 'PUT', body: buildBlob(at) })
    notify('synced')
  } catch (e) {
    notify('error')
    throw e
  }
}

// useLocalStorage 用：键属于同步集才触发推送
export function notifyKeyChanged(key) {
  if (SYNCED_KEYS.includes(key)) schedulePushSettings()
}

// ── 拉取 ──
// force=true（输入密钥时）：云端有数据就无条件覆盖本地。
// force=false（App 挂载时）：仅当云端 updated_at 更新才覆盖（last-write-wins）。
// 返回 true 表示本地被云端数据覆盖了（调用方据此决定是否刷新页面）。
export async function pullSettings({ force = false } = {}) {
  notify('syncing')
  let data
  try {
    data = await request('/api/settings', {})
  } catch (e) {
    notify('error')
    throw e
  }
  const blob = data?.settings
  if (!blob) {
    notify('synced')
    return false // 云端尚无设置
  }
  const cloudAt = blob.updated_at || ''
  if (force || cloudAt > getSettingsAt()) {
    applyBlob(blob)
    if (force && !blob.updated_at) setSettingsAt(new Date().toISOString())
    notify('synced')
    return true
  }
  notify('synced')
  return false
}
