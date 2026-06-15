import { useState, useEffect, useRef } from 'react'
import { notifyKeyChanged } from './settingsSync.js'

// 本地偏好存储（设计允许：localStorage 只用于本地偏好，核心数据走 v66 API）。
// 待办、心情先用这个。属于云同步集（emet.todos/emet.moods）的键变更时会防抖推到云端。
export function useLocalStorage(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw != null ? JSON.parse(raw) : initial
    } catch {
      return initial
    }
  })

  const mounted = useRef(false)
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      /* 隐私模式或配额满，忽略 */
    }
    // 仅在真正变更时推送，跳过挂载首写（避免每次加载都上传）
    if (mounted.current) notifyKeyChanged(key)
    else mounted.current = true
  }, [key, value])

  return [value, setValue]
}
