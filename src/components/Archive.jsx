import { Upload } from 'lucide-react'

// ═══════════════════════════════════════════════════════════
// 对话档案组件 —— 挂载点。
// 旧前端的 Archive 组件（~2000 行：上传 conversations.json/zip，
// 解析成聊天界面阅读）迁入时整体替换本文件，保持默认导出即可，
// ArchivePage 不用动。
// ═══════════════════════════════════════════════════════════
export default function Archive() {
  return (
    <div className="archive-stub">
      <label className="archive-drop">
        <Upload size={32} strokeWidth={1.5} />
        <span>上传 conversations.json / .zip</span>
        <span className="faint">旧 Archive 组件待迁入，上传功能即将就位</span>
        <input type="file" accept=".json,.zip" disabled hidden />
      </label>
    </div>
  )
}
