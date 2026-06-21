import { useRef, useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { memoryAll } from '../api.js'

// 星图 v2 · Miró 视觉预览（基于你的 DailyVariation demo）
// 保留 Galaxy 所有交互（拖拽、pinch、滚轮、双击复位、LOD），只替换画法和调色板
// 默认不启用，通过 URL ?gv=2 进入

const MIRO = {
  red: '#C1462B',
  blue: '#2B4C8A',
  yellow: '#E8B828',
  green: '#4A7C5C',
  black: '#1A1A1A',
  bg: '#F5F0E8',
  warmGray: '#D8D0C4',
  card: '#FDFBF7',
}

// Emet 6 分类 → Miró 颜色 + 形状映射
const CATS = {
  core:      { color: MIRO.red,    shape: 'star',     label: '核心' },
  scene:     { color: MIRO.green,  shape: 'triangle', label: '情景' },
  emotion:   { color: MIRO.red,    shape: 'crescent', label: '情绪' },
  semantic:  { color: MIRO.blue,   shape: 'square',   label: '语义' },
  image:     { color: MIRO.yellow, shape: 'circle',   label: '形象' },
  procedure: { color: MIRO.black,  shape: 'hex',      label: '程序' },
}
const SHAPE_GLYPH = { circle: '●', triangle: '▲', star: '★', square: '■', crescent: '☽', hex: '⬡' }
const CAT_KEYS = Object.keys(CATS)

const MIN_SCALE = 0.3
const MAX_SCALE = 4
const LOD_LABEL = 0.65
const LOD_LINKS = 0.45
const CLICK_SLOP = typeof window !== 'undefined' && 'ontouchstart' in window ? 12 : 6

function seeded(i) {
  const x = Math.sin(i * 127.1 + 0.5) * 43758.5453
  return x - Math.floor(x)
}

export default function GalaxyMiro({ focusId = null }) {
  const navigate = useNavigate()
  const wrapRef = useRef(null)
  const canvasRef = useRef(null)
  const S = useRef({
    nodes: [], links: [], sel: null, t: 0, raf: 0, W: 0, H: 0, dpr: 1,
    cam: { tx: 0, ty: 0, scale: 1 },
    pointers: new Map(),
    pinch: null,
    drag: null,
    bounds: null,
    bgDots: [],
  })
  const [selNode, setSelNode] = useState(null)
  const [status, setStatus] = useState('loading')

  useEffect(() => {
    let alive = true
    memoryAll()
      .then((list) => {
        if (!alive) return
        const nodes = list.map((m) => ({
          id: m.id,
          cat: CATS[m.category] ? m.category : 'semantic',
          imp: m.rawImportance || 5,
          text: m.content,
          tags: m.tags,
          label: (m.content || '').replace(/\s+/g, ' ').slice(0, 8),
        }))
        const idx = {}
        nodes.forEach((n, i) => (idx[n.id] = i))
        const seen = {}
        const links = []
        list.forEach((m) => {
          ;(m.linked || []).forEach((lid) => {
            if (idx[lid] == null) return
            const a = idx[m.id]
            const b = idx[lid]
            const key = a < b ? a + '-' + b : b + '-' + a
            if (seen[key]) return
            seen[key] = 1
            links.push([a, b])
          })
        })
        S.current.nodes = nodes
        S.current.links = links
        if (focusId && idx[focusId] != null) {
          S.current.sel = idx[focusId]
          setSelNode(nodes[idx[focusId]])
        }
        setStatus(nodes.length ? 'ready' : 'error')
      })
      .catch(() => alive && setStatus('error'))
    return () => { alive = false }
  }, [focusId])

  const layout = useCallback(() => {
    const st = S.current
    const { W, H } = st
    const cx = W / 2
    const cy = H / 2

    // 散布算法（不再圆周）：用 seeded 随机分散到一个矩形区域，靠 importance 推开重叠的程度
    // 区域大小：以视口为基准放大 1.4 倍（默认看到 ~70%，可以拖动看四周）
    const spreadW = W * 1.4
    const spreadH = H * 1.4
    st.nodes.forEach((n, i) => {
      // 用三组 seeded 散布；按分类轻微"聚类"——同分类有个偏好象限
      const ci = CAT_KEYS.indexOf(n.cat)
      const sectorAngle = (ci / CAT_KEYS.length) * Math.PI * 2
      const sectorCx = cx + Math.cos(sectorAngle) * Math.min(W, H) * 0.18
      const sectorCy = cy + Math.sin(sectorAngle) * Math.min(W, H) * 0.18

      const a = seeded(i) * Math.PI * 2
      const r = seeded(i + 11) * Math.min(spreadW, spreadH) * 0.42
      n.ox = sectorCx + Math.cos(a) * r
      n.oy = sectorCy + Math.sin(a) * r
      n.x = n.ox
      n.y = n.oy
      // Miró 风格节点更大：demo 用 12 + imp*4，但 100+ 节点会爆——折中 5 + imp*1.6
      n.r = 5 + n.imp * 1.6
      n.ph = seeded(i + 7) * Math.PI * 2
    })

    // 包围盒
    if (st.nodes.length > 0) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (const n of st.nodes) {
        if (n.ox < minX) minX = n.ox
        if (n.ox > maxX) maxX = n.ox
        if (n.oy < minY) minY = n.oy
        if (n.oy > maxY) maxY = n.oy
      }
      const pad = 100
      st.bounds = { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad }
    } else {
      st.bounds = null
    }

    // 背景小点（confetti 风格）—— 一次性生成屏幕级伪随机点
    const dots = []
    for (let i = 0; i < 28; i++) {
      const px = seeded(i * 3 + 13)
      const py = seeded(i * 3 + 29)
      const r = 1.2 + (i % 3) * 0.8
      const alpha = 0.06 + (i % 4) * 0.025
      dots.push({ px, py, r, alpha })
    }
    st.bgDots = dots
  }, [])

  const resize = useCallback(() => {
    const st = S.current
    const cvs = canvasRef.current
    const wrap = wrapRef.current
    if (!cvs || !wrap) return
    const dpr = window.devicePixelRatio || 1
    st.dpr = dpr
    st.W = wrap.clientWidth
    st.H = wrap.clientHeight
    cvs.width = st.W * dpr
    cvs.height = st.H * dpr
    cvs.style.width = st.W + 'px'
    cvs.style.height = st.H + 'px'
    layout()
  }, [layout])

  const clampCam = useCallback(() => {
    const st = S.current
    const cam = st.cam
    cam.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, cam.scale))
    if (!st.bounds) return
    const { minX, minY, maxX, maxY } = st.bounds
    const handle = 60
    cam.tx = Math.min(st.W - handle - minX * cam.scale, cam.tx)
    cam.tx = Math.max(handle - maxX * cam.scale, cam.tx)
    cam.ty = Math.min(st.H - handle - minY * cam.scale, cam.ty)
    cam.ty = Math.max(handle - maxY * cam.scale, cam.ty)
  }, [])

  const draw = useCallback(() => {
    const st = S.current
    const cvs = canvasRef.current
    if (!cvs) return
    const ctx = cvs.getContext('2d')
    const { W, H, sel, cam, dpr } = st
    st.t += 0.005

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = MIRO.bg
    ctx.fillRect(0, 0, W, H)

    // 背景 confetti 小点（屏幕坐标）
    ctx.save()
    for (const d of st.bgDots) {
      ctx.globalAlpha = d.alpha
      ctx.fillStyle = MIRO.black
      ctx.beginPath()
      ctx.arc(d.px * W, d.py * H, d.r, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()

    // 应用视角变换
    ctx.save()
    ctx.translate(cam.tx, cam.ty)
    ctx.scale(cam.scale, cam.scale)

    // 漂浮（Miró 风格保留一点呼吸感但弱化）
    st.nodes.forEach((n) => {
      n.x = n.ox + Math.sin(st.t + n.ph) * 0.8
      n.y = n.oy + Math.cos(st.t * 0.6 + n.ph) * 0.6
    })

    // 藤蔓：Miró 风格细黑线，二次贝塞尔随机弯
    if (cam.scale >= LOD_LINKS) {
      st.links.forEach((l) => {
        const na = st.nodes[l[0]]
        const nb = st.nodes[l[1]]
        const isSel = sel !== null && (l[0] === sel || l[1] === sel)
        const alpha = sel === null ? 0.15 : isSel ? 0.45 : 0.04
        const mx = (na.x + nb.x) / 2
        const my = (na.y + nb.y) / 2
        const dx = nb.x - na.x
        const dy = nb.y - na.y
        // 弯度按 ID 偏，让每条藤蔓都不一样
        const bend = ((l[0] * 31 + l[1] * 17) % 7) - 3
        const cx1 = mx - dy * 0.18 + bend * 5
        const cy1 = my + dx * 0.18 + bend * 4
        ctx.save()
        ctx.globalAlpha = alpha
        ctx.strokeStyle = MIRO.black
        ctx.lineWidth = (isSel ? 1.4 : 1.0) / cam.scale
        if (!isSel && sel !== null) ctx.setLineDash([6 / cam.scale, 4 / cam.scale])
        ctx.beginPath()
        ctx.moveTo(na.x, na.y)
        ctx.quadraticCurveTo(cx1, cy1, nb.x, nb.y)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.restore()
      })
    }

    // 节点：Miró 形状 + 调色板
    st.nodes.forEach((n, i) => {
      const c = CATS[n.cat]
      const isSel = sel === i
      const isLn =
        sel !== null && st.links.some((l) => (l[0] === sel && l[1] === i) || (l[1] === sel && l[0] === i))
      const dim = sel !== null && !isSel && !isLn
      const alpha = dim ? 0.18 : isSel ? 1 : 0.9
      drawMiro(ctx, n.x, n.y, n.r, c.shape, c.color, alpha, n.imp, isSel, cam.scale)
      // LOD：scale 大才画标签（关联也画）
      if (cam.scale >= LOD_LABEL && (isSel || isLn)) {
        drawLabel(ctx, n.x, n.y, n.r, n.label, MIRO.black, isSel ? 0.7 : 0.4, cam.scale)
      }
    })

    ctx.restore()
    st.raf = requestAnimationFrame(draw)
  }, [])

  const screenToWorld = (sx, sy) => {
    const cam = S.current.cam
    return { x: (sx - cam.tx) / cam.scale, y: (sy - cam.ty) / cam.scale }
  }

  const handleClick = (sx, sy) => {
    const st = S.current
    const { x: wx, y: wy } = screenToWorld(sx, sy)
    let hit = -1
    let bestDist = Infinity
    st.nodes.forEach((n, i) => {
      const d = Math.hypot(n.x - wx, n.y - wy)
      // 优先选距离最近的命中（解决重叠时点不到的问题）
      if (d < n.r + 12 / st.cam.scale && d < bestDist) {
        bestDist = d
        hit = i
      }
    })
    if (hit >= 0) {
      st.sel = st.sel === hit ? null : hit
      setSelNode(st.sel === null ? null : st.nodes[st.sel])
    } else {
      st.sel = null
      setSelNode(null)
    }
  }

  const onPointerDown = (e) => {
    const st = S.current
    const rect = wrapRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    st.pointers.set(e.pointerId, { x, y, startX: x, startY: y })
    e.target.setPointerCapture?.(e.pointerId)

    if (st.pointers.size === 1) {
      st.drag = { lastX: x, lastY: y, moved: 0 }
      st.pinch = null
    } else if (st.pointers.size === 2) {
      const pts = [...st.pointers.values()]
      const dx = pts[0].x - pts[1].x
      const dy = pts[0].y - pts[1].y
      st.pinch = {
        startDist: Math.hypot(dx, dy) || 1,
        startScale: st.cam.scale,
        startTx: st.cam.tx,
        startTy: st.cam.ty,
        cx: (pts[0].x + pts[1].x) / 2,
        cy: (pts[0].y + pts[1].y) / 2,
      }
      st.drag = null
    }
  }

  const onPointerMove = (e) => {
    const st = S.current
    if (!st.pointers.has(e.pointerId)) return
    const rect = wrapRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const prev = st.pointers.get(e.pointerId)
    st.pointers.set(e.pointerId, { ...prev, x, y })

    if (st.pinch && st.pointers.size === 2) {
      const pts = [...st.pointers.values()]
      const dx = pts[0].x - pts[1].x
      const dy = pts[0].y - pts[1].y
      const dist = Math.hypot(dx, dy) || 1
      const ratio = dist / st.pinch.startDist
      const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, st.pinch.startScale * ratio))
      const { cx, cy, startScale, startTx, startTy } = st.pinch
      st.cam.scale = newScale
      st.cam.tx = cx - (newScale / startScale) * (cx - startTx)
      st.cam.ty = cy - (newScale / startScale) * (cy - startTy)
      clampCam()
    } else if (st.drag) {
      if (st.drag.skipNext) {
        st.drag.skipNext = false
        st.drag.lastX = x
        st.drag.lastY = y
        return
      }
      const dx = x - st.drag.lastX
      const dy = y - st.drag.lastY
      st.cam.tx += dx
      st.cam.ty += dy
      st.drag.lastX = x
      st.drag.lastY = y
      st.drag.moved += Math.abs(dx) + Math.abs(dy)
      clampCam()
    }
  }

  const onPointerUp = (e) => {
    const st = S.current
    if (!st.pointers.has(e.pointerId)) return
    const ptr = st.pointers.get(e.pointerId)
    st.pointers.delete(e.pointerId)

    if (st.drag && st.drag.moved < CLICK_SLOP && st.pointers.size === 0) {
      handleClick(ptr.startX, ptr.startY)
    }

    if (st.pointers.size === 1) {
      const remaining = [...st.pointers.values()][0]
      st.drag = { lastX: remaining.x, lastY: remaining.y, moved: 0, skipNext: true }
      if (st.pinch) st.lastPinchEnd = Date.now()
      st.pinch = null
    } else if (st.pointers.size === 0) {
      if (st.pinch) st.lastPinchEnd = Date.now()
      st.drag = null
      st.pinch = null
    }
  }

  useEffect(() => {
    if (status !== 'ready') return
    resize()
    S.current.raf = requestAnimationFrame(draw)
    const wrap = wrapRef.current
    if (!wrap) return
    const ro = new ResizeObserver(() => resize())
    ro.observe(wrap)

    const onWheel = (e) => {
      e.preventDefault()
      const st = S.current
      const rect = wrap.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
      const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, st.cam.scale * factor))
      st.cam.tx = mx - (newScale / st.cam.scale) * (mx - st.cam.tx)
      st.cam.ty = my - (newScale / st.cam.scale) * (my - st.cam.ty)
      st.cam.scale = newScale
      clampCam()
    }
    wrap.addEventListener('wheel', onWheel, { passive: false })

    return () => {
      cancelAnimationFrame(S.current.raf)
      ro.disconnect()
      wrap.removeEventListener('wheel', onWheel)
    }
  }, [status, resize, draw, clampCam])

  const onDoubleClick = () => {
    const st = S.current
    if (st.pointers.size > 0) return
    if (st.lastPinchEnd && Date.now() - st.lastPinchEnd < 300) return
    st.cam.tx = 0
    st.cam.ty = 0
    st.cam.scale = 1
  }

  return (
    <div className="galaxy-canvas-wrap galaxy-canvas-wrap--miro" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className="galaxy-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        style={{ touchAction: 'none', cursor: 'grab' }}
      />
      <div className="gx-title gx-title--miro">Emet Memory</div>
      <div className="gx-legend2 gx-legend2--miro">
        {CAT_KEYS.map((k) => (
          <span key={k} className="gx-leg2">
            <span className="gx-leg2__sh" style={{ color: CATS[k].color }}>
              {SHAPE_GLYPH[CATS[k].shape]}
            </span>
            {CATS[k].label}
          </span>
        ))}
      </div>

      <div className="gx-hint gx-hint--miro">拖动平移 · 双指/滚轮缩放 · 双击复位</div>
      <div className="gx-preview-badge">预览 · Miró v2</div>

      {status === 'loading' && <div className="gx-status faint">星图加载中…</div>}
      {status === 'error' && <div className="gx-status faint">星图加载失败</div>}

      {/* Miró 浮卡：变小变窄，靠右下角，不再占满底部不再挡节点 */}
      {selNode && (
        <div className="gx-card gx-card--miro" onClick={() => navigate(`/memory/${selNode.id}`)}>
          <div className="gx-card__top">
            <span className="gx-card__cat" style={{ color: CATS[selNode.cat].color }}>
              {CATS[selNode.cat].label}
            </span>
            <span className="gx-card__imp">
              {'●'.repeat(Math.round(selNode.imp / 2))}
              {'○'.repeat(5 - Math.round(selNode.imp / 2))}
            </span>
          </div>
          <div className="gx-card__text">{selNode.text}</div>
          {selNode.tags?.length > 0 && (
            <div className="gx-card__tags">{selNode.tags.map((t) => '#' + t).join('  ')}</div>
          )}
          <div className="gx-card__open">打开记忆 ›</div>
        </div>
      )}
    </div>
  )
}

// ── Miró 风格画法 ───────────────────────────────────────
// 6 种形状全部用 Canvas 画：circle / star / triangle / crescent / square / hex
// importance >= 8 的节点外面套虚线圆环（demo 里的"星轨"感）
function drawMiro(ctx, x, y, r, shape, color, alpha, importance, isSel, scale) {
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.fillStyle = color
  ctx.strokeStyle = color

  if (shape === 'circle') {
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  } else if (shape === 'star') {
    const spikes = 5
    const outerR = r + 3
    const innerR = r * 0.45
    ctx.beginPath()
    for (let i = 0; i < spikes * 2; i++) {
      const rr = i % 2 === 0 ? outerR : innerR
      const a = (Math.PI * i) / spikes - Math.PI / 2
      const px = x + rr * Math.cos(a)
      const py = y + rr * Math.sin(a)
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    ctx.closePath()
    ctx.fill()
  } else if (shape === 'triangle') {
    const h = r * 1.7
    ctx.beginPath()
    ctx.moveTo(x, y - h / 2)
    ctx.lineTo(x - r, y + h / 2)
    ctx.lineTo(x + r, y + h / 2)
    ctx.closePath()
    ctx.fill()
  } else if (shape === 'crescent') {
    // 月牙：大圆减小圆
    // 用 Canvas 的 evenodd 填充规则
    ctx.beginPath()
    ctx.arc(x, y, r + 1, 0, Math.PI * 2)
    // 内侧"挖"小圆：往右偏一点
    ctx.arc(x + r * 0.35, y, r * 0.85, 0, Math.PI * 2, true)
    ctx.fill('evenodd')
  } else if (shape === 'square') {
    const s = r * 1.55
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(0.05)
    // 圆角矩形
    const rad = 2
    ctx.beginPath()
    ctx.moveTo(-s + rad, -s)
    ctx.lineTo(s - rad, -s)
    ctx.quadraticCurveTo(s, -s, s, -s + rad)
    ctx.lineTo(s, s - rad)
    ctx.quadraticCurveTo(s, s, s - rad, s)
    ctx.lineTo(-s + rad, s)
    ctx.quadraticCurveTo(-s, s, -s, s - rad)
    ctx.lineTo(-s, -s + rad)
    ctx.quadraticCurveTo(-s, -s, -s + rad, -s)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  } else if (shape === 'hex') {
    ctx.beginPath()
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i - Math.PI / 6
      ctx.lineTo(x + r * Math.cos(a), y + r * Math.sin(a))
    }
    ctx.closePath()
    ctx.fill()
  }

  // 选中描边
  if (isSel) {
    ctx.save()
    ctx.globalAlpha = 1
    ctx.strokeStyle = MIRO.black
    ctx.lineWidth = 2 / scale
    if (shape === 'circle' || shape === 'star') {
      ctx.beginPath()
      ctx.arc(x, y, r + 3, 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.restore()
  }

  // 重要度 >= 8 → 虚线外环（demo 里的"星轨"感）
  if (importance >= 8 && shape !== 'star') {
    ctx.save()
    ctx.globalAlpha = alpha * 0.45
    ctx.strokeStyle = color
    ctx.lineWidth = 1.2 / scale
    ctx.setLineDash([4 / scale, 3 / scale])
    ctx.beginPath()
    ctx.arc(x, y, r + 8, 0, Math.PI * 2)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.restore()
  }

  ctx.restore()
}

function drawLabel(ctx, x, y, r, text, color, alpha, scale) {
  const fontPx = 10 / scale
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.font = `${fontPx}px Georgia, serif`
  ctx.fillStyle = color
  ctx.textAlign = 'center'
  ctx.fillText(text, x, y + r + 14 / scale)
  ctx.restore()
}
