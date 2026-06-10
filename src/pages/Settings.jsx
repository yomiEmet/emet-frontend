import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Archive, ChevronRight, Download } from 'lucide-react'
import { BASE_URL, ensureAdminKey, healthCheck, statsGet, backupExport } from '../api.js'
import { daysTogether, sinceLabel, dayKey } from '../utils/time.js'

const APP_VERSION = '0.1.0'

// 聊天页（三期）用的模型选择，先存 localStorage 占位
const MODELS = [
  { id: 'claude-fable-5', label: 'Claude Fable 5' },
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
  { id: 'claude-opus-4-7', label: 'Claude Opus 4.7' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
]

// 密钥只显示后 4 位
const mask = (k) => '···· ' + k.slice(-4)

export default function Settings() {
  const navigate = useNavigate()

  // 后端连接状态：null=检测中
  const [health, setHealth] = useState(null)
  const [stats, setStats] = useState(null)

  const [adminKey, setAdminKey] = useState(() => localStorage.getItem('emet.adminKey') || '')
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('emet.anthropicKey') || '')
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [model, setModel] = useState(() => localStorage.getItem('emet.model') || 'claude-fable-5')
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    let alive = true
    healthCheck()
      .then((h) => alive && setHealth({ ok: h.status === 'ok', version: h.version }))
      .catch(() => alive && setHealth({ ok: false }))
    statsGet()
      .then((s) => alive && setStats(s))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  const setAdmin = () => {
    ensureAdminKey()
    setAdminKey(localStorage.getItem('emet.adminKey') || '')
  }
  const clearAdmin = () => {
    localStorage.removeItem('emet.adminKey')
    setAdminKey('')
  }

  const saveApiKey = () => {
    const v = apiKeyInput.trim()
    if (!v) return
    localStorage.setItem('emet.anthropicKey', v)
    setApiKey(v)
    setApiKeyInput('')
  }
  const clearApiKey = () => {
    localStorage.removeItem('emet.anthropicKey')
    setApiKey('')
  }

  const changeModel = (id) => {
    localStorage.setItem('emet.model', id)
    setModel(id)
  }

  const doExport = async () => {
    if (exporting) return
    setExporting(true)
    try {
      const data = await backupExport()
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `emet-backup-${dayKey()}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      alert(e.message || '导出失败')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="page">
      <h1 className="settings-title">设置</h1>

      {/* ── 后端连接 ─────────────────────────── */}
      <section className="set-group">
        <div className="section-label">后端连接</div>
        <div className="card set-card">
          <Row label="地址">
            <span className="set-mono">{BASE_URL.replace('https://', '')}</span>
          </Row>
          <Row label="状态">
            {health === null ? (
              <span className="faint">检测中…</span>
            ) : health.ok ? (
              <span className="set-status">
                <i className="status-dot status-dot--ok" />
                在线 · v{health.version}
              </span>
            ) : (
              <span className="set-status">
                <i className="status-dot status-dot--bad" />
                连接失败
              </span>
            )}
          </Row>
          <Row label="记忆库密码">
            {adminKey ? (
              <span className="set-inline">
                <span className="set-mono">{mask(adminKey)}</span>
                <button className="set-btn" onClick={clearAdmin}>清除</button>
              </span>
            ) : (
              <span className="set-inline">
                <span className="faint">未设置</span>
                <button className="set-btn" onClick={setAdmin}>设置</button>
              </span>
            )}
          </Row>
        </div>
      </section>

      {/* ── API 配置（聊天页预留）──────────────── */}
      <section className="set-group">
        <div className="section-label">API 配置</div>
        <div className="card set-card">
          <Row label="API Key">
            {apiKey ? (
              <span className="set-inline">
                <span className="set-mono">{mask(apiKey)}</span>
                <button className="set-btn" onClick={clearApiKey}>清除</button>
              </span>
            ) : (
              <span className="set-inline">
                <input
                  className="set-input"
                  type="password"
                  placeholder="sk-ant-…"
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                />
                <button className="set-btn" disabled={!apiKeyInput.trim()} onClick={saveApiKey}>
                  保存
                </button>
              </span>
            )}
          </Row>
          <Row label="模型">
            <select className="set-select" value={model} onChange={(e) => changeModel(e.target.value)}>
              {MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </Row>
        </div>
        <p className="set-hint faint">Key 只存在本机浏览器，不会发给后端。聊天功能（三期）会用到。</p>
      </section>

      {/* ── 数据管理 ─────────────────────────── */}
      <section className="set-group">
        <div className="section-label">数据管理</div>
        <div className="card set-card">
          <Row label="备份导出">
            <button className="set-btn set-btn--accent" disabled={exporting} onClick={doExport}>
              <Download size={14} />
              {exporting ? '导出中…' : '下载 JSON'}
            </button>
          </Row>
        </div>
      </section>

      {/* ── 档案 ─────────────────────────────── */}
      <section className="set-group">
        <div className="section-label">档案</div>
        <button className="card set-card set-entry" onClick={() => navigate('/archive')}>
          <Archive size={18} />
          <span className="set-entry__text">
            <strong>对话档案</strong>
            <span className="faint">浏览导入的聊天记录</span>
          </span>
          <ChevronRight size={16} className="faint" />
        </button>
      </section>

      {/* ── 关于 ─────────────────────────────── */}
      <section className="set-group">
        <div className="section-label">关于</div>
        <div className="card set-card">
          <Row label="版本">
            <span>
              前端 v{APP_VERSION}
              {health?.version && <span className="faint"> · 后端 v{health.version}</span>}
            </span>
          </Row>
          <Row label="正计时">
            <span>
              <strong>{daysTogether()}</strong> days together
              <span className="faint"> · since {sinceLabel()}</span>
            </span>
          </Row>
          {stats && (
            <div className="set-stats faint">
              记忆 {stats.total_memories} · 瞬记 {stats.total_moments} · 日记 {stats.total_diaries}
              {' · '}故事 {stats.total_stories} · 留言 {stats.total_messages} · 信 {stats.total_handoffs}
              {' · '}灵感 {stats.total_ideas} · 游戏 {stats.total_games}
            </div>
          )}
        </div>
      </section>
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
