import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import {
  loadAssistant,
  saveAssistant,
  PRESET_AVATARS,
} from '../utils/assistant.js'
import { SetRow, IosSwitch } from './SettingRow.jsx'

// 头像渲染：emoji 或内置预设图。Chat 页与设置里都用它。
export function AssistantAvatar({ avatar, size = 22 }) {
  if (avatar?.type === 'preset') {
    const src = PRESET_AVATARS[avatar.value] || PRESET_AVATARS.otter
    return <img className="asst-avatar-img" src={src} width={size} height={size} alt="" />
  }
  return (
    <span className="asst-avatar-emoji" style={{ fontSize: Math.round(size * 0.92) }}>
      {avatar?.value || '🦦'}
    </span>
  )
}

// 助手设置——规范单行版。设置改动即时写入 localStorage（数字字段失焦时落库）。
// onChange(next) 让外层（聊天页标题/气泡）实时刷新。
// 头像选择网格已删（聊天页消息不再显示头像）；avatar 存储字段保留，顶栏小头像照旧。
export default function AssistantSettings({ onChange }) {
  const [a, setA] = useState(loadAssistant)
  // 数字字段用本地字符串态，失焦/回车时再 sanitize 落库，避免输入中途被打断
  const [ctxStr, setCtxStr] = useState(String(a.contextCount))
  const [maxStr, setMaxStr] = useState(String(a.maxTokens))
  const [promptOpen, setPromptOpen] = useState(false)

  const apply = (patch) => {
    const next = saveAssistant(patch)
    setA(next)
    onChange?.(next)
  }

  const commitCtx = () => {
    const n = Math.max(1, parseInt(ctxStr, 10) || a.contextCount)
    setCtxStr(String(n))
    apply({ contextCount: n })
  }
  const commitMax = () => {
    const n = Math.max(1, parseInt(maxStr, 10) || a.maxTokens)
    setMaxStr(String(n))
    apply({ maxTokens: n })
  }

  const sp = a.systemPrompt || ''
  const spPreview = sp ? (sp.length > 20 ? sp.slice(0, 20) + '…' : sp) : '（未设置）'

  return (
    <>
      {/* 名称 */}
      <SetRow label="名称">
        <input
          className="set-input"
          style={{ maxWidth: 160 }}
          value={a.name}
          maxLength={20}
          onChange={(e) => apply({ name: e.target.value })}
        />
      </SetRow>

      {/* 系统提示词：折叠行，点开才显示完整 textarea */}
      <button type="button" className="set-row" onClick={() => setPromptOpen((v) => !v)}>
        <span className="set-row__main">
          <span className="set-row__name">系统提示词</span>
          <span className="set-row__desc">{spPreview}</span>
        </span>
        <ChevronRight size={16} className={'set-caret' + (promptOpen ? ' is-open' : '')} />
      </button>
      <div className={'set-collapse set-collapse--tall' + (promptOpen ? ' is-open' : '')}>
        <div className="set-collapse__inner" style={{ alignItems: 'stretch' }}>
          <textarea
            className="asst-textarea"
            style={{ height: 160, overflowY: 'auto', resize: 'none' }}
            value={a.systemPrompt}
            placeholder="给助手的人设与指令…"
            onChange={(e) => apply({ systemPrompt: e.target.value })}
          />
          <p className="faint" style={{ fontSize: 11, lineHeight: 1.5 }}>
            以下内容会自动追加：最近记忆、日记摘要、当前时间。
          </p>
        </div>
      </div>

      {/* 分气泡模式 */}
      <SetRow label="分气泡模式" desc="回复按段落拆成气泡，双击进观察模式">
        <IosSwitch ariaLabel="分气泡模式开关" on={!!a.bubbleMode} onChange={() => apply({ bubbleMode: !a.bubbleMode })} />
      </SetRow>

      {/* temperature */}
      <SetRow label="temperature" desc="仅 OpenAI 兼容协议生效">
        <span className="asst-slider-wrap">
          <input
            className="slider"
            type="range"
            min={0}
            max={1}
            step={0.1}
            value={a.temperature}
            onChange={(e) => apply({ temperature: parseFloat(e.target.value) })}
          />
          <span className="slider-val">{Number(a.temperature).toFixed(1)}</span>
        </span>
      </SetRow>

      {/* 上下文条数 N */}
      <SetRow label="上下文条数" desc="每次请求只携带最近 N 条">
        <input
          className="set-input asst-input-num"
          type="number"
          min={1}
          value={ctxStr}
          onChange={(e) => setCtxStr(e.target.value)}
          onBlur={commitCtx}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
      </SetRow>

      {/* max_tokens */}
      <SetRow label="max_tokens">
        <input
          className="set-input asst-input-num"
          type="number"
          min={1}
          value={maxStr}
          onChange={(e) => setMaxStr(e.target.value)}
          onBlur={commitMax}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
      </SetRow>
    </>
  )
}
