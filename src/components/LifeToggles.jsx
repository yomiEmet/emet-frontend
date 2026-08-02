// 生活三件套 + 纪念日注入的设置开关（四期 4-1 / 4-2 / 4-3）——规范单行版。
// 存 localStorage（emet.receipt / emet.anniv），随设置云同步。

import { useNavigate } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { useLocalStorage } from '../utils/useLocalStorage.js'
import { SetRow, IosSwitch } from './SettingRow.jsx'

// 今日小票：开关控制主页「今日小票」卡显隐（ReceiptCard 自我门禁读同一个键）
export function ReceiptToggle() {
  const [cfg, setCfg] = useLocalStorage('emet.receipt', { enabled: false })
  const enabled = !!cfg?.enabled
  return (
    <SetRow label="今日小票" desc="主页小票卡：随手记今天做了什么">
      <IosSwitch ariaLabel="今日小票开关" on={enabled} onChange={() => setCfg({ ...cfg, enabled: !enabled })} />
    </SetRow>
  )
}

// 经期月历：纯入口行（数据本就在综合月历的经期 tab 可见，不再做显隐门禁）
export function PeriodEntry() {
  const navigate = useNavigate()
  return (
    <SetRow label="经期月历" desc="记录与预测" onClick={() => navigate('/period')}>
      <ChevronRight size={16} className="faint" />
    </SetRow>
  )
}

// 纪念日提醒：开启后 Milestones 里的纪念日临近时（当天或提前 N 天）Emet 聊天时自然提一句
export function AnnivToggle() {
  const [cfg, setCfg] = useLocalStorage('emet.anniv', { enabled: false, advanceDays: 3 })
  const enabled = !!cfg?.enabled
  const advance = Number.isInteger(cfg?.advanceDays) ? cfg.advanceDays : 3
  return (
    <>
      <SetRow label="纪念日提醒" desc="临近时 Emet 聊天里自然提一句">
        <IosSwitch ariaLabel="纪念日提醒开关" on={enabled} onChange={() => setCfg({ ...cfg, enabled: !enabled })} />
      </SetRow>
      {enabled && (
        <SetRow label="提前提醒" desc="0 = 只在当天提">
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
        </SetRow>
      )}
    </>
  )
}
