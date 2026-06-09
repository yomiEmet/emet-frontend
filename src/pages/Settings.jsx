import { Settings as SettingsIcon } from 'lucide-react'

export default function Settings() {
  return (
    <div className="page">
      <div className="placeholder">
        <SettingsIcon size={48} strokeWidth={1.4} />
        <h2>设置</h2>
        <p>API 配置、主题切换、记忆库连接、档案、关于。</p>
      </div>
    </div>
  )
}
