import { useState } from 'react'
import { Plus, X, Pencil, Trash2 } from 'lucide-react'
import { loadProviders, saveProviders, DEFAULT_ANTHROPIC_MODELS } from '../utils/providers.js'
import { showToast } from '../utils/toast.js'

const mask = (k) => (k ? '···· ' + k.slice(-4) : '未填')

const protocolLabel = (p) =>
  p === 'openai' ? 'OpenAI 兼容' : p === 'claude-cli' ? '本机 Claude' : 'Anthropic'

const PROTOCOLS = [
  { key: 'anthropic', label: 'Anthropic 原生' },
  { key: 'openai', label: 'OpenAI 兼容' },
  { key: 'claude-cli', label: '本机 Claude（订阅）' },
]

// 一键预设：在家本机起 chat-server.cjs 之后直接选这个供应商即可烧订阅额度
const LOCAL_CLAUDE_PRESET = {
  name: '本机 Claude（订阅）',
  baseUrl: 'http://localhost:8000',
  apiKey: '',
  protocol: 'claude-cli',
  models: ['本机订阅'],
  defaultModel: '本机订阅',
  enabled: true,
}

// 设置页"供应商管理"分组（参考 Kelivo：多供应商 + 各自模型列表）
export default function ProviderManager() {
  const [providers, setProviders] = useState(loadProviders)
  const [editing, setEditing] = useState(null) // null | {…draft}

  const persist = (arr) => {
    saveProviders(arr)
    setProviders(arr)
  }

  const toggle = (id) => {
    persist(providers.map((p) => (p.id === id ? { ...p, enabled: !p.enabled } : p)))
  }

  const remove = (id) => {
    const p = providers.find((x) => x.id === id)
    if (!window.confirm(`删除供应商「${p?.name}」？`)) return
    persist(providers.filter((x) => x.id !== id))
    showToast('已删除')
  }

  const openNew = () =>
    setEditing({
      id: '',
      name: '',
      baseUrl: '',
      apiKey: '',
      protocol: 'anthropic',
      models: [],
      defaultModel: '',
      enabled: true,
    })

  const addLocalClaude = () => {
    if (providers.some((p) => p.protocol === 'claude-cli')) {
      showToast('已有本机 Claude 供应商')
      return
    }
    persist([...providers, { ...LOCAL_CLAUDE_PRESET, id: 'p-local-' + Date.now() }])
    showToast('已添加；先在终端 node chat-server.cjs')
  }

  const save = (draft) => {
    if (draft.id) {
      persist(providers.map((p) => (p.id === draft.id ? draft : p)))
    } else {
      persist([...providers, { ...draft, id: 'p' + Date.now() }])
    }
    setEditing(null)
    showToast('已保存')
  }

  return (
    <section className="set-group">
      <div className="section-label">供应商管理</div>

      {providers.length === 0 ? (
        <p className="set-hint faint">还没有供应商。添加一个就能在聊天页开聊。</p>
      ) : (
        <div className="stack" style={{ marginBottom: 10 }}>
          {providers.map((p) => (
            <div key={p.id} className={'card prov-card' + (p.enabled ? '' : ' is-off')}>
              <div className="prov-card__head">
                <span className="prov-card__name">{p.name}</span>
                <span className="prov-badge">{protocolLabel(p.protocol)}</span>
                <span style={{ flex: 1 }} />
                <button
                  className={'prov-switch' + (p.enabled ? ' is-on' : '')}
                  onClick={() => toggle(p.id)}
                  aria-label={p.enabled ? '禁用' : '启用'}
                >
                  <i />
                </button>
              </div>
              <div className="prov-card__meta faint">
                {p.protocol === 'claude-cli'
                  ? `${(p.baseUrl || 'http://localhost:8000').replace(/^https?:\/\//, '')} · 无需密钥`
                  : `${(p.baseUrl || '').replace(/^https?:\/\//, '')} · Key ${mask(p.apiKey)}`}
              </div>
              <div className="prov-card__meta faint">
                {p.models.length} 个模型
                {p.defaultModel && ` · 默认 ${p.defaultModel}`}
              </div>
              <div className="prov-card__ops">
                <button className="set-btn" onClick={() => setEditing({ ...p, models: [...p.models] })}>
                  <Pencil size={12} /> 编辑
                </button>
                <button className="set-btn prov-del" onClick={() => remove(p.id)}>
                  <Trash2 size={12} /> 删除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <button className="idea-add-btn" onClick={openNew}>
        <Plus size={16} /> 添加供应商
      </button>
      <button className="idea-add-btn" onClick={addLocalClaude} style={{ marginTop: 6 }}>
        <Plus size={16} /> 一键添加：本机 Claude（订阅）
      </button>
      <p className="faint prov-tip" style={{ marginTop: 4 }}>
        用前先在本机终端跑 <code>node chat-server.cjs</code>；只本机回环，不对外。
      </p>

      {editing && <ProviderForm draft={editing} onSave={save} onClose={() => setEditing(null)} />}
    </section>
  )
}

function ProviderForm({ draft, onSave, onClose }) {
  const [d, setD] = useState(draft)
  const [modelInput, setModelInput] = useState('')

  const set = (k, v) => setD((x) => ({ ...x, [k]: v }))

  const addModel = () => {
    const v = modelInput.trim()
    setModelInput('')
    if (!v || d.models.includes(v)) return
    setD((x) => ({
      ...x,
      models: [...x.models, v],
      defaultModel: x.defaultModel || v,
    }))
  }

  const removeModel = (m) =>
    setD((x) => ({
      ...x,
      models: x.models.filter((y) => y !== m),
      defaultModel: x.defaultModel === m ? '' : x.defaultModel,
    }))

  const fillAnthropicDefaults = () =>
    setD((x) => ({
      ...x,
      models: [...new Set([...x.models, ...DEFAULT_ANTHROPIC_MODELS])],
      defaultModel: x.defaultModel || DEFAULT_ANTHROPIC_MODELS[0],
    }))

  const valid =
    d.name.trim() &&
    d.baseUrl.trim() &&
    (d.protocol === 'claude-cli' || d.apiKey.trim()) &&
    d.models.length > 0

  return (
    <>
      <div className="ts-scrim" onClick={onClose} />
      <div className="ts-panel card prov-form">
        <div className="ts-head">
          <span className="ts-title">{d.id ? '编辑供应商' : '添加供应商'}</span>
          <button className="ts-close" onClick={onClose} aria-label="关闭">
            <X size={16} />
          </button>
        </div>

        <div className="prov-form__body">
          <label className="prov-field">
            <span>名称</span>
            <input value={d.name} placeholder="如：官方 / aihubmix / 某中转" onChange={(e) => set('name', e.target.value)} />
          </label>

          <div className="prov-field">
            <span>协议类型</span>
            <div className="seg" style={{ alignSelf: 'flex-start' }}>
              {PROTOCOLS.map((pr) => (
                <button
                  key={pr.key}
                  className={'seg-btn' + (d.protocol === pr.key ? ' is-active' : '')}
                  onClick={() => set('protocol', pr.key)}
                >
                  {pr.label}
                </button>
              ))}
            </div>
          </div>

          <label className="prov-field">
            <span>{d.protocol === 'claude-cli' ? '本机后端地址' : 'API Base URL'}</span>
            <input
              value={d.baseUrl}
              placeholder={
                d.protocol === 'claude-cli'
                  ? 'http://localhost:8000'
                  : d.protocol === 'openai'
                    ? 'https://api.example.com（自动补 /v1）'
                    : 'https://api.anthropic.com'
              }
              onChange={(e) => set('baseUrl', e.target.value)}
            />
          </label>

          {d.protocol === 'claude-cli' ? (
            <p className="faint prov-tip" style={{ margin: '2px 0 8px' }}>
              本机回环，不需要 API Key。先在终端跑 <code>node chat-server.cjs</code> 再切到这里。
            </p>
          ) : (
            <label className="prov-field">
              <span>API Key</span>
              <input type="password" value={d.apiKey} placeholder="sk-…" onChange={(e) => set('apiKey', e.target.value)} />
            </label>
          )}

          <div className="prov-field">
            <span>
              模型列表
              {d.protocol === 'anthropic' && (
                <button className="prov-fill faint" onClick={fillAnthropicDefaults}>
                  填入官方模型
                </button>
              )}
            </span>
            <div className="prov-models">
              {d.models.map((m) => (
                <span
                  key={m}
                  className={'prov-model' + (d.defaultModel === m ? ' is-default' : '')}
                  onClick={() => set('defaultModel', m)}
                  title="点击设为默认"
                >
                  {m}
                  {d.defaultModel === m && <em>默认</em>}
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      removeModel(m)
                    }}
                    aria-label="删除模型"
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
            </div>
            <div className="ts-add" style={{ marginTop: 6 }}>
              <input
                value={modelInput}
                placeholder="输入模型 ID，回车添加"
                onChange={(e) => setModelInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addModel()}
              />
              <button onClick={addModel} aria-label="添加">
                <Plus size={15} />
              </button>
            </div>
            {d.models.length > 0 && <p className="faint prov-tip">点模型名设为默认。</p>}
          </div>
        </div>

        <div className="idea-form__foot">
          <button className="mini-btn" onClick={onClose}>取消</button>
          <button className="mini-btn mini-btn--accent" disabled={!valid} onClick={() => onSave(d)}>
            保存
          </button>
        </div>
      </div>
    </>
  )
}
