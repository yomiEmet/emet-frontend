// 日记作者 / 留言发送者的显示名（v66 的 author / from 字段）
export const DIARY_AUTHORS = [
  { key: 'all', label: '全部' },
  { key: 'emet', label: 'Emet' },
  { key: 'yomi', label: '静怡' },
  { key: 'story', label: '故事' },
]

export function diaryAuthorLabel(author) {
  return DIARY_AUTHORS.find((a) => a.key === author)?.label || author
}
