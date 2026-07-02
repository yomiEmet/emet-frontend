// 设置页：记忆存档（Paramecium 移植）
// L0 原文存档：聊天原文机械切窗入档，零 AI 零成本，随聊天自动增量，不用管。
// L1 自动摘录：便宜模型从对话里圈重点，每条带逐字引用锚定（改写的直接丢弃），默认关。

import { useEffect, useState } from 'react'
import { Archive, BookOpen, RefreshCw } from 'lucide-react'
import { mem2StatusGet, extractionConfigGet, extractionConfigSet, mem2ExtractsGet, mem2ExtractBackfill } from '../api.js'
import { showToast } from '../utils/toast.js'

function hhmm(iso) {
  if (!iso) return ''
  const d = new Date(new Date(iso.replace(' ', 'T') + (iso.includes('Z') ? '' : 'Z')).getTime() + 8 * 3600 * 1000)
  return isNaN(d) ? '' : d.toISOString().slice(5, 16).replace('T', ' ')
}

export default function MemArchiveCard() {
  const [enabled, setEnabled] = useState(null) // null = loading
  const [model, setModel] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState(null)
  const [extracts, setExtracts] = useState(null)
  const [showList, setShowList] = useState(false)

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

  const loadExtracts = async () => {
    if (showList) {
      setShowList(false)
      return
    }
    setShowList(true)
    if (extracts === null) {
      try {
        const r = await mem2ExtractsGet(10)
        setExtracts(r?.extracts || [])
      } catch {
        setExtracts([])
      }
    }
  }

  return (
    <div className="card set-card">
      <Row label="原文存档">
        <span className="set-status">
          {status ? (
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>
              {status.archived_convs} 场对话 · {status.windows} 窗 · {status.raw_rows} 行索引
            </span>
          ) : (
            '读取中…'
          )}
        </span>
      </Row>
      {status?.last_run?.at && (
        <Row label="上次入档">
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{hhmm(status.last_run.at)}（随聊天自动增量）</span>
        </Row>
      )}
      <Row label="自动摘录">
        <span className="set-status">
          {enabled === true && <i className="status-dot status-dot--ok" />}
          {enabled === null ? '检测中…' : enabled ? '已开启' : '已关闭'}
          {status ? ` · 已有 ${status.l1_memories} 条` : ''}
        </span>
      </Row>
      <Row label="摘录模型">
        <input
          className="set-input"
          style={{ maxWidth: 180, fontSize: 12 }}
          placeholder="留空=跟随聊天模型"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          onBlur={saveModel}
        />
      </Row>
      <Row label="操作">
        <span style={{ display: 'inline-flex', gap: 8 }}>
          <button className={`set-btn ${enabled ? '' : 'set-btn--accent'}`} disabled={busy || enabled === null} onClick={toggle}>
            {enabled ? (
              <>
                <Archive size={12} /> 关闭
              </>
            ) : (
              <>
                <BookOpen size={12} /> 开启
              </>
            )}
          </button>
          <button className="set-btn" onClick={loadExtracts}>
            <RefreshCw size={12} /> {showList ? '收起' : '最近摘录'}
          </button>
        </span>
      </Row>
      {showList && (
        <div style={{ marginTop: 8 }}>
          {extracts === null && <p className="set-hint faint">读取中…</p>}
          {extracts?.length === 0 && <p className="set-hint faint">还没有摘录。</p>}
          {(extracts || []).map((x) => (
            <div key={x.id} style={{ padding: '6px 0', borderTop: '1px solid var(--border, #eee)' }}>
              <div style={{ fontSize: 13 }}>
                <span className="faint" style={{ marginRight: 6 }}>
                  {x.date}
                </span>
                {x.content}
              </div>
              <div className="faint" style={{ fontSize: 12, marginTop: 2 }}>出处：「{x.quote}」</div>
            </div>
          ))}
        </div>
      )}
      <p className="set-hint faint" style={{ marginTop: 8, marginBottom: 0 }}>
        原文存档零成本、始终开着：聊天原话逐字入档，聊天里 Emet 可以用 recall 翻回任何一天的原话。自动摘录会花钱：每攒够 4
        条新消息用模型圈一次重点（约一句话的钱），每条摘录都带原文逐字引用、改写的机械丢弃；建议在上面填个便宜模型（如
        deepseek-chat）。你手写的记忆完全不受影响，摘录存在独立的一层。
      </p>
    </div>
  )
}

function Row({ label, children }) {
  return (
    <div className="set-row">
      <span className="set-row__label">{label}</span>
      <span className="set-row__val">{children}</span>
    </div>
  )
}
