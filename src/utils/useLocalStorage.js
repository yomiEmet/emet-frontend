import { useState, useEffect } from 'react'

// 本地偏好存储（设计允许：localStorage 只用于本地偏好，核心数据走 v66 API）。
// 待办、心情先用这个，以后再接后端。
export function useLocalStorage(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw != null ? JSON.parse(raw) : initial
    } catch {
      return initial
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      /* 隐私模式或配额满，忽略 */
    }
  }, [key, value])

  return [value, setValue]
}
