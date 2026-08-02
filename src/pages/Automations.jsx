// 自动化控制台（2026-07-26 静怡需求）：每个自动化背后的 prompt 模板、走哪家渠道、用什么模型，
// 全部可视化、可编辑。开关本身仍在设置页「通知」组——这里管的是"怎么生成"。
// 数据契约见 worker /api/autoprompt：GET 带 defs（默认模板+变量表），POST 空串=清除回退默认。
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react'
import { autopromptGet, autopromptSet } from '../api.js'
import { request } from '../api/client.js'
import LoadError from '../components/LoadError.jsx'
import { loadProviders } from '../utils/providers.js'
import { showToast } from '../utils/toast.js'

const ORDER = ['heartbeat', 'nightguard', 'idle', 'dream', 'feedreact_post', 'feedreact_reply', 'daily', 'review']

export default function Automations() {
  const navigate = useNavigate()
  const [defs, setDefs] = useState(null)
  const [config, setConfig] = useState({})
  const [err, setErr] = useState(null)
  // 渠道列表以云端 settings:global 为准（worker 后台真正 resolve 的就是它），本地列表兜底
  const [providers, setProviders] = useState(() => loadProviders().filter((p) => p.enabled))

  const reload = (isAlive = () => true) => {
    setErr(null)
    autopromptGet()
      .then((r) => {
        if (!isAlive()) return
        setDefs(r.defs || {})
        setConfig(r.config || {})
      })
      .catch((e) => isAlive() && setErr(e))
    request('/api/settings')
      .then((r) => {
        if (!isAlive()) return
        const cloud = (r?.settings?.providers || []).filter((p) => p.enabled)
        if (cloud.length) setProviders(cloud.map((p) => ({ id: p.id, name: p.name, models: p.models || [] })))
      })
      .catch(() => {})
  }

  useEffect(() => {
    let alive = true
    reload(() => alive)
    return () => {
      alive = false
    }
  }, [])

  return (
    <div className="page">
      <button className="mini-btn ap-back" onClick={() => navigate('/settings')} aria-label="返回设置">
        <ChevronLeft size={15} /> 设置
      </button>
      <h1 className="settings-title">自动化</h1>
      <p className="faint ap-hint">
        每个自动化用什么话（prompt 模板）、走哪家渠道、用什么模型，都在这里改。开关在设置页的「通知」组。
        模板里的 {'{{变量}}'} 会在运行时被真实素材替换；清空模板保存 = 恢复默认。
        注意：这些任务在云端跑，「本机 Claude（订阅）」够不着——选了它也会自动退回可用渠道。
      </p>
      {err && <LoadError err={err} onRetry={() => reload()} />}
      {!defs && !err && <p className="faint ap-hint">加载中…</p>}
      {defs && (
        <div className="stack">
          {ORDER.filter((k) => defs[k]).map((k) => (
            <TaskCard key={k} id={k} def={defs[k]} cfg={config[k] || {}} providers={providers} onSaved={setConfig} />
          ))}
        </div>
      )}
    </div>
  )
}

function TaskCard({ id, def, cfg, providers, onSaved }) {
  const [open, setOpen] = useState(false)
  const [providerId, setProviderId] = useState(cfg.providerId || '')
  const [model, setModel] = useState(cfg.model || '')
  // 编辑器里始终显示"生效中的模板"：自定义了显示自定义，否则显示默认——所见即所得
  const [prompt, setPrompt] = useState(cfg.prompt || def.dft)
  const [busy, setBusy] = useState(false)
  const customized = !!(cfg.prompt || cfg.model || cfg.providerId)
  const chosen = providers.find((p) => p.id === providerId)
  // 模型候选：选了渠道就列它家的，没选就把所有启用渠道的模型都列上
  const modelOptions = useMemo(() => {
    const list = chosen ? chosen.models || [] : providers.flatMap((p) => p.models || [])
    return [...new Set(list)]
  }, [chosen, providers])

  const save = async () => {
    if (busy) return
    setBusy(true)
    try {
      // 模板与默认逐字相同就存空串（= 用默认，将来默认文案升级也能跟着走）
      const promptToSave = prompt.trim() === def.dft.trim() ? '' : prompt
      const r = await autopromptSet({ task: id, providerId, model, prompt: promptToSave })
      onSaved(r.config || {})
      showToast('已保存')
    } catch (e) {
      showToast(e?.message || '保存失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card ap-card">
      <button type="button" className="ap-card__head" onClick={() => setOpen((v) => !v)}>
        <span className="ap-card__title">
          {def.label}
          {customized && <em className="ap-card__badge">已自定义</em>}
        </span>
        <span className="faint ap-card__desc">{def.desc}</span>
        <ChevronRight size={15} className={'set-caret' + (open ? ' is-open' : '')} />
      </button>
      {open && (
        <div className="ap-card__body">
          <label className="ap-field">
            <span className="ap-field__name">渠道</span>
            <select value={providerId} onChange={(e) => setProviderId(e.target.value)}>
              <option value="">跟随聊天目标（默认）</option>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="ap-field">
            <span className="ap-field__name">模型</span>
            <input
              list={'ap-models-' + id}
              value={model}
              placeholder="留空 = 该任务原有默认"
              onChange={(e) => setModel(e.target.value)}
            />
            <datalist id={'ap-models-' + id}>
              {modelOptions.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </label>
          <div className="ap-field ap-field--col">
            <span className="ap-field__name">prompt 模板</span>
            <textarea
              className="ap-prompt"
              value={prompt}
              rows={10}
              spellCheck={false}
              onChange={(e) => setPrompt(e.target.value)}
            />
            <div className="ap-vars">
              可用变量：
              {Object.entries(def.vars || {}).map(([k, v]) => (
                <span key={k} className="ap-var" title={v}>
                  {'{{' + k + '}}'}
                </span>
              ))}
            </div>
          </div>
          <div className="ap-card__foot">
            <button
              className="mini-btn"
              onClick={() => setPrompt(def.dft)}
              title="把编辑器恢复成默认模板（还需点保存生效）"
            >
              <RotateCcw size={13} /> 恢复默认模板
            </button>
            <button className="mini-btn mini-btn--accent" disabled={busy} onClick={save}>
              {busy ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
