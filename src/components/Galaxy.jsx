import { useRef, useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { memoryAll } from '../api.js'

// 星图 · Dear Data 风格（静怡的视觉 demo，接真实记忆数据）
// 无限画布 + 可拉伸视角：单指/鼠标拖动平移，双指 pinch 或滚轮缩放，双击复位。
// 节点/藤蔓在世界坐标系绘制，背景纸纹固定屏幕坐标；标签字号按 scale 反向缩放保持屏幕大小稳定。
const CATS = {
  core: { color: '#C96442', label: '核心', shape: 'circle' },
  scene: { color: '#7EA67E', label: '情景', shape: 'triangle' },
  emotion: { color: '#C47060', label: '情绪', shape: 'wave' },
  semantic: { color: '#6A8EB0', label: '语义', shape: 'square' },
  image: { color: '#D4956A', label: '形象', shape: 'diamond' },
  procedure: { color: '#8A8477', label: '程序', shape: 'hex' },
}
const SHAPE_GLYPH = { circle: '●', triangle: '▲', wave: '∿', square: '■', diamond: '◆', hex: '⬡' }
const CAT_KEYS = Object.keys(CATS)

// 缩放范围 + LOD 阈值（低于此 scale 隐藏标签 / 藤蔓，避免节点过密时一团糟）
const MIN_SCALE = 0.3
const MAX_SCALE = 4
const LOD_LABEL = 0.65
const LOD_LINKS = 0.45
// 拖动判定阈值：累计移动 < 此值算 click，否则算 drag
// 触屏手指抖动可达 8~12px，桌面鼠标精度高用 6；按设备类型动态选
const CLICK_SLOP = typeof window !== 'undefined' && 'ontouchstart' in window ? 12 : 6

function seeded(i) {
  const x = Math.sin(i * 127.1 + 0.5) * 43758.5453
  return x - Math.floor(x)
}

export default function Galaxy({ focusId = null }) {
  const navigate = useNavigate()
  const wrapRef = useRef(null)
  const canvasRef = useRef(null)
  const S = useRef({
    nodes: [], links: [], sel: null, t: 0, raf: 0, W: 0, H: 0, dpr: 1,
    cam: { tx: 0, ty: 0, scale: 1 },
    pointers: new Map(),     // pointerId -> { x, y, startX, startY }
    pinch: null,             // { startDist, startScale, startTx, startTy, cx, cy }
    drag: null,              // { lastX, lastY, moved }
    bounds: null,            // { minX, minY, maxX, maxY }（节点包围盒，用于约束 cam）
  })
  const [selNode, setSelNode] = useState(null)
  const [status, setStatus] = useState('loading')

  // 拉真实记忆，构建节点 + 藤蔓
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
    return () => {
      alive = false
    }
  }, [focusId])

  const layout = useCallback(() => {
    const st = S.current
    const { W, H } = st
    const cx = W / 2
    const cy = H / 2.2
    // 放大初始半径范围（之前 0.15+imp*0.022 太挤）：基础 0.18 + 重要度 0.035 + 抖动 60
    // 让默认视角下节点分散度更高；用户可以再缩小看全局或放大看细节
    st.nodes.forEach((n, i) => {
      const a = (i / st.nodes.length) * Math.PI * 2 + seeded(i) * 0.5
      const ci = CAT_KEYS.indexOf(n.cat)
      const ca = (ci / CAT_KEYS.length) * Math.PI * 2
      const br = Math.min(W, H) * 0.18 + n.imp * Math.min(W, H) * 0.035 + seeded(i + 99) * 60
      n.ox = cx + Math.cos(a + ca * 0.3) * br
      n.oy = cy + Math.sin(a + ca * 0.3) * br
      n.x = n.ox
      n.y = n.oy
      n.r = 3 + n.imp * 1.3
      n.ph = seeded(i + 7) * Math.PI * 2
    })
    // 算节点包围盒（cam 约束用，给一圈 padding）
    if (st.nodes.length > 0) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (const n of st.nodes) {
        if (n.ox < minX) minX = n.ox
        if (n.ox > maxX) maxX = n.ox
        if (n.oy < minY) minY = n.oy
        if (n.oy > maxY) maxY = n.oy
      }
      const pad = 80
      st.bounds = { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad }
    } else {
      st.bounds = null
    }
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

  // 视角约束：scale 在 [MIN,MAX]，cam.tx/ty 保证节点包围盒至少有一部分在视野里
  const clampCam = useCallback(() => {
    const st = S.current
    const cam = st.cam
    cam.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, cam.scale))
    if (!st.bounds) return
    const { minX, minY, maxX, maxY } = st.bounds
    // 允许内容跑到屏幕外，但至少保留 60px 的"抓手"在视野里
    const handle = 60
    // tx 上界：minX*scale + tx <= W - handle → tx <= W - handle - minX*scale
    cam.tx = Math.min(st.W - handle - minX * cam.scale, cam.tx)
    // tx 下界：maxX*scale + tx >= handle → tx >= handle - maxX*scale
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

    // 重置 transform 到 DPR 基线（清屏 + 画背景用屏幕坐标系）
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, W, H)

    // 背景纸纹（屏幕固定，不跟视角拉动 → 给"无限画布"一个稳定地基）
    ctx.save()
    ctx.globalAlpha = 0.025
    for (let i = 0; i < 12; i++) {
      ctx.beginPath()
      ctx.arc(W * (0.3 + Math.sin(i) * 0.4), H * (0.3 + Math.cos(i * 0.7) * 0.4), 60 + i * 25, 0, Math.PI * 2)
      ctx.fillStyle = i % 3 === 0 ? '#d4c4a8' : i % 3 === 1 ? '#c9b89a' : '#baa888'
      ctx.fill()
    }
    ctx.restore()

    // ── 应用视角变换：之后所有节点/藤蔓都在世界坐标 ──
    ctx.save()
    ctx.translate(cam.tx, cam.ty)
    ctx.scale(cam.scale, cam.scale)

    // 漂浮
    st.nodes.forEach((n) => {
      n.x = n.ox + Math.sin(st.t + n.ph) * 1.0
      n.y = n.oy + Math.cos(st.t * 0.6 + n.ph) * 0.8
    })

    // 藤蔓弯线（缩太小不画，避免一团糟）
    if (cam.scale >= LOD_LINKS) {
      st.links.forEach((l) => {
        const na = st.nodes[l[0]]
        const nb = st.nodes[l[1]]
        const isSel = sel !== null && (l[0] === sel || l[1] === sel)
        const alpha = sel === null ? 0.06 : isSel ? 0.35 : 0.02
        const mx = (na.x + nb.x) / 2
        const my = (na.y + nb.y) / 2
        const dx = nb.x - na.x
        const dy = nb.y - na.y
        const cx1 = mx - dy * 0.18 + Math.sin(na.x * 0.01) * 12
        const cy1 = my + dx * 0.18 + Math.cos(na.y * 0.01) * 12
        ctx.save()
        ctx.globalAlpha = alpha
        ctx.strokeStyle = '#c96442'
        ctx.lineWidth = 0.7 / cam.scale
        ctx.beginPath()
        ctx.moveTo(na.x, na.y)
        ctx.quadraticCurveTo(cx1, cy1, nb.x, nb.y)
        ctx.stroke()
        ctx.restore()
      })
    }

    // 星星
    st.nodes.forEach((n, i) => {
      const c = CATS[n.cat]
      const isSel = sel === i
      const isLn =
        sel !== null && st.links.some((l) => (l[0] === sel && l[1] === i) || (l[1] === sel && l[0] === i))
      const dim = sel !== null && !isSel && !isLn
      drawShape(ctx, n.x, n.y, n.r, c.shape, c.color, dim ? 0.12 : 0.8, cam.scale)
      if (isSel) {
        ctx.save()
        ctx.globalAlpha = 0.12
        ctx.strokeStyle = '#c96442'
        ctx.lineWidth = 0.5 / cam.scale
        ctx.setLineDash([2 / cam.scale, 3 / cam.scale])
        ctx.beginPath()
        ctx.arc(n.x, n.y, n.r + 12 / cam.scale, 0, Math.PI * 2)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.restore()
      }
      // LOD：scale 大才画标签
      if (cam.scale >= LOD_LABEL) {
        if (isSel) drawLabel(ctx, n.x, n.y, n.r, n.label, c.color, 0.9, cam.scale)
        else if (isLn) drawLabel(ctx, n.x, n.y, n.r, n.label, c.color, 0.5, cam.scale)
      }
    })

    ctx.restore()
    st.raf = requestAnimationFrame(draw)
  }, [])

  // 屏幕 → 世界坐标
  const screenToWorld = (sx, sy) => {
    const cam = S.current.cam
    return { x: (sx - cam.tx) / cam.scale, y: (sy - cam.ty) / cam.scale }
  }

  const handleClick = (sx, sy) => {
    const st = S.current
    const { x: wx, y: wy } = screenToWorld(sx, sy)
    let hit = -1
    st.nodes.forEach((n, i) => {
      // hit 半径在屏幕坐标系是 r+12px，所以世界坐标要除以 scale
      if (Math.hypot(n.x - wx, n.y - wy) < n.r + 12 / st.cam.scale) hit = i
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
      st.drag = null // 双指期间不平移
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
      // 以 pinch 起始中点为缩放锚（屏幕同一像素对应的世界点保持不变）
      const { cx, cy, startScale, startTx, startTy } = st.pinch
      st.cam.scale = newScale
      st.cam.tx = cx - (newScale / startScale) * (cx - startTx)
      st.cam.ty = cy - (newScale / startScale) * (cy - startTy)
      clampCam()
    } else if (st.drag) {
      // 双指→单指过渡的第一帧只更新起点，不累计位移（防 jump）
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

    // 单指松开 + 未明显移动 → 视为 click
    if (st.drag && st.drag.moved < CLICK_SLOP && st.pointers.size === 0) {
      handleClick(ptr.startX, ptr.startY)
    }

    if (st.pointers.size === 1) {
      // 双指→单指：重置 drag 起点 + skipNext 跳过下一帧的 dx/dy 计算（防止 pinch 残留位移被当成 jump）
      const remaining = [...st.pointers.values()][0]
      st.drag = { lastX: remaining.x, lastY: remaining.y, moved: 0, skipNext: true }
      st.pinch = null
    } else if (st.pointers.size === 0) {
      st.drag = null
      st.pinch = null
    }
  }

  // 启动渲染循环 + 绑事件
  useEffect(() => {
    if (status !== 'ready') return
    resize()
    S.current.raf = requestAnimationFrame(draw)
    const wrap = wrapRef.current
    if (!wrap) return
    const ro = new ResizeObserver(() => resize())
    ro.observe(wrap)

    // wheel：原生绑（React 的 onWheel 是 passive 不能 preventDefault）
    const onWheel = (e) => {
      e.preventDefault()
      const st = S.current
      const rect = wrap.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
      const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, st.cam.scale * factor))
      // 以鼠标位置为缩放锚
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

  // 双击复位视角；pinch 期间禁用（防手机上两指快速按下被识别为 dblclick 误触复位）
  const onDoubleClick = () => {
    const st = S.current
    if (st.pointers.size > 0) return
    st.cam.tx = 0
    st.cam.ty = 0
    st.cam.scale = 1
  }

  return (
    <div className="galaxy-canvas-wrap" ref={wrapRef}>
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
      <div className="gx-title">Emet Memory</div>
      <div className="gx-legend2">
        {CAT_KEYS.map((k) => (
          <span key={k} className="gx-leg2">
            <span className="gx-leg2__sh" style={{ color: CATS[k].color }}>
              {SHAPE_GLYPH[CATS[k].shape]}
            </span>
            {CATS[k].label}
          </span>
        ))}
      </div>

      {/* 视角操作提示（首次进入提醒；可以做成关闭一次后不再显示，先简化） */}
      <div className="gx-hint faint">拖动平移 · 双指/滚轮缩放 · 双击复位</div>

      {status === 'loading' && <div className="gx-status faint">星图加载中…</div>}
      {status === 'error' && <div className="gx-status faint">星图加载失败</div>}

      {selNode && (
        <div className="gx-card" onClick={() => navigate(`/memory/${selNode.id}`)}>
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

// ── canvas 绘制（移植自 demo + scale 适配）─────────────────
// drawShape 不动 lineWidth，让节点形状自然随 scale 缩放（节点本身有大小感）
function drawShape(ctx, x, y, r, shape, color, alpha /* , scale */) {
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.fillStyle = color
  ctx.strokeStyle = color
  ctx.lineWidth = 1.2
  if (shape === 'circle') {
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = alpha * 0.25
    ctx.lineWidth = 0.8
    ctx.beginPath()
    ctx.arc(x, y, r + 2.5, 0, Math.PI * 2)
    ctx.stroke()
  } else if (shape === 'triangle') {
    ctx.beginPath()
    ctx.moveTo(x, y - r * 1.15)
    ctx.lineTo(x - r * 0.95, y + r * 0.7)
    ctx.lineTo(x + r * 0.95, y + r * 0.7)
    ctx.closePath()
    ctx.fill()
  } else if (shape === 'wave') {
    ctx.lineWidth = Math.max(1.5, r * 0.35)
    const w = r * 1.5
    ctx.beginPath()
    ctx.moveTo(x - w, y)
    ctx.quadraticCurveTo(x - w / 2, y - r * 0.9, x, y)
    ctx.quadraticCurveTo(x + w / 2, y + r * 0.9, x + w, y)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(x, y, 2.5, 0, Math.PI * 2)
    ctx.fill()
  } else if (shape === 'square') {
    const s = r * 0.8
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(0.06)
    ctx.fillRect(-s, -s, s * 2, s * 2)
    ctx.restore()
  } else if (shape === 'diamond') {
    ctx.beginPath()
    ctx.moveTo(x, y - r * 1.15)
    ctx.lineTo(x + r * 0.8, y)
    ctx.lineTo(x, y + r * 1.15)
    ctx.lineTo(x - r * 0.8, y)
    ctx.closePath()
    ctx.fill()
  } else if (shape === 'hex') {
    ctx.beginPath()
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i - Math.PI / 6
      ctx.lineTo(x + r * Math.cos(a), y + r * Math.sin(a))
    }
    ctx.closePath()
    ctx.fill()
  }
  ctx.restore()
}

// drawLabel：所有 px 值都按 scale 反向缩放，保持文字在屏幕上的尺寸恒定不被缩放扭曲
function drawLabel(ctx, x, y, r, text, color, alpha, scale) {
  const fontPx = 11 / scale
  const off = 8 / scale
  const lead = 2 / scale
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.font = `italic ${fontPx}px Georgia, serif`
  ctx.fillStyle = color
  const lx = x + r + off
  const ly = y + 3 / scale
  ctx.save()
  ctx.globalAlpha = alpha * 0.15
  ctx.strokeStyle = color
  ctx.lineWidth = 0.5 / scale
  ctx.beginPath()
  ctx.moveTo(x + r + lead, y)
  ctx.lineTo(lx - lead, ly - 3 / scale)
  ctx.stroke()
  ctx.restore()
  ctx.fillText(text, lx, ly)
  ctx.restore()
}
