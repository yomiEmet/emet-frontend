import { useRef, useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { memoryAll } from '../api.js'

// 星图 · Dear Data 风格（静怡的视觉 demo，接真实记忆数据）
// 每个分类一个手绘形状；藤蔓 = 弯曲赤陶线；点星星弹浮卡，点浮卡进详情。
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

// 确定性伪随机（按索引），保证布局稳定不抖
function seeded(i) {
  const x = Math.sin(i * 127.1 + 0.5) * 43758.5453
  return x - Math.floor(x)
}

// focusId：从详情页"查看✦"进来时初始选中该记忆（旧版 B12 的聚焦）
export default function Galaxy({ focusId = null }) {
  const navigate = useNavigate()
  const wrapRef = useRef(null)
  const canvasRef = useRef(null)
  const S = useRef({ nodes: [], links: [], sel: null, t: 0, raf: 0, W: 0, H: 0 })
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
  }, [])

  const layout = useCallback(() => {
    const st = S.current
    const { W, H } = st
    const cx = W / 2
    const cy = H / 2.2
    st.nodes.forEach((n, i) => {
      const a = (i / st.nodes.length) * Math.PI * 2 + seeded(i) * 0.5
      const ci = CAT_KEYS.indexOf(n.cat)
      const ca = (ci / CAT_KEYS.length) * Math.PI * 2
      const br = Math.min(W, H) * 0.15 + n.imp * Math.min(W, H) * 0.022 + seeded(i + 99) * 30
      n.ox = cx + Math.cos(a + ca * 0.3) * br
      n.oy = cy + Math.sin(a + ca * 0.3) * br
      n.x = n.ox
      n.y = n.oy
      n.r = 3 + n.imp * 1.3
      n.ph = seeded(i + 7) * Math.PI * 2
    })
  }, [])

  const resize = useCallback(() => {
    const st = S.current
    const cvs = canvasRef.current
    const wrap = wrapRef.current
    if (!cvs || !wrap) return
    const dpr = window.devicePixelRatio || 1
    st.W = wrap.clientWidth
    st.H = wrap.clientHeight
    cvs.width = st.W * dpr
    cvs.height = st.H * dpr
    cvs.style.width = st.W + 'px'
    cvs.style.height = st.H + 'px'
    cvs.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0)
    layout()
  }, [layout])

  const draw = useCallback(() => {
    const st = S.current
    const cvs = canvasRef.current
    if (!cvs) return
    const ctx = cvs.getContext('2d')
    const { W, H, sel } = st
    st.t += 0.005
    ctx.clearRect(0, 0, W, H)

    // 背景纸纹斑块
    ctx.save()
    ctx.globalAlpha = 0.025
    for (let i = 0; i < 12; i++) {
      ctx.beginPath()
      ctx.arc(W * (0.3 + Math.sin(i) * 0.4), H * (0.3 + Math.cos(i * 0.7) * 0.4), 60 + i * 25, 0, Math.PI * 2)
      ctx.fillStyle = i % 3 === 0 ? '#d4c4a8' : i % 3 === 1 ? '#c9b89a' : '#baa888'
      ctx.fill()
    }
    ctx.restore()

    // 漂浮
    st.nodes.forEach((n) => {
      n.x = n.ox + Math.sin(st.t + n.ph) * 1.0
      n.y = n.oy + Math.cos(st.t * 0.6 + n.ph) * 0.8
    })

    // 藤蔓弯线
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
      ctx.lineWidth = 0.7
      ctx.beginPath()
      ctx.moveTo(na.x, na.y)
      ctx.quadraticCurveTo(cx1, cy1, nb.x, nb.y)
      ctx.stroke()
      ctx.restore()
    })

    // 星星
    st.nodes.forEach((n, i) => {
      const c = CATS[n.cat]
      const isSel = sel === i
      const isLn =
        sel !== null && st.links.some((l) => (l[0] === sel && l[1] === i) || (l[1] === sel && l[0] === i))
      const dim = sel !== null && !isSel && !isLn
      drawShape(ctx, n.x, n.y, n.r, c.shape, c.color, dim ? 0.12 : 0.8)
      if (isSel) {
        ctx.save()
        ctx.globalAlpha = 0.12
        ctx.strokeStyle = '#c96442'
        ctx.lineWidth = 0.5
        ctx.setLineDash([2, 3])
        ctx.beginPath()
        ctx.arc(n.x, n.y, n.r + 12, 0, Math.PI * 2)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.restore()
        drawLabel(ctx, n.x, n.y, n.r, n.label, c.color, 0.9, W)
      } else if (isLn) {
        drawLabel(ctx, n.x, n.y, n.r, n.label, c.color, 0.5, W)
      }
    })

    st.raf = requestAnimationFrame(draw)
  }, [])

  // 启动渲染循环
  useEffect(() => {
    if (status !== 'ready') return
    resize()
    S.current.raf = requestAnimationFrame(draw)
    const ro = new ResizeObserver(() => resize())
    ro.observe(wrapRef.current)
    return () => {
      cancelAnimationFrame(S.current.raf)
      ro.disconnect()
    }
  }, [status, resize, draw])

  const onClick = (e) => {
    const st = S.current
    const rect = wrapRef.current.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    let hit = -1
    st.nodes.forEach((n, i) => {
      if (Math.hypot(n.x - mx, n.y - my) < n.r + 12) hit = i
    })
    if (hit >= 0) {
      st.sel = st.sel === hit ? null : hit
      setSelNode(st.sel === null ? null : st.nodes[st.sel])
    } else {
      st.sel = null
      setSelNode(null)
    }
  }

  return (
    <div className="galaxy-canvas-wrap" ref={wrapRef}>
      <canvas ref={canvasRef} className="galaxy-canvas" onClick={onClick} />
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

// ── canvas 绘制（移植自 demo）────────────────────────────
function drawShape(ctx, x, y, r, shape, color, alpha) {
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

function drawLabel(ctx, x, y, r, text, color, alpha, W) {
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.font = 'italic 11px Georgia, serif'
  ctx.fillStyle = color
  let lx = x + r + 8
  const ly = y + 3
  if (lx + ctx.measureText(text).width > W - 20) lx = x - r - 8 - ctx.measureText(text).width
  ctx.save()
  ctx.globalAlpha = alpha * 0.15
  ctx.strokeStyle = color
  ctx.lineWidth = 0.5
  ctx.beginPath()
  ctx.moveTo(x + r + 2, y)
  ctx.lineTo(lx - 2, ly - 3)
  ctx.stroke()
  ctx.restore()
  ctx.fillText(text, lx, ly)
  ctx.restore()
}
