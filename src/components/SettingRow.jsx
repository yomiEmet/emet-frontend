// 设置页统一行组件（规范：每个功能一行，左名称+一行小字说明，右控件）
// + iOS 滑动开关（44×26 胶囊，开=accent 底白钮，关=#d4d0c8 底白钮）

export function SetRow({ label, desc, onClick, children }) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag className="set-row" onClick={onClick} type={onClick ? 'button' : undefined}>
      <span className="set-row__main">
        <span className="set-row__name">{label}</span>
        {desc && <span className="set-row__desc">{desc}</span>}
      </span>
      <span className="set-row__val">{children}</span>
    </Tag>
  )
}

export function IosSwitch({ on, disabled, onChange }) {
  return (
    <button
      type="button"
      className={'ios-switch' + (on ? ' is-on' : '')}
      disabled={disabled}
      role="switch"
      aria-checked={!!on}
      onClick={(e) => {
        e.stopPropagation() // 行本身可能有 onClick（如推送行点行发测试），别串
        onChange?.()
      }}
    >
      <span className="ios-switch__knob" />
    </button>
  )
}
