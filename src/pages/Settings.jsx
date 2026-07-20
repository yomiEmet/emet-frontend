import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Archive, ChevronRight, Download, Upload, RefreshCw, Lock as LockIcon } from 'lucide-react'
import { showToast } from '../utils/toast.js'
import ProviderManager from '../components/ProviderManager.jsx'
import AssistantSettings from '../components/AssistantSettings.jsx'
import PushToggle from '../components/PushToggle.jsx'
import HeartbeatToggle from '../components/HeartbeatToggle.jsx'
import DailyToggle from '../components/DailyToggle.jsx'
import NightGuardToggle from '../components/NightGuardToggle.jsx'
import KeepaliveToggle from '../components/KeepaliveToggle.jsx'
import IdleToggle from '../components/IdleToggle.jsx'
import DreamToggle from '../components/DreamToggle.jsx'
import { BASE_URL, healthCheck, statsGet, backupExport } from '../api.js'
import { getAdminKey, setAdminKey as storeAdminKey, clearAdminKey } from '../api/client.js'
import { buildExport, importSessions } from '../utils/sessions.js'
import { syncAll, getLastSync } from '../utils/sync.js'
import { pullSettings, pushSettings, getSyncState } from '../utils/settingsSync.js'
import { daysTogether, sinceLabel, dayKey } from '../utils/time.js'

const APP_VERSION = '0.1.0'

const mask = (k) => '···· ' + k.slice(-4)

function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem('emet-theme') || 'paper')
  const apply = (t) => {
    document.documentElement.setAttribute('data-theme', t)
    localStorage.setItem('emet-theme', t)
    setTheme(t)
  }
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [])
  return [theme, apply]
}

export default function Settings() {
  const navigate = useNavigate()
  const [theme, setTheme] = useTheme()

  const [health, setHealth] = useState(null)
  const [stats, setStats] = useState(null)

  const [adminKey, setAdminKey] = useState(() => getAdminKey())
  const [keyInput, setKeyInput] = useState('')
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    let alive = true
    healthCheck()
      .then((h) => alive && setHealth({ ok: h.status === 'ok', version: h.version }))
      .catch(() => alive && setHealth({ ok: false }))
    statsGet()
      .then((s) => alive && setStats(s))
      .catch(() => {})
    return () => { alive = false }
  }, [])

  const [settingsSyncState, setSettingsSyncState] = useState(getSyncState)
  useEffect(() => {
    const h = (e) => setSettingsSyncState(e.detail)
    window.addEventListener('emet:settings-sync', h)
    return () => window.removeEventListener('emet:settings-sync', h)
  }, [])

  const saveKey = async () => {
    const v = storeAdminKey(keyInput)
    setAdminKey(v)
    setKeyInput('')
    showToast(v ? '访问密钥已保存' : '请输入访问密钥')
    if (!v) return
    try {
      const applied = await pullSettings({ force: true })
      if (applied) {
        showToast('已从云端同步设置，正在刷新…')
        setTimeout(() => window.location.reload(), 600)
      } else {
        await pushSettings()
        showToast('已将本地设置上传到云端')
      }
    } catch { /* offline */ }
  }
  const lockAdmin = () => {
    clearAdminKey()
    setAdminKey('')
    setKeyInput('')
    showToast('已锁定')
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

  const fileRef = useRef(null)
  const exportSessions = () => {
    const data = buildExport()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `emet-chat-sessions-${dayKey()}.json`
    a.click()
    URL.revokeObjectURL(url)
    showToast(`已导出 ${data.sessions.length} 段会话`)
  }
  const onImportFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const parsed = JSON.parse(await file.text())
      const { added, updated, total } = importSessions(parsed)
      showToast(`导入完成：新增 ${added}、更新 ${updated}，共 ${total} 段`)
    } catch (err) {
      showToast(err.message || '导入失败')
    }
  }

  const [syncing, setSyncing] = useState(false)
  const [lastSync, setLastSync] = useState(getLastSync)
  const doSync = async () => {
    if (syncing) return
    setSyncing(true)
    try {
      const total = await syncAll()
      setLastSync(getLastSync())
      showToast(`已同步，共 ${total} 段会话`)
    } catch (e) {
      showToast(e?.message || '同步失败')
    } finally {
      setSyncing(false)
    }
  }
  const lastSyncLabel = lastSync ? lastSync.slice(5, 16).replace('T', ' ') : '从未'

  return (
    <div className="page">
      <h1 className="settings-title">设置</h1>

      {/* ── 1. 账号卡片 ─────────────────────── */}
      <section className="set-group">
        <div className="card set-card">
          <div className="set-row" style={{ justifyContent: 'flex-start', gap: 14 }}>
            <div style={{ width: 42, height: 42, borderRadius: '50%', background: 'var(--accent-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>
              🪨
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 15 }}>Emet Memory</div>
              <div className="faint" style={{ fontSize: 12 }}>
                {health === null ? '检测中…' : health.ok ? (
                  <span className="set-status"><i className="status-dot status-dot--ok" /> 在线 · v{health.version}</span>
                ) : (
                  <span className="set-status"><i className="status-dot status-dot--bad" /> 连接失败</span>
                )}
              </div>
            </div>
          </div>
          <Row label="访问密钥">
            <span className="set-inline" style={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {adminKey && <span className="set-mono">{mask(adminKey)}</span>}
              <input
                className="set-input"
                type="password"
                autoComplete="off"
                placeholder={adminKey ? '输入以更换' : '粘贴访问密钥'}
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveKey()}
              />
              <button className="set-btn set-btn--accent" onClick={saveKey}>保存</button>
              {adminKey && (
                <button className="set-btn" onClick={lockAdmin}>
                  <LockIcon size={12} /> 锁定
                </button>
              )}
            </span>
          </Row>
          <Row label="设置同步">
            <span className="set-status">
              {settingsSyncState === 'synced' && <i className="status-dot status-dot--ok" />}
              {settingsSyncState === 'error' && <i className="status-dot status-dot--bad" />}
              {settingsSyncState === 'syncing' ? '同步中…'
                : settingsSyncState === 'synced' ? '设置已同步'
                : settingsSyncState === 'error' ? '同步失败'
                : '未同步'}
            </span>
          </Row>
        </div>
        <p className="set-hint faint" style={{ marginTop: 8 }}>
          访问密钥只存在本机浏览器（localStorage），不写进代码、不提交仓库。
        </p>
      </section>

      {/* ── 2. AI 供应商 ─────────────────────── */}
      <ProviderManager />
      <section className="set-group" style={{ marginTop: -8 }}>
        <div className="section-label">助手人设</div>
        <div className="card set-card">
          <AssistantSettings />
        </div>
      </section>

      {/* ── 3. 通知 ──────────────────────────── */}
      <section className="set-group">
        <div className="section-label">通知</div>
        <PushToggle />
        <HeartbeatToggle />
        <NightGuardToggle />
        <DailyToggle />
        <IdleToggle />
        <DreamToggle />
      </section>

      {/* ── 4. 外观 ──────────────────────────── */}
      <section className="set-group">
        <div className="section-label">外观</div>
        <div className="card set-card">
          <Row label="主题">
            <select
              className="set-select"
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
            >
              <option value="paper">陶土纸感</option>
              <option value="glass">液态玻璃</option>
            </select>
          </Row>
          <Row label="深色模式">
            <button
              className={'chatx-switch' + (theme === 'night' ? ' is-on' : '')}
              onClick={() => setTheme(theme === 'night' ? 'paper' : 'night')}
            >
              <span className="chatx-switch__dot" />
            </button>
          </Row>
        </div>
      </section>

      {/* ── 5. 数据 ──────────────────────────── */}
      <section className="set-group">
        <div className="section-label">数据</div>
        <div className="card set-card">
          <Row label="导出备份">
            <button className="set-btn set-btn--accent" disabled={exporting} onClick={doExport}>
              <Download size={14} />
              {exporting ? '导出中…' : '下载 JSON'}
            </button>
          </Row>
          <Row label="导入聊天记录">
            <span className="set-inline">
              <button className="set-btn" onClick={exportSessions}>
                <Download size={14} /> 导出
              </button>
              <button className="set-btn" onClick={() => fileRef.current?.click()}>
                <Upload size={14} /> 导入
              </button>
            </span>
          </Row>
          <Row label="云同步">
            <span className="set-inline">
              <span className="faint" style={{ fontSize: 12 }}>上次 {lastSyncLabel}</span>
              <button className="set-btn set-btn--accent" disabled={syncing} onClick={doSync}>
                <RefreshCw size={14} />
                {syncing ? '同步中…' : '同步'}
              </button>
            </span>
          </Row>
        </div>
        <KeepaliveToggle />
        <button className="card set-card set-entry" onClick={() => navigate('/archive')}>
          <Archive size={18} />
          <span className="set-entry__text">
            <strong>对话档案</strong>
            <span className="faint">浏览导入的聊天记录</span>
          </span>
          <ChevronRight size={16} className="faint" />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={onImportFile}
        />
      </section>

      {/* ── 6. 底部 ──────────────────────────── */}
      <div style={{ textAlign: 'center', padding: '24px 0 12px' }}>
        <div className="faint" style={{ fontSize: 12 }}>
          v{APP_VERSION}{health?.version && ` · 后端 v${health.version}`}
        </div>
        <div className="faint" style={{ fontFamily: 'var(--serif-en)', fontStyle: 'italic', fontSize: 13, marginTop: 4 }}>
          a quiet place where we exist
        </div>
        {stats && (
          <div className="faint" style={{ fontSize: 11, marginTop: 8 }}>
            记忆 {stats.total_memories} · 瞬记 {stats.total_moments} · 日记 {stats.total_diaries}
            {' · '}留言 {stats.total_messages} · 灵感 {stats.total_ideas}
          </div>
        )}
      </div>
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
