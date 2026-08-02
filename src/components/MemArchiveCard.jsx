// 设置页：记忆存档（Paramecium 移植）——规范行版，嵌进「数据」卡。
// L0 原文存档：聊天原文机械切窗入档，零 AI 零成本，随聊天自动增量，始终开着（只展示状态）。
// L1 自动摘录：便宜模型从对话里圈重点，每条带逐字引用锚定（改写的直接丢弃），默认关。
// 开启时把历史会话排队回填；摘录模型可填便宜模型（留空=跟随聊天模型），在子行设置。

import { useEffect, useState } from 'react'
import { mem2StatusGet, extractionConfigGet, extractionConfigSet, mem2ExtractBackfill } from '../api.js'
import { showToast } from '../utils/toast.js'
import { SetRow, IosSwitch } from './SettingRow.jsx'

export default function MemArchiveCard() {
  const [enabled, setEnabled] = useState(null) // null = loading
  const [model, setModel] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState(null)

  useEffect(() => {
    let alive = true
    extractionConfigGet()
      .then((r) => {
        if (!alive) return
        setEnabled(!!r?.config?.enabled)
        setModel(r?.config?.model || '')
      })
      .catch(() => alive && setEnabled(false))
    mem2StatusGet()
      .then((s) => alive && setStatus(s))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  const toggle = async () => {
    if (busy || enabled === null) return
    setBusy(true)
    try {
      const next = !enabled
      await extractionConfigSet({ enabled: next, model })
      setEnabled(next)
      if (next) {
        // 开启时把历史会话排进队列，后台每 30 分钟消化 3 场，慢慢追平
        const r = await mem2ExtractBackfill().catch(() => null)
        showToast(r ? `自动摘录已开启，${r.marked} 场历史对话已排队` : '自动摘录已开启')
      } else {
        showToast('自动摘录已关闭')
      }
    } catch (e) {
      showToast(e?.message || '操作失败')
    } finally {
      setBusy(false)
    }
  }

  const saveModel = async () => {
    if (enabled === null) return
    try {
      await extractionConfigSet({ enabled: !!enabled, model })
      showToast(model ? `摘录模型已设为 ${model}` : '摘录模型已恢复跟随聊天模型')
    } catch (e) {
      showToast(e?.message || '保存失败')
    }
  }

  const archiveDesc = status
    ? `${status.archived_convs} 场对话 · ${status.windows} 窗，聊天里 recall 可翻原话`
    : '读取中…'
  const extractDesc =
    enabled === null ? '检测中…'
    : enabled ? `已有 ${status?.l1_memories ?? '—'} 条 · 带原文逐字引用`
    : '便宜模型自动圈对话重点（会花钱）'

  return (
    <>
      <SetRow label="原文存档" desc={archiveDesc} />
      <SetRow label="自动摘录" desc={extractDesc}>
        <IosSwitch ariaLabel="自动摘录开关" on={!!enabled} disabled={busy || enabled === null} onChange={toggle} />
      </SetRow>
      {enabled && (
        <SetRow label="摘录模型" desc="留空 = 跟随聊天模型">
          <input
            className="set-input"
            style={{ maxWidth: 150, fontSize: 12 }}
            placeholder="如 deepseek-chat"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            onBlur={saveModel}
          />
        </SetRow>
      )}
    </>
  )
}
