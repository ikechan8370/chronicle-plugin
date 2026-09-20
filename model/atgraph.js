/**
 * 艾特关系图图谱算法与数据构建 (现代浅色科技版)
 * 数据源：Meilisearch messages 索引中 message.type = "at" 的文档
 * 输出：高清晰度、层次分明的社交星系图谱与情报看板数据
 */

const CACHE_TTL = 30 * 60 * 1000
const CACHE_MAX = 20
const CACHE = new Map()

// 8款高对比、高饱和、专为浅色背景打造的社区专属色彩
const COMMUNITY_PALETTE = [
  '#2563eb', // 皇家蓝
  '#db2777', // 鲜玫红
  '#059669', // 翡翠绿
  '#d97706', // 琥珀金
  '#7c3aed', // 幻光紫
  '#0891b2', // 湖水青
  '#ea580c', // 活力橙
  '#4f46e5'  // 极光靛
]

const getAvatarUrl = id => /^\d+$/.test(String(id)) ? `https://q1.qlogo.cn/g?b=qq&nk=${id}&s=100` : ''

/** 分页拉取某群全部 at 消息 */
export async function fetchGroupAtDocuments ({ host, port = 7700, apiKey, indexName = 'messages' }, groupId) {
  const batchSize = 1000
  const hits = []
  const filter = `message.type = "at" AND group.group_id = ${groupId}`
  for (let offset = 0; ; offset += batchSize) {
    const params = new URLSearchParams()
    params.set('limit', String(batchSize))
    params.set('offset', String(offset))
    params.set('filter', filter)
    params.set('fields', 'sender.user_id,sender.card,sender.nickname,message.type,message.qq,message.text')
    const url = `http://${host}:${port}/indexes/${indexName}/documents?${params.toString()}`
    const response = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } })
    if (!response.ok) {
      throw new Error(`Meilisearch documents API Error: ${response.status} - ${await response.text()}`)
    }
    const rsp = await response.json()
    const docs = rsp.results || []
    hits.push(...docs)
    if (docs.length < batchSize) break
    if (typeof rsp.total === 'number' && offset + docs.length >= rsp.total) break
  }
  return hits
}

/** 把 at 消息聚合成有向带权图 */
export function buildAtGraph (docs) {
  const nodeMap = new Map()
  const edgeMap = new Map()
  const nameRank = new Map()
  const ensureNode = id => {
    const key = String(id)
    if (!nodeMap.has(key)) nodeMap.set(key, { id: key, name: key, in: 0, out: 0 })
    return nodeMap.get(key)
  }
  const setName = (id, name, rank) => {
    if (!name) return
    const key = String(id)
    if ((nameRank.get(key) || 0) <= rank) {
      nameRank.set(key, rank)
      const trimmed = String(name).trim()
      if (trimmed) ensureNode(key).name = trimmed
    }
  }
  for (const doc of docs) {
    const from = doc.sender?.user_id
    if (!from) continue
    ensureNode(from)
    setName(from, doc.sender?.card, 3)
    setName(from, doc.sender?.nickname, 2)
    for (const item of doc.message || []) {
      if (item.type !== 'at' || !item.qq) continue
      const to = item.qq
      const key = `${from}->${to}`
      edgeMap.set(key, (edgeMap.get(key) || 0) + 1)
      ensureNode(to)
      setName(to, item.text, 1)
    }
  }
  const edges = []
  let mutualPairs = 0
  for (const [key, weight] of edgeMap) {
    const [from, to] = key.split('->')
    nodeMap.get(from).out += weight
    nodeMap.get(to).in += weight
    edges.push({ from, to, weight })
  }
  for (const e of edges) {
    if (e.from < e.to && edgeMap.has(`${e.to}->${e.from}`)) mutualPairs++
  }
  return { nodes: [...nodeMap.values()], edges, mutualPairs }
}

/** 取图谱，带内存缓存 */
export async function getGroupAtGraph (cfg, groupId) {
  const key = String(groupId)
  const cached = CACHE.get(key)
  if (cached && Date.now() - cached.time < CACHE_TTL) return cached.graph
  const docs = await fetchGroupAtDocuments(cfg, groupId)
  const graph = buildAtGraph(docs)
  if (CACHE.size >= CACHE_MAX) CACHE.delete(CACHE.keys().next().value)
  CACHE.set(key, { time: Date.now(), graph })
  return graph
}

export function isGraphCached (groupId) {
  const cached = CACHE.get(String(groupId))
  return !!cached && Date.now() - cached.time < CACHE_TTL
}

function rng (seed) {
  let a = seed >>> 0
  return function () {
    a = a + 0x6D2B79F5 | 0
    let t = Math.imul(a ^ a >>> 15, 1 | a)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }
}

/**
 * 社区引导的力导向布局算法 (带高阶斥力与柔性边界弹簧)
 */
export function computeAtGraphLayout (nodes, edges, communities, bounds) {
  const n = nodes.length
  if (n === 0) return []
  const { x: startX, y: startY, width: W, height: H } = bounds
  const index = new Map(nodes.map((nd, i) => [nd.id, i]))
  const rand = rng(20240920)
  const cx = startX + W / 2
  const cy = startY + H / 2

  // 计算各社区的初始分布角
  const commCounts = new Map()
  for (const c of communities) commCounts.set(c, (commCounts.get(c) || 0) + 1)
  const majorComms = [...commCounts.entries()].filter(([_, cnt]) => cnt >= 2).map(([c]) => c)
  const commAngle = new Map()
  majorComms.forEach((c, idx) => {
    commAngle.set(c, (idx / majorComms.length) * Math.PI * 2)
  })

  const pos = nodes.map((_, i) => {
    const c = communities[i]
    const baseA = commAngle.get(c) ?? (rand() * Math.PI * 2)
    const a = baseA + (rand() - 0.5) * 0.85
    const r = Math.min(W, H) * (0.18 + rand() * 0.22)
    return {
      x: cx + Math.cos(a) * r,
      y: cy + Math.sin(a) * r
    }
  })

  const adj = edges
    .map(e => [index.get(e.from), index.get(e.to)])
    .filter(a => a[0] !== undefined && a[1] !== undefined)

  const k = Math.sqrt((W * H) / Math.max(1, n)) * 1.32
  const iterations = Math.max(350, Math.min(900, Math.round(350000 / n)))
  let temp = Math.min(W, H) * 0.16
  const cooling = temp / iterations

  const pad = 85
  const minX = startX + pad
  const maxX = startX + W - pad
  const minY = startY + pad
  const maxY = startY + H - pad

  for (let it = 0; it < iterations; it++) {
    const disp = pos.map(() => ({ x: 0, y: 0 }))

    // 1. 节点间斥力 (高出入度节点有更大斥力)
    for (let i = 0; i < n; i++) {
      const pi = pos[i]
      const degI = nodes[i].deg || 1
      for (let j = i + 1; j < n; j++) {
        const pj = pos[j]
        const degJ = nodes[j].deg || 1
        let dx = pi.x - pj.x
        let dy = pi.y - pj.y
        let d2 = dx * dx + dy * dy
        if (d2 < 1) { dx = rand() - 0.5; dy = rand() - 0.5; d2 = 1 }
        const d = Math.sqrt(d2)
        const hubBoost = 1 + 0.24 * Math.log(1 + degI + degJ)
        const f = ((k * k) / d) * hubBoost
        const fx = (dx / d) * f
        const fy = (dy / d) * f
        disp[i].x += fx; disp[i].y += fy
        disp[j].x -= fx; disp[j].y -= fy
      }
    }

    // 2. 边的引力
    for (const [i, j] of adj) {
      const dx = pos[i].x - pos[j].x
      const dy = pos[i].y - pos[j].y
      const d = Math.sqrt(dx * dx + dy * dy) || 0.01
      const f = (d * d) / k
      const fx = (dx / d) * f
      const fy = (dy / d) * f
      disp[i].x -= fx; disp[i].y -= fy
      disp[j].x += fx; disp[j].y += fy
    }

    // 3. 社区聚类引力 (轻柔拉向同社区质心)
    const commCentroids = new Map()
    for (let i = 0; i < n; i++) {
      const c = communities[i]
      if (!commCentroids.has(c)) commCentroids.set(c, { x: 0, y: 0, count: 0 })
      const item = commCentroids.get(c)
      item.x += pos[i].x
      item.y += pos[i].y
      item.count++
    }
    for (const item of commCentroids.values()) {
      item.x /= item.count
      item.y /= item.count
    }
    for (let i = 0; i < n; i++) {
      const c = communities[i]
      const cent = commCentroids.get(c)
      if (cent && cent.count >= 3) {
        disp[i].x += (cent.x - pos[i].x) * 0.04
        disp[i].y += (cent.y - pos[i].y) * 0.04
      }
    }

    // 4. 柔性边界弹簧、图例避让与更新位置
    for (let i = 0; i < n; i++) {
      if (pos[i].x < minX) disp[i].x += (minX - pos[i].x) * 0.35
      if (pos[i].x > maxX) disp[i].x -= (pos[i].x - maxX) * 0.35
      if (pos[i].y < minY) disp[i].y += (minY - pos[i].y) * 0.35
      if (pos[i].y > maxY) disp[i].y -= (pos[i].y - maxY) * 0.35

      // 避开左下角图例区域 (x: startX ~ startX+180, y: startY+H-130 ~ startY+H)
      if (pos[i].x < startX + 190 && pos[i].y > startY + H - 130) {
        disp[i].x += 25
        disp[i].y -= 25
      }

      disp[i].x += (cx - pos[i].x) * 0.007
      disp[i].y += (cy - pos[i].y) * 0.007

      const d = disp[i]
      const dist = Math.sqrt(d.x * d.x + d.y * d.y) || 0.01
      const lim = Math.min(dist, temp)
      pos[i].x += (d.x / dist) * lim
      pos[i].y += (d.y / dist) * lim
    }
    temp -= cooling
  }

  // 最终安全限幅
  for (let i = 0; i < n; i++) {
    pos[i].x = Math.max(startX + 55, Math.min(startX + W - 55, pos[i].x))
    pos[i].y = Math.max(startY + 55, Math.min(startY + H - 55, pos[i].y))
    if (pos[i].x < startX + 180 && pos[i].y > startY + H - 120) {
      pos[i].y = startY + H - 125
    }
  }

  return pos
}

/**
 * Louvain 模块度社区发现算法
 * 彻底解决高密度群聊图谱中标签传播（LPA）全图单一标签接管问题
 */
export function detectAtGraphCommunities (nodes, edges) {
  const n = nodes.length
  if (n <= 1) return nodes.map(() => 0)
  const index = new Map(nodes.map((nd, i) => [nd.id, i]))
  const adj = nodes.map(() => new Map())
  let totalWeight = 0
  const deg = new Float64Array(n)

  for (const e of edges) {
    const a = index.get(e.from)
    const b = index.get(e.to)
    if (a === undefined || b === undefined) continue
    const w = e.weight
    adj[a].set(b, (adj[a].get(b) || 0) + w)
    adj[b].set(a, (adj[b].get(a) || 0) + w)
    deg[a] += w
    deg[b] += w
    totalWeight += w * 2
  }
  if (totalWeight === 0) return nodes.map(() => 0)

  const community = new Int32Array(n)
  for (let i = 0; i < n; i++) community[i] = i
  const commTot = new Float64Array(deg)
  const gamma = 1.15

  const rand = rng(20240920)
  const order = nodes.map((_, i) => i)

  for (let iter = 0; iter < 25; iter++) {
    let moved = 0
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1))
      const t = order[i]; order[i] = order[j]; order[j] = t
    }

    for (const i of order) {
      const c = community[i]
      const ki = deg[i]
      if (ki === 0) continue
      commTot[c] -= ki

      const weights = new Map()
      for (const [nbr, w] of adj[i]) {
        const nbrC = community[nbr]
        weights.set(nbrC, (weights.get(nbrC) || 0) + w)
      }

      let bestC = c
      let bestGain = 0

      for (const [candC, kin] of weights) {
        const gain = kin - gamma * (ki * commTot[candC]) / totalWeight
        if (gain > bestGain) {
          bestGain = gain
          bestC = candC
        }
      }

      community[i] = bestC
      commTot[bestC] += ki
      if (bestC !== c) moved++
    }
    if (moved === 0) break
  }

  // 按社区人数降序重排编号，0号为最大社区
  const counts = new Map()
  for (let i = 0; i < n; i++) {
    const c = community[i]
    counts.set(c, (counts.get(c) || 0) + 1)
  }
  const sortedComms = [...counts.entries()].sort((a, b) => b[1] - a[1])
  const remap = new Map()
  sortedComms.forEach(([oldC], newC) => remap.set(oldC, newC))

  return Array.from(community).map(c => remap.get(c) ?? 0)
}

function textWidth (str, fontSize) {
  let width = 0
  for (const ch of str) {
    width += /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF\u3000-\u303F]/.test(ch) ? 1.0 : 0.58
  }
  return width * fontSize
}

/** 组装渲染数据：分栏布局 + 现代明亮科技风 + 详细排行榜 */
export function buildAtGraphRenderData (graph, opts = {}) {
  const nodes = graph.nodes
  const edges = graph.edges
  const n = nodes.length

  const W = 1920
  const H = 1080

  for (const nd of nodes) {
    nd.deg = nd.in + nd.out
  }

  // 社区发现
  const communities = detectAtGraphCommunities(nodes, edges)

  // 划分左侧图谱画布：X: 40 ~ 1300 (宽 1260), Y: 110 ~ 1030 (高 920)
  const graphBounds = { x: 40, y: 110, width: 1260, height: 920 }
  const pos = computeAtGraphLayout(nodes, edges, communities, graphBounds)

  for (let i = 0; i < n; i++) {
    nodes[i].x = Math.round(pos[i].x)
    nodes[i].y = Math.round(pos[i].y)
    nodes[i].comm = communities[i]
  }

  const maxIn = Math.max(1, ...nodes.map(nd => nd.in))
  const sortedByDeg = [...nodes].sort((a, b) => b.deg - a.deg)
  const topHubSet = new Set(sortedByDeg.slice(0, Math.min(24, Math.max(8, Math.round(n * 0.25)))).map(nd => nd.id))

  for (let i = 0; i < n; i++) {
    const nd = nodes[i]
    const isTop = topHubSet.has(nd.id)
    nd.isTop = isTop
    nd.avatar = getAvatarUrl(nd.id)
    if (isTop) {
      nd.r = Math.round(18 + 14 * Math.sqrt(nd.in / maxIn))
    } else {
      nd.r = Math.round(7 + 7 * Math.sqrt(nd.in / maxIn))
    }
    nd.color = COMMUNITY_PALETTE[nd.comm % COMMUNITY_PALETTE.length]
    nd.label = nd.name.length > 9 ? `${nd.name.slice(0, 8)}…` : nd.name
    nd.fs = isTop ? 14 : 12
    nd.showLabel = false
  }

  // 标签胶囊放置与避让
  const labelCandidates = nodes.filter(nd => nd.isTop || (nd.deg >= 3 && nd.in >= 2)).sort((a, b) => b.deg - a.deg)
  const placedBoxes = []
  const nodeBoxes = nodes.map(nd => ({
    x1: nd.x - nd.r - 2,
    x2: nd.x + nd.r + 2,
    y1: nd.y - nd.r - 2,
    y2: nd.y + nd.r + 2
  }))
  const isOverlap = (box, list) => list.some(o => !(box.x2 < o.x1 || box.x1 > o.x2 || box.y2 < o.y1 || box.y1 > o.y2))

  for (const nd of labelCandidates) {
    const fs = nd.fs
    const tw = textWidth(nd.label, fs)
    const bw = Math.round(tw + 16)
    const bh = Math.round(fs + 10)
    const cands = [
      { cx: nd.x, cy: nd.y + nd.r + bh / 2 + 5 },
      { cx: nd.x, cy: nd.y - nd.r - bh / 2 - 5 },
      { cx: nd.x + nd.r + bw / 2 + 4, cy: nd.y },
      { cx: nd.x - nd.r - bw / 2 - 4, cy: nd.y }
    ]
    for (const c of cands) {
      const box = {
        x1: c.cx - bw / 2,
        x2: c.cx + bw / 2,
        y1: c.cy - bh / 2,
        y2: c.cy + bh / 2
      }
      if (
        box.x1 >= graphBounds.x &&
        box.x2 <= graphBounds.x + graphBounds.width &&
        box.y1 >= graphBounds.y &&
        box.y2 <= graphBounds.y + graphBounds.height &&
        !isOverlap(box, placedBoxes) &&
        !isOverlap(box, nodeBoxes)
      ) {
        placedBoxes.push(box)
        nd.lx = Math.round(c.cx)
        nd.ly = Math.round(c.cy)
        nd.lw = bw
        nd.lh = bh
        nd.showLabel = true
        break
      }
    }
  }

  // 边处理：双向奔赴折叠为单条平滑高亮弧线，大幅降低视觉杂乱
  const nodeIndex = new Map(nodes.map(nd => [nd.id, nd]))
  const edgePairMap = new Map()
  for (const e of edges) {
    const pairKey = e.from < e.to ? `${e.from}<->${e.to}` : `${e.to}<->${e.from}`
    if (!edgePairMap.has(pairKey)) {
      edgePairMap.set(pairKey, { u1: e.from, u2: e.to, w12: 0, w21: 0, isMutual: false })
    }
    const item = edgePairMap.get(pairKey)
    if (e.from === item.u1) item.w12 = e.weight
    else item.w21 = e.weight
    if (item.w12 > 0 && item.w21 > 0) item.isMutual = true
  }

  const renderEdges = []
  const arrows = []

  for (const item of edgePairMap.values()) {
    const from = nodeIndex.get(item.u1)
    const to = nodeIndex.get(item.u2)
    if (!from || !to) continue

    const dx = to.x - from.x
    const dy = to.y - from.y
    const dist = Math.sqrt(dx * dx + dy * dy) || 0.01
    const ux = dx / dist
    const uy = dy / dist

    if (item.isMutual) {
      const totalW = item.w12 + item.w21
      const sx = from.x + ux * (from.r + 2)
      const sy = from.y + uy * (from.r + 2)
      const ex = to.x - ux * (to.r + 2)
      const ey = to.y - uy * (to.r + 2)
      const mx = (sx + ex) / 2
      const my = (sy + ey) / 2
      const curve = Math.min(50, dist * 0.12)
      const cx = mx + (-uy) * curve
      const cy = my + (ux) * curve

      let color, w, o
      if (totalW >= 15) {
        color = '#e11d48'
        w = Math.min(3.8, 2.0 + Math.log(1 + totalW) * 0.4)
        o = Math.min(0.85, 0.65 + Math.log(1 + totalW) * 0.05)
      } else if (totalW >= 4) {
        color = '#f43f5e'
        w = Math.min(2.8, 1.4 + Math.log(1 + totalW) * 0.35)
        o = Math.min(0.65, 0.45 + Math.log(1 + totalW) * 0.05)
      } else {
        color = '#c084fc'
        w = 1.6
        o = 0.35
      }

      renderEdges.push({
        d: `M ${sx.toFixed(1)} ${sy.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`,
        color,
        w: w.toFixed(2),
        o: o.toFixed(2),
        isMutual: true
      })
    } else {
      const src = item.w12 > 0 ? from : to
      const dst = item.w12 > 0 ? to : from
      const weight = item.w12 > 0 ? item.w12 : item.w21

      const edx = dst.x - src.x
      const edy = dst.y - src.y
      const edist = Math.sqrt(edx * edx + edy * edy) || 0.01
      const eux = edx / edist
      const euy = edy / edist

      const arrowLen = 9
      const sx = src.x + eux * (src.r + 2)
      const sy = src.y + euy * (src.r + 2)
      const ex = dst.x - eux * (dst.r + 2 + arrowLen)
      const ey = dst.y - euy * (dst.r + 2 + arrowLen)
      const mx = (sx + ex) / 2
      const my = (sy + ey) / 2
      const curve = Math.min(45, edist * 0.1)
      const cx = mx + (-euy) * curve
      const cy = my + (eux) * curve

      let color = '#94a3b8'
      let w = 1.2
      let o = 0.22
      if (weight >= 5) {
        color = '#6366f1'
        w = Math.min(2.5, 1.2 + Math.log(1 + weight) * 0.4)
        o = Math.min(0.55, 0.3 + Math.log(1 + weight) * 0.06)
      } else if (weight >= 2) {
        color = '#64748b'
        w = 1.5
        o = 0.32
      }

      renderEdges.push({
        d: `M ${sx.toFixed(1)} ${sy.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`,
        color,
        w: w.toFixed(2),
        o: o.toFixed(2),
        isMutual: false
      })

      let adx = ex - cx
      let ady = ey - cy
      const ad = Math.sqrt(adx * adx + ady * ady) || 0.01
      adx /= ad
      ady /= ad
      const tipX = ex + adx * arrowLen
      const tipY = ey + ady * arrowLen
      const bx = tipX - adx * arrowLen
      const by = tipY - ady * arrowLen
      const half = arrowLen * 0.45

      arrows.push({
        points: `${tipX.toFixed(1)},${tipY.toFixed(1)} ${(bx - ady * half).toFixed(1)},${(by + adx * half).toFixed(1)} ${(bx + ady * half).toFixed(1)},${(by - adx * half).toFixed(1)}`,
        color,
        o: o.toFixed(2)
      })
    }
  }

  // 统计情报排行榜数据提炼
  // 1. 社交核心 Top 5（被艾特最多）
  const topIn = [...nodes]
    .sort((a, b) => b.in - a.in)
    .slice(0, 5)
    .map((nd, idx) => ({
      rank: idx + 1,
      id: nd.id,
      name: nd.name,
      in: nd.in,
      out: nd.out,
      avatar: nd.avatar,
      color: nd.color
    }))

  // 2. 互动达人 Top 5（主动艾特别人最多）
  const topOut = [...nodes]
    .sort((a, b) => b.out - a.out)
    .slice(0, 5)
    .map((nd, idx) => ({
      rank: idx + 1,
      id: nd.id,
      name: nd.name,
      in: nd.in,
      out: nd.out,
      avatar: nd.avatar,
      color: nd.color
    }))

  // 3. 最佳羁绊 Top 4
  const topMutual = [...edgePairMap.values()]
    .filter(item => item.isMutual)
    .map(item => ({
      u1: nodeIndex.get(item.u1),
      u2: nodeIndex.get(item.u2),
      total: item.w12 + item.w21
    }))
    .filter(item => item.u1 && item.u2)
    .sort((a, b) => b.total - a.total)
    .slice(0, 4)
    .map((item, idx) => ({
      rank: idx + 1,
      u1: { id: item.u1.id, name: item.u1.name, avatar: getAvatarUrl(item.u1.id) },
      u2: { id: item.u2.id, name: item.u2.name, avatar: getAvatarUrl(item.u2.id) },
      total: item.total
    }))

  // 4. 活跃小圈子 Top 3
  const commMap = new Map()
  for (let i = 0; i < n; i++) {
    const c = communities[i]
    if (!commMap.has(c)) {
      commMap.set(c, {
        id: c,
        color: COMMUNITY_PALETTE[c % COMMUNITY_PALETTE.length],
        members: []
      })
    }
    commMap.get(c).members.push(nodes[i])
  }
  const topCommunities = [...commMap.values()]
    .filter(c => c.members.length >= 2)
    .sort((a, b) => b.members.length - a.members.length)
    .slice(0, 3)
    .map(c => {
      const topMems = c.members.sort((a, b) => b.deg - a.deg).slice(0, 4)
      return {
        color: c.color,
        count: c.members.length,
        names: topMems.map(m => m.name.length > 9 ? `${m.name.slice(0, 8)}…` : m.name).join('、')
      }
    })

  const totalInteractions = edges.reduce((sum, e) => sum + e.weight, 0)
  const uniqueCommunities = new Set(communities).size

  return {
    width: W,
    height: H,
    title: `${opts.groupName || '本群'} · 艾特关系全景图谱`,
    subtitle: '统计范围：本群全量历史消息 · 箭头方向：谁艾特了谁',
    nodeCount: nodes.length,
    edgeCount: edges.length,
    mutualCount: graph.mutualPairs,
    communityCount: uniqueCommunities,
    totalInteractions,
    nodes,
    edges: renderEdges,
    arrows,
    topIn,
    topOut,
    topMutual,
    topCommunities
  }
}

/**
 * 组装个人中心艾特图谱数据 (Ego-Network)
 * 以指定群友为绝对中心，展示与其相关的网络与情报数据
 */
export function buildPersonalAtGraphRenderData (graph, targetId, opts = {}) {
  const targetKey = String(targetId)
  const nodeIndex = new Map(graph.nodes.map(nd => [nd.id, nd]))
  const targetNode = nodeIndex.get(targetKey)
  if (!targetNode) return null

  // 1. 查找所有与 targetNode 直接关联的好友
  const friendMap = new Map() // friendId -> { inFromTarget, outToTarget, total, isMutual }

  for (const e of graph.edges) {
    if (e.from === targetKey && e.to !== targetKey) {
      if (!friendMap.has(e.to)) friendMap.set(e.to, { inFromTarget: 0, outToTarget: 0, total: 0, isMutual: false })
      const item = friendMap.get(e.to)
      item.inFromTarget += e.weight
      item.total += e.weight
    } else if (e.to === targetKey && e.from !== targetKey) {
      if (!friendMap.has(e.from)) friendMap.set(e.from, { inFromTarget: 0, outToTarget: 0, total: 0, isMutual: false })
      const item = friendMap.get(e.from)
      item.outToTarget += e.weight
      item.total += e.weight
    }
  }

  for (const item of friendMap.values()) {
    if (item.inFromTarget > 0 && item.outToTarget > 0) {
      item.isMutual = true
    }
  }

  // 2. 若好友过多，筛选亲密度最高的 Top 42 名好友
  const sortedFriends = [...friendMap.entries()].sort((a, b) => b[1].total - a[1].total)
  const selectedFriendMap = new Map(sortedFriends.slice(0, 42))

  // 3. 计算全图社区分布（保持与群图谱社区色彩一致）
  const allCommunities = detectAtGraphCommunities(graph.nodes, graph.edges)
  const nodeCommMap = new Map()
  graph.nodes.forEach((nd, i) => nodeCommMap.set(nd.id, allCommunities[i]))

  // 4. 构建子图节点
  const W = 1080
  const H = 1750
  const graphSize = 1020
  const cx = graphSize / 2
  const cy = graphSize / 2

  const subNodes = []
  const targetCopy = {
    ...targetNode,
    isCenter: true,
    isTop: true,
    avatar: getAvatarUrl(targetKey),
    comm: nodeCommMap.get(targetKey) ?? 0,
    color: '#f59e0b', // 核心主角专属高亮琥珀金
    r: 45, // 更大主角头像
    label: targetNode.name.length > 10 ? `${targetNode.name.slice(0, 9)}…` : targetNode.name,
    fs: 16,
    showLabel: true,
    x: Math.round(cx),
    y: Math.round(cy),
    lx: Math.round(cx),
    ly: Math.round(cy + 45 + 24),
    lw: Math.round(textWidth(targetNode.name.length > 10 ? `${targetNode.name.slice(0, 9)}…` : targetNode.name, 16) + 24),
    lh: 30
  }
  subNodes.push(targetCopy)

  for (const [fId, fStats] of selectedFriendMap) {
    const raw = nodeIndex.get(fId)
    if (!raw) continue
    const comm = nodeCommMap.get(fId) ?? 0
    const isTopFriend = fStats.total >= 5 || fStats.isMutual
    subNodes.push({
      ...raw,
      isCenter: false,
      isTop: isTopFriend,
      avatar: getAvatarUrl(fId),
      comm,
      color: COMMUNITY_PALETTE[comm % COMMUNITY_PALETTE.length],
      r: isTopFriend ? Math.round(20 + 14 * Math.min(1, fStats.total / 45)) : 10,
      label: raw.name.length > 9 ? `${raw.name.slice(0, 8)}…` : raw.name,
      fs: isTopFriend ? 14 : 12,
      friendStats: fStats,
      showLabel: false
    })
  }

  // 5. 径向同心圆布局 (以 (cx, cy) 为圆心，分为密友圈、频繁圈、泛交圈)
  const maxFriendTotal = Math.max(1, ...[...selectedFriendMap.values()].map(f => f.total))
  const friendNodes = subNodes.slice(1)
  const rand = rng(20240920)

  // 按社区聚拢排序
  friendNodes.sort((a, b) => (a.comm - b.comm) || (b.friendStats.total - a.friendStats.total))
  const nFriends = friendNodes.length

  for (let i = 0; i < nFriends; i++) {
    const fn = friendNodes[i]
    const rate = fn.friendStats.total / maxFriendTotal
    let ringRadius
    if (fn.friendStats.isMutual && fn.friendStats.total >= 8) {
      ringRadius = 185 + (1 - rate) * 85
    } else if (fn.friendStats.total >= 4) {
      ringRadius = 310 + (1 - Math.min(1, fn.friendStats.total / 15)) * 85
    } else {
      ringRadius = 440 + rand() * 55
    }

    const angle = (i / nFriends) * Math.PI * 2 + (rand() - 0.5) * 0.22
    fn.x = Math.round(cx + Math.cos(angle) * ringRadius)
    fn.y = Math.round(cy + Math.sin(angle) * ringRadius)
  }

  // 节点间微调排斥防重叠
  for (let it = 0; it < 90; it++) {
    for (let i = 0; i < nFriends; i++) {
      const pi = friendNodes[i]
      for (let j = i + 1; j < nFriends; j++) {
        const pj = friendNodes[j]
        let dx = pi.x - pj.x
        let dy = pi.y - pj.y
        let d2 = dx * dx + dy * dy
        const minDist = pi.r + pj.r + 34
        if (d2 < minDist * minDist) {
          const d = Math.sqrt(d2) || 0.01
          const push = (minDist - d) * 0.5
          const fx = (dx / d) * push
          const fy = (dy / d) * push
          pi.x += fx; pi.y += fy
          pj.x -= fx; pj.y -= fy
        }
      }
      pi.x = Math.max(50, Math.min(graphSize - 50, pi.x))
      pi.y = Math.max(50, Math.min(graphSize - 50, pi.y))
    }
  }

  // 标签防重叠
  const labelPlaced = [{ x1: targetCopy.lx - targetCopy.lw / 2, x2: targetCopy.lx + targetCopy.lw / 2, y1: targetCopy.ly - targetCopy.lh / 2, y2: targetCopy.ly + targetCopy.lh / 2 }]
  const nodeBoxes = subNodes.map(nd => ({ x1: nd.x - nd.r - 3, x2: nd.x + nd.r + 3, y1: nd.y - nd.r - 3, y2: nd.y + nd.r + 3 }))
  const isHit = (box, list) => list.some(o => !(box.x2 < o.x1 || box.x1 > o.x2 || box.y2 < o.y1 || box.y1 > o.y2))

  for (const fn of friendNodes) {
    if (!fn.isTop && fn.friendStats.total < 3) continue
    const tw = textWidth(fn.label, fn.fs)
    const bw = Math.round(tw + 18)
    const bh = Math.round(fn.fs + 12)
    const cands = [
      { cx: fn.x, cy: fn.y + fn.r + bh / 2 + 6 },
      { cx: fn.x, cy: fn.y - fn.r - bh / 2 - 6 },
      { cx: fn.x + fn.r + bw / 2 + 6, cy: fn.y },
      { cx: fn.x - fn.r - bw / 2 - 6, cy: fn.y }
    ]
    for (const c of cands) {
      const box = { x1: c.cx - bw / 2, x2: c.cx + bw / 2, y1: c.cy - bh / 2, y2: c.cy + bh / 2 }
      if (!isHit(box, labelPlaced) && !isHit(box, nodeBoxes)) {
        labelPlaced.push(box)
        fn.lx = Math.round(c.cx)
        fn.ly = Math.round(c.cy)
        fn.lw = bw
        fn.lh = bh
        fn.showLabel = true
        break
      }
    }
  }

  // 6. 子图边处理
  const selectedSet = new Set(subNodes.map(nd => nd.id))
  const renderEdges = []
  const arrows = []
  const subNodeMap = new Map(subNodes.map(nd => [nd.id, nd]))

  const subPairMap = new Map()
  for (const e of graph.edges) {
    if (!selectedSet.has(e.from) || !selectedSet.has(e.to)) continue
    const pairKey = e.from < e.to ? `${e.from}<->${e.to}` : `${e.to}<->${e.from}`
    if (!subPairMap.has(pairKey)) {
      subPairMap.set(pairKey, { u1: e.from, u2: e.to, w12: 0, w21: 0, isDirect: false })
    }
    const item = subPairMap.get(pairKey)
    if (e.from === item.u1) item.w12 = e.weight
    else item.w21 = e.weight
    if (item.u1 === targetKey || item.u2 === targetKey) item.isDirect = true
  }

  for (const item of subPairMap.values()) {
    const from = subNodeMap.get(item.u1)
    const to = subNodeMap.get(item.u2)
    if (!from || !to) continue
    const isMutual = item.w12 > 0 && item.w21 > 0
    const totalW = item.w12 + item.w21

    const dx = to.x - from.x
    const dy = to.y - from.y
    const dist = Math.sqrt(dx * dx + dy * dy) || 0.01
    const ux = dx / dist
    const uy = dy / dist

    if (item.isDirect) {
      // 与主角直接关联的边
      if (isMutual) {
        const sx = from.x + ux * (from.r + 2)
        const sy = from.y + uy * (from.r + 2)
        const ex = to.x - ux * (to.r + 2)
        const ey = to.y - uy * (to.r + 2)
        const mx = (sx + ex) / 2
        const my = (sy + ey) / 2
        const curve = Math.min(45, dist * 0.12)
        const cx = mx + (-uy) * curve
        const cy = my + (ux) * curve
        const w = Math.min(3.8, 1.8 + Math.log(1 + totalW) * 0.4)
        const o = Math.min(0.85, 0.6 + Math.log(1 + totalW) * 0.05)
        renderEdges.push({
          d: `M ${sx.toFixed(1)} ${sy.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`,
          color: '#e11d48',
          w: w.toFixed(2),
          o: o.toFixed(2),
          isMutual: true
        })
      } else {
        const src = item.w12 > 0 ? from : to
        const dst = item.w12 > 0 ? to : from
        const weight = item.w12 > 0 ? item.w12 : item.w21
        const edx = dst.x - src.x
        const edy = dst.y - src.y
        const edist = Math.sqrt(edx * edx + edy * edy) || 0.01
        const eux = edx / edist
        const euy = edy / edist
        const arrowLen = 9
        const sx = src.x + eux * (src.r + 2)
        const sy = src.y + euy * (src.r + 2)
        const ex = dst.x - eux * (dst.r + 2 + arrowLen)
        const ey = dst.y - euy * (dst.r + 2 + arrowLen)
        const mx = (sx + ex) / 2
        const my = (sy + ey) / 2
        const curve = Math.min(35, edist * 0.1)
        const cx = mx + (-euy) * curve
        const cy = my + (eux) * curve

        const isOutgoing = src.id === targetKey
        const color = isOutgoing ? '#2563eb' : '#059669'
        const w = Math.min(2.8, 1.2 + Math.log(1 + weight) * 0.35)
        const o = Math.min(0.65, 0.35 + Math.log(1 + weight) * 0.05)
        renderEdges.push({
          d: `M ${sx.toFixed(1)} ${sy.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`,
          color,
          w: w.toFixed(2),
          o: o.toFixed(2),
          isMutual: false
        })

        let adx = ex - cx
        let ady = ey - cy
        const ad = Math.sqrt(adx * adx + ady * ady) || 0.01
        adx /= ad
        ady /= ad
        const tipX = ex + adx * arrowLen
        const tipY = ey + ady * arrowLen
        const bx = tipX - adx * arrowLen
        const by = tipY - ady * arrowLen
        const half = arrowLen * 0.45

        arrows.push({
          points: `${tipX.toFixed(1)},${tipY.toFixed(1)} ${(bx - ady * half).toFixed(1)},${(by + adx * half).toFixed(1)} ${(bx + ady * half).toFixed(1)},${(by - adx * half).toFixed(1)}`,
          color,
          o: o.toFixed(2)
        })
      }
    } else {
      // 好友之间的间接连线（淡灰细线展示三元闭包）
      const sx = from.x + ux * (from.r + 2)
      const sy = from.y + uy * (from.r + 2)
      const ex = to.x - ux * (to.r + 2)
      const ey = to.y - uy * (to.r + 2)
      renderEdges.push({
        d: `M ${sx.toFixed(1)} ${sy.toFixed(1)} L ${ex.toFixed(1)} ${ey.toFixed(1)}`,
        color: '#cbd5e1',
        w: '1.0',
        o: '0.22',
        isMutual: false
      })
    }
  }

  // 7. 个人专属指标与看板数据
  let mutualCount = 0
  for (const f of friendMap.values()) {
    if (f.isMutual) mutualCount++
  }

  let style = '双向互动型'
  if (targetNode.out >= targetNode.in * 1.6) style = '主动艾特达人'
  else if (targetNode.in >= targetNode.out * 1.6) style = '备受关注核心'

  // Card 1: 🎯 TA最关注的人 (Target -> V)
  const topFocus = [...friendMap.entries()]
    .filter(([_, f]) => f.inFromTarget > 0)
    .sort((a, b) => b[1].inFromTarget - a[1].inFromTarget)
    .slice(0, 5)
    .map(([fId, f], idx) => {
      const u = nodeIndex.get(fId)
      return {
        rank: idx + 1,
        id: fId,
        name: u ? u.name : fId,
        count: f.inFromTarget,
        avatar: getAvatarUrl(fId)
      }
    })

  // Card 2: 👑 TA的头号粉丝 (V -> Target)
  const topFans = [...friendMap.entries()]
    .filter(([_, f]) => f.outToTarget > 0)
    .sort((a, b) => b[1].outToTarget - a[1].outToTarget)
    .slice(0, 5)
    .map(([fId, f], idx) => {
      const u = nodeIndex.get(fId)
      return {
        rank: idx + 1,
        id: fId,
        name: u ? u.name : fId,
        count: f.outToTarget,
        avatar: getAvatarUrl(fId)
      }
    })

  // Card 3: 🤝 核心密友 / 默契搭档 (Mutual)
  const topBestFriends = [...friendMap.entries()]
    .filter(([_, f]) => f.isMutual)
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 4)
    .map(([fId, f], idx) => {
      const u = nodeIndex.get(fId)
      return {
        rank: idx + 1,
        id: fId,
        name: u ? u.name : fId,
        avatar: getAvatarUrl(fId),
        total: f.total,
        out: f.inFromTarget,
        in: f.outToTarget
      }
    })

  // Card 4: 🪐 TA的社交圈构成
  const commFriendCount = new Map()
  for (const fId of friendMap.keys()) {
    const c = nodeCommMap.get(fId) ?? 0
    commFriendCount.set(c, (commFriendCount.get(c) || 0) + 1)
  }
  const topCommDist = [...commFriendCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([c, count]) => {
      const friendsInComm = [...friendMap.keys()]
        .filter(fId => nodeCommMap.get(fId) === c)
        .map(fId => nodeIndex.get(fId)?.name || fId)
        .slice(0, 4)
      return {
        color: COMMUNITY_PALETTE[c % COMMUNITY_PALETTE.length],
        count,
        percent: Math.round((count / Math.max(1, friendMap.size)) * 100),
        names: friendsInComm.map(n => n.length > 8 ? `${n.slice(0, 7)}…` : n).join('、')
      }
    })

  return {
    width: W,
    height: H,
    title: `${targetNode.name} · 个人艾特社交图谱`,
    subtitle: opts.isRandom
      ? `🎲 随机抽中群友 · 统计范围：本群全量历史消息 · 以 ${targetNode.name} (${targetKey}) 为核心拓扑`
      : `统计范围：本群全量历史消息 · 以 ${targetNode.name} (${targetKey}) 为核心拓扑`,
    target: {
      id: targetKey,
      name: targetNode.name,
      avatar: getAvatarUrl(targetKey),
      in: targetNode.in,
      out: targetNode.out,
      total: targetNode.in + targetNode.out,
      mutualCount,
      friendCount: friendMap.size,
      style
    },
    friendCount: friendMap.size,
    subgraphNodeCount: subNodes.length,
    subgraphEdgeCount: renderEdges.length,
    nodes: subNodes,
    edges: renderEdges,
    arrows,
    topFocus,
    topFans,
    topBestFriends,
    topCommDist
  }
}

