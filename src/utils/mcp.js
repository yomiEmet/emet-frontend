// ═══════════════════════════════════════════════════════════
// 极简 MCP 客户端：向后端 /mcp 端点发 JSON-RPC，复用后端 MCP 工具。
// 正规 application/json + X-Admin-Key（密钥复用 client.js 的 emet.adminKey）。
// 后端 /mcp 已加鉴权闸门，缺密钥会 401。
//
// 第一版（安全子集）：只启用 5 个工具，排除删除/搬移类破坏性操作。
// 跑稳后再逐步加更多。
// ═══════════════════════════════════════════════════════════

import { BASE_URL, getAdminKey } from '../api/client.js'

const MCP_URL = BASE_URL + '/mcp'

// 工具白名单：读 + 增量写，排除删除/搬移/覆盖/织藤等危险操作。
// 仍不开：memory_delete / moment_delete / idea_delete / game_delete / move_item /
//        memory_update / memory_link / memory_unlink。
export const ENABLED_TOOLS = [
  // 第一批（写 + 检索）
  'memory_search', 'memory_save', 'moment_save', 'diary_write', 'breath',
  // 第二批（只读浏览 + 织藤候选 + 统计）
  'memory_list', 'memory_get', 'moment_list', 'diary_list', 'diary_get',
  'weave_candidates', 'current_status', 'stats',
  // 第三批（Paramecium 移植）：recall——vault+聊天原文存档按需回忆
  // 注意：工具定义在缓存前缀里，白名单/描述一变全部缓存作废一次（预期内一次性成本）
  'recall',
]

let _rpcId = 0

async function rpc(method, params) {
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Key': getAdminKey(),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++_rpcId, method, params }),
  })
  if (res.status === 401) {
    const e = new Error('MCP 鉴权失败：请在设置页填写访问密钥')
    e.status = 401
    throw e
  }
  if (!res.ok) {
    const e = new Error(`MCP ${res.status}`)
    e.status = res.status
    throw e
  }
  const data = await res.json()
  if (data.error) throw new Error(data.error.message || 'MCP error')
  return data.result
}

// 拉工具列表 → 过滤白名单 → 转成 Anthropic tools 格式 [{name, description, input_schema}]。缓存一次。
let _toolsCache = null
export async function listAnthropicTools() {
  if (_toolsCache) return _toolsCache
  const result = await rpc('tools/list', {})
  const all = result?.tools || []
  _toolsCache = all
    .filter((t) => ENABLED_TOOLS.includes(t.name))
    .map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }))
  return _toolsCache
}

// 调用一个工具，返回文本结果（后端把工具返回的 JSON 塞在 content[0].text）。
// 双保险：只允许白名单内的工具，防止模型臆造工具名。
export async function callTool(name, args) {
  if (!ENABLED_TOOLS.includes(name)) {
    throw new Error(`工具未启用：${name}`)
  }
  const result = await rpc('tools/call', { name, arguments: args || {} })
  const text = (result?.content || [])
    .map((c) => c.text)
    .filter(Boolean)
    .join('\n')
  if (result?.isError) throw new Error(text || '工具返回错误')
  return text
}
