import { useState } from 'react'
import {
  loadAssistant,
  saveAssistant,
  EMOJI_CHOICES,
  PRESET_AVATARS,
} from '../utils/assistant.js'

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

// 助手设置表单。设置改动即时写入 localStorage（数字字段失焦时落库）。
// onChange(next) 让外层（聊天页标题/气泡）实时刷新。
export default function AssistantSettings({ onChange }) {
  const [a, setA] = useState(loadAssistant)
  // 数字字段用本地字符串态，失焦/回车时再 sanitize 落库，避免输入中途被打断
  const [ctxStr, setCtxStr] = useState(String(a.contextCount))
  const [maxStr, setMaxStr] = useState(String(a.maxTokens))

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

  const isAvatar = (type, value) => a.avatar?.type === type && a.avatar?.value === value

  return (
    <div className="asst-form">
      {/* 名称 */}
      <label className="asst-field">
        <span className="asst-label">名称</span>
        <input
          className="set-input"
          value={a.name}
          maxLength={20}
          onChange={(e) => apply({ name: e.target.value })}
        />
      </label>

      {/* 头像：emoji 网格 + 内置预设图 */}
      <div className="asst-field asst-field--col">
        <span className="asst-label">头像</span>
        <div className="asst-avatar-grid">
          {EMOJI_CHOICES.map((e) => (
            <button
              key={e}
              type="button"
              className={'asst-avatar-opt' + (isAvatar('emoji', e) ? ' is-active' : '')}
              onClick={() => apply({ avatar: { type: 'emoji', value: e } })}
            >
              <span className="asst-avatar-emoji" style={{ fontSize: 20 }}>{e}</span>
            </button>
          ))}
          {Object.keys(PRESET_AVATARS).map((key) => (
            <button
              key={key}
              type="button"
              className={'asst-avatar-opt' + (isAvatar('preset', key) ? ' is-active' : '')}
              onClick={() => apply({ avatar: { type: 'preset', value: key } })}
            >
              <img className="asst-avatar-img" src={PRESET_AVATARS[key]} width={22} height={22} alt={key} />
            </button>
          ))}
        </div>
      </div>

      {/* 系统提示词 */}
      <div className="asst-field asst-field--col">
        <span className="asst-label">系统提示词</span>
        <textarea
          className="asst-textarea"
          rows={5}
          value={a.systemPrompt}
          placeholder="给助手的人设与指令…"
          onChange={(e) => apply({ systemPrompt: e.target.value })}
        />
        <p className="asst-hint faint">以下内容会自动追加：最近记忆、日记摘要、当前时间。</p>
      </div>

      {/* temperature */}
      <div className="asst-field">
        <span className="asst-label">temperature</span>
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
      </div>
      <p className="asst-hint faint">temperature 仅对「OpenAI 兼容」协议生效；Anthropic 原生模型不发送此参数。</p>

      {/* 上下文条数 N */}
      <label className="asst-field">
        <span className="asst-label">上下文条数</span>
        <input
          className="set-input asst-input-num"
          type="number"
          min={1}
          value={ctxStr}
          onChange={(e) => setCtxStr(e.target.value)}
          onBlur={commitCtx}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
      </label>

      {/* max_tokens */}
      <label className="asst-field">
        <span className="asst-label">max_tokens</span>
        <input
          className="set-input asst-input-num"
          type="number"
          min={1}
          value={maxStr}
          onChange={(e) => setMaxStr(e.target.value)}
          onBlur={commitMax}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
      </label>
    </div>
  )
}
