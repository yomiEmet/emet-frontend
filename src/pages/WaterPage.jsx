import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, Droplets, X, BellRing } from 'lucide-react'
import { waterGet, waterEntryAdd, waterEntryDelete, waterReminderConfigGet, waterReminderConfigSet } from '../api.js'
import { IosSwitch } from '../components/SettingRow.jsx'
import { dayKey, nowLogical, toCST } from '../utils/time.js'
import { showToast } from '../utils/toast.js'

// 饮品类别（各自带常用默认 ml，选中后仍可改）
const KINDS = [
  { kind: '水', ml: 250, emojiFree: '💧' },
  { kind: '茶', ml: 300, emojiFree: '🍵' },
  { kind: '咖啡', ml: 200, emojiFree: '☕' },
  { kind: '奶茶', ml: 400, emojiFree: '🧋' },
  { kind: '果汁', ml: 300, emojiFree: '🧃' },
  { kind: '汤', ml: 300, emojiFree: '🥣' },
]
const ML_PRESETS = [150, 250, 350, 500]
const INTERVALS = [
  { min: 60, label: '每 1 小时' },
  { min: 90, label: '每 1.5 小时' },
  { min: 120, label: '每 2 小时' },
  { min: 180, label: '每 3 小时' },
]

const p2 = (n) => String(n).padStart(2, '0')
const hhmm = (iso) => {
  const d = toCST(iso)
  return `${p2(d.getHours())}:${p2(d.getMinutes())}`
}

export default function WaterPage() {
  const navigate = useNavigate()
  const today = dayKey(nowLogical())

  const [day, setDay] = useState(null) // { count, total_ml, entries }
  const [kind, setKind] = useState(KINDS[0])
  const [ml, setMl] = useState(KINDS[0].ml)
  const [busy, setBusy] = useState(false)
  const [cfg, setCfg] = useState(null) // 提醒配置

  const load = () =>
    waterGet(today)
      .then((d) => setDay(d))
      .catch(() => setDay({ count: 0, total_ml: 0, entries: [] }))

  useEffect(() => {
    load()
    waterReminderConfigGet()
      .then((r) => setCfg(r?.config || null))
      .catch(() => {})
  }, [])

  const pickKind = (k) => {
    setKind(k)
    setMl(k.ml)
  }

  const add = async () => {
    if (busy) return
    const n = Math.round(Number(ml))
    if (!(n > 0 && n <= 3000)) {
      showToast('ml 要在 1-3000 之间')
      return
    }
    setBusy(true)
    try {
      const r = await waterEntryAdd({ date: today, ml: n, kind: kind.kind })
      setDay({ count: r.count, total_ml: r.total_ml, entries: r.entries })
      showToast(`记下 ${kind.kind} ${n}ml`)
    } catch (e) {
      showToast(e?.message || '记录失败')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id) => {
    try {
      const r = await waterEntryDelete({ date: today, id })
      setDay({ count: r.count, total_ml: r.total_ml, entries: r.entries })
    } catch (e) {
      showToast(e?.message || '删除失败')
    }
  }

  const saveCfg = async (patch) => {
    const next = { ...cfg, ...patch }
    setCfg(next) // 乐观更新
    try {
      const r = await waterReminderConfigSet(patch)
      if (r?.config) setCfg(r.config)
    } catch (e) {
      showToast(e?.message || '保存失败')
      waterReminderConfigGet().then((r) => setCfg(r?.config || null)).catch(() => {})
    }
  }

  const target = cfg?.target_cups || 7
  const count = day?.count || 0
  const entries = day?.entries || []

  return (
    <div className="page">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
        <button onClick={() => navigate(-1)} style={{ display: 'flex', color: 'var(--ink)' }}>
          <ChevronLeft size={22} />
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: 'var(--serif-zh)', fontSize: 18, fontWeight: 500 }}>喝水</div>
          <div style={{ fontSize: 12, color: 'var(--ink-faint)' }}>今天 {count} 杯 · {day?.total_ml || 0} ml</div>
        </div>
        <Droplets size={20} style={{ color: 'var(--accent)' }} />
      </div>

      {/* 进度 */}
      <div className="card" style={{ padding: '18px 20px', marginBottom: 'var(--gap-card)', textAlign: 'center' }}>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 8 }}>
          {Array.from({ length: target }, (_, i) => (
            <div key={i} style={{
              width: 14, height: 14, borderRadius: '50%',
              background: i < count ? 'var(--accent)' : 'var(--line)',
              transition: 'background 0.15s'
            }} />
          ))}
        </div>
        <div style={{ fontSize: 12, color: 'var(--ink-faint)' }}>
          {count >= target ? '今日目标达成 🎉' : `目标 ${target} 杯，还差 ${target - count} 杯`}
        </div>
      </div>

      {/* 快捷添加 */}
      <div className="card" style={{ padding: '16px 18px', marginBottom: 'var(--gap-card)' }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-soft)', marginBottom: 10 }}>记一杯</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
          {KINDS.map((k) => (
            <button
              key={k.kind}
              className={'chip' + (kind.kind === k.kind ? ' is-active' : '')}
              style={{ padding: '5px 12px' }}
              onClick={() => pickKind(k)}
            >
              {k.kind}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {ML_PRESETS.map((v) => (
            <button
              key={v}
              className={'chip' + (Number(ml) === v ? ' is-active' : '')}
              style={{ padding: '4px 10px', fontSize: 12 }}
              onClick={() => setMl(v)}
            >
              {v}
            </button>
          ))}
          <input
            type="number"
            min={1}
            max={3000}
            value={ml}
            onChange={(e) => setMl(e.target.value)}
            className="set-input"
            style={{ width: 70, textAlign: 'center' }}
          />
          <span style={{ fontSize: 12, color: 'var(--ink-faint)' }}>ml</span>
          <span style={{ flex: 1 }} />
          <button className="mini-btn mini-btn--accent" disabled={busy} onClick={add}>
            {busy ? '记…' : `+ ${kind.kind}`}
          </button>
        </div>
      </div>

      {/* 今日记录 */}
      {entries.length > 0 && (
        <div className="card" style={{ padding: '8px 0', marginBottom: 'var(--gap-card)' }}>
          {[...entries].reverse().map((e) => (
            <div key={e.id} className="water-entry">
              <span className="water-entry__time">{hhmm(e.ts)}</span>
              <span className="water-entry__kind">{e.kind}</span>
              <span className="water-entry__ml">{e.ml} ml</span>
              <button className="water-entry__del" onClick={() => remove(e.id)} aria-label="删除">
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 喝水提醒 */}
      <div className="card" style={{ padding: '4px 0' }}>
        <div className="set-row">
          <span className="set-row__main">
            <span className="set-row__name" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <BellRing size={14} style={{ color: 'var(--accent)' }} /> 喝水提醒
            </span>
            <span className="set-row__desc">
              {cfg ? `${cfg.start_hour}:00–${cfg.end_hour}:00 落后进度才提醒` : '加载中…'}
            </span>
          </span>
          <IosSwitch on={!!cfg?.enabled} disabled={!cfg} onChange={() => saveCfg({ enabled: !cfg.enabled })} />
        </div>
        {cfg?.enabled && (
          <div className="set-row">
            <span className="set-row__name">提醒间隔</span>
            <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {INTERVALS.map((iv) => (
                <button
                  key={iv.min}
                  className={'chip' + (cfg.interval_min === iv.min ? ' is-active' : '')}
                  style={{ padding: '3px 10px', fontSize: 12 }}
                  onClick={() => saveCfg({ interval_min: iv.min })}
                >
                  {iv.label}
                </button>
              ))}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
