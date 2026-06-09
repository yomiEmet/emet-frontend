// 记忆分类（设计 6.2）。key 对应 v66 的 category 字段。
export const CATEGORIES = [
  { key: 'core', label: '核心', color: 'var(--cat-core)' },
  { key: 'scene', label: '情景', color: 'var(--cat-scene)' },
  { key: 'emotion', label: '情绪', color: 'var(--cat-emotion)' },
  { key: 'semantic', label: '语义', color: 'var(--cat-semantic)' },
  { key: 'image', label: '形象', color: 'var(--cat-image)' },
  { key: 'procedure', label: '程序', color: 'var(--cat-procedure)' },
]

const BY_KEY = Object.fromEntries(CATEGORIES.map((c) => [c.key, c]))

export function categoryOf(key) {
  return BY_KEY[key] || { key, label: key, color: 'var(--text-muted)' }
}
