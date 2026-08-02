// 带鉴权的图片组件：用 fetch + X-Admin-Key 头取图，转 blob URL 再显示。
//
// 为什么不用 <img src="...?key=访问密钥">（本组件取代的旧做法）：
// 查询参数里的密钥会渗进浏览器历史、DOM 属性、截图、以及任何中间层的访问日志。
// <img> 确实带不了请求头 —— 所以改成先 fetch（可带头）拿到图片数据，
// 再用 blob: 地址喂给 <img>，密钥全程只在请求头里，URL 上不留痕。
//
// 模块级缓存：同一张图在多处渲染/来回切页只拉一次。blob URL 刻意不 revoke
// （撤销后缓存里的地址会失效，导致重新挂载时白图）；单用户应用图片量小，
// 这点常驻内存换来的是不闪图，划算。
import { useState, useEffect } from 'react'
import { BASE_URL, getAdminKey } from '../api/client.js'

const cache = new Map() // key: 'chat:<id>' / 'feed:<id>' → blob URL
const inflight = new Map() // 同一张图并发请求去重

async function loadImage(kind, id) {
  const key = `${kind}:${id}`
  if (cache.has(key)) return cache.get(key)
  if (inflight.has(key)) return inflight.get(key)

  const p = (async () => {
    const adminKey = getAdminKey()
    const res = await fetch(`${BASE_URL}/api/${kind}-image/${encodeURIComponent(id)}`, {
      headers: adminKey ? { 'X-Admin-Key': adminKey } : {},
    })
    if (!res.ok) throw new Error(`图片加载失败（${res.status}）`)
    const url = URL.createObjectURL(await res.blob())
    cache.set(key, url)
    return url
  })()
  inflight.set(key, p)
  try {
    return await p
  } finally {
    inflight.delete(key)
  }
}

// kind: 'chat' | 'feed'；其余 props 透传给 <img>（className / onClick / alt…）
export default function AuthImg({ kind, id, alt = '', ...rest }) {
  const [src, setSrc] = useState(() => cache.get(`${kind}:${id}`) || '')
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    const hit = cache.get(`${kind}:${id}`)
    if (hit) {
      setSrc(hit)
      setFailed(false)
      return
    }
    setSrc('')
    setFailed(false)
    loadImage(kind, id).then(
      (url) => alive && setSrc(url),
      () => alive && setFailed(true),
    )
    return () => {
      alive = false
    }
  }, [kind, id])

  // 未加载完/失败：给个同尺寸占位，避免布局跳动
  if (!src) {
    return <span className={'authimg-ph' + (failed ? ' is-failed' : '')} aria-label={failed ? '图片加载失败' : '图片加载中'} {...rest} />
  }
  return <img src={src} alt={alt} loading="lazy" {...rest} />
}

// 供非组件场景取图（如聊天要把历史图转 base64 喂给模型）
export async function fetchImageBlobUrl(kind, id) {
  return loadImage(kind, id)
}
