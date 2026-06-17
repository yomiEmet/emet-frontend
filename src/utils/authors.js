// 日记作者 / 留言发送者的显示名（v66 的 author / from 字段）
// 日记 chip 筛选：去掉 Emet / 静怡 两条（日记几乎都是 Emet 写的，没必要按作者分），
// 数据层 author 字段不动；想看作者标注请进日记详情底部 author_label。
export const DIARY_AUTHORS = [
  { key: 'all', label: '全部' },
  { key: 'story', label: '故事' },
]

export function diaryAuthorLabel(author) {
  return DIARY_AUTHORS.find((a) => a.key === author)?.label || author
}
