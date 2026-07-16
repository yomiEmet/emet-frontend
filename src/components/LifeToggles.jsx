// 生活三件套 + 纪念日注入的设置开关（四期 4-1 / 4-2 / 4-3），每样独立、默认关。
// 存 localStorage（emet.receipt / emet.period / emet.anniv），随设置云同步。

import { useNavigate } from 'react-router-dom'
import { Receipt, CalendarHeart, CakeSlice, ChevronRight } from 'lucide-react'
import { useLocalStorage } from '../utils/useLocalStorage.js'

function Row({ label, children }) {
  return (
    <div className="set-row">
      <span className="set-row__label">{label}</span>
      <span className="set-row__val">{children}</span>
    </div>
  )
}

// 通用开关卡：读写 localStorage 的 { enabled }
function ToggleCard({ storageKey, title, hint, OnIcon, children }) {
  const [cfg, setCfg] = useLocalStorage(storageKey, { enabled: false })
  const enabled = !!cfg?.enabled
  return (
    <div className="card set-card">
      <Row label={title}>
        <span className="set-status">
          {enabled && <i className="status-dot status-dot--ok" />}
          {enabled ? '已开启' : '已关闭'}
        </span>
      </Row>
      <Row label="操作">
        <button
          className={`set-btn ${enabled ? '' : 'set-btn--accent'}`}
          onClick={() => setCfg({ ...cfg, enabled: !enabled })}
        >
          <OnIcon size={12} /> {enabled ? '关闭' : '开启'}
        </button>
      </Row>
      {enabled && children}
      <p className="set-hint faint" style={{ marginTop: 8, marginBottom: 0 }}>
        {hint}
      </p>
    </div>
  )
}

export function ReceiptToggle() {
  return (
    <ToggleCard
      storageKey="emet.receipt"
      title="今日小票"
      OnIcon={Receipt}
      hint="开启后主页出现「今日小票」——像超市小票一样随手记今天做了什么，按凌晨 4 点切日。你和 Emet 都能往上记。"
    />
  )
}

export function PeriodToggle() {
  const navigate = useNavigate()
  return (
    <ToggleCard
      storageKey="emet.period"
      title="经期月历"
      OnIcon={CalendarHeart}
      hint="开启后可在下面进入经期月历，记录、看预测。数据只存你的记忆库，Emet 可在你问起时读到。"
    >
      <button className="set-inline-entry" onClick={() => navigate('/period')}>
        打开经期月历 <ChevronRight size={14} />
      </button>
    </ToggleCard>
  )
}

export function AnnivToggle() {
  const [cfg, setCfg] = useLocalStorage('emet.anniv', { enabled: false, advanceDays: 3 })
  const enabled = !!cfg?.enabled
  const advance = Number.isInteger(cfg?.advanceDays) ? cfg.advanceDays : 3
  return (
    <div className="card set-card">
      <Row label="纪念日提醒">
        <span className="set-status">
          {enabled && <i className="status-dot status-dot--ok" />}
          {enabled ? '已开启' : '已关闭'}
        </span>
      </Row>
      <Row label="操作">
        <button
          className={`set-btn ${enabled ? '' : 'set-btn--accent'}`}
          onClick={() => setCfg({ ...cfg, enabled: !enabled })}
        >
          <CakeSlice size={12} /> {enabled ? '关闭' : '开启'}
        </button>
      </Row>
      {enabled && (
        <Row label="提前提醒">
          <span className="set-inline">
            <input
              className="anniv-days"
              type="number"
              min={0}
              max={30}
              value={advance}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10)
                setCfg({ ...cfg, advanceDays: Number.isNaN(v) ? 0 : Math.max(0, Math.min(30, v)) })
              }}
            />
            <span className="faint">天</span>
          </span>
        </Row>
      )}
      <p className="set-hint faint" style={{ marginTop: 8, marginBottom: 0 }}>
        开启后，主页 Milestones 里的纪念日临近时（当天或提前 N 天），Emet 聊天时会自然提一句。不做贺卡弹窗。
      </p>
    </div>
  )
}
