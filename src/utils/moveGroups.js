// 移动通道分组（对齐 home 的导航：记忆 / 年轮 / 留言）。
// 「年轮」=记忆 tab 下面的 rings subtab（瞬记/日记/故事）。
// 「留言」=底部 tab 留言 下面的 subtabs（便条=message / 想法=idea）。

export const MOVE_GROUPS = [
  { key: 'memory', label: '记忆', leaf: 'memory' }, // 直接跳，无子菜单
  {
    key: 'rings',
    label: '年轮',
    children: [
      { key: 'moment', label: '瞬记' },
      { key: 'diary', label: '日记' },
      { key: 'story', label: '故事' },
    ],
  },
  {
    key: 'letters',
    label: '留言',
    children: [
      { key: 'message', label: '便条' },
      { key: 'idea', label: '想法' },
    ],
  },
]

// 取指定 type 的中文 label
export function moveLabel(typeKey) {
  for (const g of MOVE_GROUPS) {
    if (g.leaf === typeKey) return g.label
    if (g.children) {
      const found = g.children.find((c) => c.key === typeKey)
      if (found) return found.label
    }
  }
  return typeKey
}

// 取一个分组里、排除掉 currentType 之后剩余的子项
export function visibleChildren(group, currentType) {
  if (!group.children) return []
  return group.children.filter((c) => c.key !== currentType)
}

// 判断某个分组在排除 currentType 之后还有可见项
export function groupHasOptions(group, currentType) {
  if (group.leaf) return group.leaf !== currentType
  return visibleChildren(group, currentType).length > 0
}
