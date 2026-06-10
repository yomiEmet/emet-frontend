// 全局 toast（沿用旧前端 showToast 的交互：底部弹出 2 秒）
// 不走 React 状态——单例 DOM，哪里都能调，避免每个页面接 context。
let el = null
let timer = null

export function showToast(msg) {
  if (!el) {
    el = document.createElement('div')
    el.className = 'toast'
    document.body.appendChild(el)
  }
  el.textContent = msg
  el.classList.add('show')
  clearTimeout(timer)
  timer = setTimeout(() => el.classList.remove('show'), 2000)
}
