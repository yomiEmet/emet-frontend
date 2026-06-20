import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Archive, ChevronRight, Download, Upload, RefreshCw, Lock as LockIcon } from 'lucide-react'
import { showToast } from '../utils/toast.js'
import ProviderManager from '../components/ProviderManager.jsx'
import AssistantSettings from '../components/AssistantSettings.jsx'
import PushToggle from '../components/PushToggle.jsx'
import HeartbeatToggle from '../components/HeartbeatToggle.jsx'
import DailyToggle from '../components/DailyToggle.jsx'
import { BASE_URL, healthCheck, statsGet, backupExport } from '../api.js'
import { getAdminKey, setAdminKey as storeAdminKey, clearAdminKey } from '../api/client.js'
import { buildExport, importSessions } from '../utils/sessions.js'
import { syncAll, getLastSync } from '../utils/sync.js'
import { pullSettings, pushSettings, getSyncState } from '../utils/settingsSync.js'
import { daysTogether, sinceLabel, dayKey } from '../utils/time.js'

const APP_VERSION = '0.1.0'

// 密钥只显示后 4 位
const mask = (k) => '···· ' + k.slice(-4)

export default function Settings() {
  const navigate = useNavigate()

  // 后端连接状态：null=检测中
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
    return () => {
      alive = false
    }
  }, [])

  // 设置同步状态（settingsSync 派发 'emet:settings-sync'）
  const [settingsSyncState, setSettingsSyncState] = useState(getSyncState)
  useEffect(() => {
    const h = (e) => setSettingsSyncState(e.detail)
    window.addEventListener('emet:settings-sync', h)
    return () => window.removeEventListener('emet:settings-sync', h)
  }, [])

  // 保存访问密钥到本机；随后立刻从云端拉取设置覆盖本地（"一个密钥全同步"）
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
        // 云端尚无设置 → 用本地播种云端
        await pushSettings()
        showToast('已将本地设置上传到云端')
      }
    } catch {
      /* 离线/失败：忽略，下次再同步 */
    }
  }
  // A10 改良：主动"锁定"= 清掉本机密钥，下次请求需重新填写
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

  // ── 会话存档：导出全部会话为带版本号的 JSON / 导入合并 ──
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
    e.target.value = '' // 清空，允许重复选同一文件
    if (!file) return
    try {
      const parsed = JSON.parse(await file.text())
      const { added, updated, total } = importSessions(parsed)
      showToast(`导入完成：新增 ${added}、更新 ${updated}，共 ${total} 段`)
    } catch (err) {
      showToast(err.message || '导入失败')
    }
  }

  // 云同步：全量对账
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
              {settingsSyncState === 'syncing'
                ? '同步中…'
                : settingsSyncState === 'synced'
                  ? '设置已同步'
                  : settingsSyncState === 'error'
                    ? '同步失败'
                    : '未同步'}
            </span>
          </Row>
        </div>
        <p className="set-hint faint" style={{ marginTop: 8 }}>
          访问密钥只存在本机浏览器（localStorage），不写进代码、不提交仓库。助手/供应商/待办/心情会随密钥自动云同步。
        </p>
      </section>

      {/* ── 通知（Web Push 推送开关 + 心跳系统主动消息）────────────── */}
      <section className="set-group">
        <div className="section-label">通知</div>
        <PushToggle />
        <HeartbeatToggle />
        <DailyToggle />
      </section>

      {/* ── 供应商管理（多供应商，聊天页用）────── */}
      <ProviderManager />
      <p className="set-hint faint" style={{ marginTop: -12, marginBottom: 20 }}>
        Key 只存在本机浏览器，不会发给后端。中转站大多选「OpenAI 兼容」。
      </p>

      {/* ── 助手（单助手，所有会话共用；聊天页顶栏也可进入）────── */}
      <section className="set-group">
        <div className="section-label">助手</div>
        <div className="card set-card">
          <AssistantSettings />
        </div>
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

      {/* ── 会话存档（聊天记录导出/导入）─────────── */}
      <section className="set-group">
        <div className="section-label">会话存档</div>
        <div className="card set-card">
          <Row label="导出全部会话">
            <button className="set-btn set-btn--accent" onClick={exportSessions}>
              <Download size={14} /> 下载 JSON
            </button>
          </Row>
          <Row label="导入会话">
            <button className="set-btn" onClick={() => fileRef.current?.click()}>
              <Upload size={14} /> 选择文件
            </button>
          </Row>
          <Row label="云同步">
            <span className="set-inline">
              <span className="faint" style={{ fontSize: 12 }}>上次 {lastSyncLabel}</span>
              <button className="set-btn set-btn--accent" disabled={syncing} onClick={doSync}>
                <RefreshCw size={14} />
                {syncing ? '同步中…' : '立即同步'}
              </button>
            </span>
          </Row>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={onImportFile}
        />
        <p className="set-hint faint" style={{ marginTop: 8 }}>
          导入会与现有会话合并；相同会话 ID 冲突时保留时间较新的一份。
        </p>
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
