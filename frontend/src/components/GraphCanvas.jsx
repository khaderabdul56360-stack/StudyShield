import { useEffect, useMemo, useRef, useState } from 'react'
import { STATUS_LABEL } from '../lib/metrics'

// Small deterministic force layout. The backend caps graphs at 16 nodes / 32 edges,
// so a few hundred iterations in plain JS is effectively free and avoids a graph library.
function shortLabel(label, max) {
  return label.length > max ? `${label.slice(0, max - 1).trimEnd()}…` : label
}

const radiusFor = concept => 12 + concept.importance * 12

function computeLayout(concepts, edges, width, height, maxLabel) {
  const n = concepts.length
  const order = [...concepts].sort((a, b) => b.importance - a.importance)
  const nodes = order.map((concept, i) => {
    const angle = (i / Math.max(n, 1)) * Math.PI * 2 + 0.4
    const ring = i === 0 && n > 4 ? 0 : 1
    const r = radiusFor(concept)
    // Box the node occupies including its label, used for clamping and collisions.
    const boxW = Math.max(r * 2, shortLabel(concept.label, maxLabel).length * 7 + 12)
    return {
      id: concept.id, r, boxW, boxH: r * 2 + 26,
      x: width / 2 + Math.cos(angle) * width * 0.34 * ring, y: height / 2 + Math.sin(angle) * height * 0.32 * ring,
      dx: 0, dy: 0,
    }
  })
  const byId = Object.fromEntries(nodes.map(node => [node.id, node]))
  const clamp = node => {
    node.x = Math.min(width - node.boxW / 2 - 6, Math.max(node.boxW / 2 + 6, node.x))
    node.y = Math.min(height - node.boxH + node.r - 4, Math.max(node.r + 10, node.y))
  }
  const k = Math.sqrt((width * height) / Math.max(n, 1)) * 0.7
  let temperature = width / 6
  for (let step = 0; step < 360; step += 1) {
    nodes.forEach(node => { node.dx = 0; node.dy = 0 })
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        const a = nodes[i]; const b = nodes[j]
        // Labels are wide, so horizontal distance counts for less: nodes spread sideways more.
        let dx = (a.x - b.x) * 0.75; let dy = a.y - b.y
        let dist = Math.hypot(dx, dy)
        if (dist < 0.01) { dx = 0.1 * (i + 1); dy = 0.1 * (j + 1); dist = Math.hypot(dx, dy) }
        const force = (k * k) / dist
        a.dx += (dx / dist) * force; a.dy += (dy / dist) * force
        b.dx -= (dx / dist) * force; b.dy -= (dy / dist) * force
      }
    }
    edges.forEach(edge => {
      const a = byId[edge.source]; const b = byId[edge.target]
      if (!a || !b) return
      const dx = a.x - b.x; const dy = a.y - b.y
      const dist = Math.max(Math.hypot(dx, dy), 0.01)
      const force = (dist * dist) / k
      a.dx -= (dx / dist) * force; a.dy -= (dy / dist) * force
      b.dx += (dx / dist) * force; b.dy += (dy / dist) * force
    })
    nodes.forEach(node => {
      // Gentle gravity keeps disconnected groups from drifting to the edges.
      node.dx += (width / 2 - node.x) * 0.9
      node.dy += (height / 2 - node.y) * 1.3
      const disp = Math.max(Math.hypot(node.dx, node.dy), 0.01)
      node.x += (node.dx / disp) * Math.min(disp, temperature)
      node.y += (node.dy / disp) * Math.min(disp, temperature)
      clamp(node)
    })
    temperature = Math.max(temperature * 0.97, 1)
  }
  // Resolve any remaining label/node overlaps by pushing boxes apart along the cheaper axis.
  for (let pass = 0; pass < 80; pass += 1) {
    let moved = false
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        const a = nodes[i]; const b = nodes[j]
        const overlapX = (a.boxW + b.boxW) / 2 + 10 - Math.abs(a.x - b.x)
        const overlapY = (a.boxH + b.boxH) / 2 + 4 - Math.abs(a.y - b.y)
        if (overlapX <= 0 || overlapY <= 0) continue
        moved = true
        if (overlapX < overlapY) {
          const shift = (overlapX / 2 + 0.5) * (a.x < b.x ? -1 : 1)
          a.x += shift; b.x -= shift
        } else {
          const shift = (overlapY / 2 + 0.5) * (a.y < b.y ? -1 : 1)
          a.y += shift; b.y -= shift
        }
        clamp(a); clamp(b)
      }
    }
    if (!moved) break
  }
  return byId
}

export default function GraphCanvas({ concepts, edges, selectedId, onSelect }) {
  const wrapRef = useRef(null)
  const [width, setWidth] = useState(760)
  useEffect(() => {
    const element = wrapRef.current
    if (!element) return undefined
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const graphWidth = Math.max(300, width)
  const maxLabel = graphWidth < 520 ? 18 : 26
  // Taller canvas on narrow screens so labels keep their real size instead of being scaled down.
  const perRow = Math.max(2, Math.floor(graphWidth / 170))
  const height = Math.max(graphWidth < 820 ? 440 : 500, Math.ceil(concepts.length / perRow) * 96 + 60)
  const positions = useMemo(
    () => computeLayout(concepts, edges, graphWidth, height, maxLabel),
    [concepts, edges, graphWidth, height, maxLabel],
  )
  const neighbours = useMemo(() => {
    const set = new Set()
    edges.forEach(edge => {
      if (edge.source === selectedId) set.add(edge.target)
      if (edge.target === selectedId) set.add(edge.source)
    })
    return set
  }, [edges, selectedId])

  function keySelect(event, concept) {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(concept) }
  }

  return <div className="graph-wrap" ref={wrapRef}>
    <svg className={`graph-svg ${selectedId ? 'has-selection' : ''}`} viewBox={`0 0 ${graphWidth} ${height}`}
      width={graphWidth} height={height} role="group" aria-label="Concept graph">
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 1 L9 5 L0 9 z" className="arrow-head"/>
        </marker>
        <radialGradient id="node-core"><stop offset="0" stopColor="#fff" stopOpacity=".55"/><stop offset="1" stopColor="#fff" stopOpacity="0"/></radialGradient>
      </defs>
      <g className="edges">
        {edges.map((edge, index) => {
          const a = positions[edge.source]; const b = positions[edge.target]
          if (!a || !b) return null
          const sourceConcept = concepts.find(c => c.id === edge.source)
          const targetConcept = concepts.find(c => c.id === edge.target)
          const ra = sourceConcept ? radiusFor(sourceConcept) : 12
          const rb = targetConcept ? radiusFor(targetConcept) : 12
          const dist = Math.max(Math.hypot(b.x - a.x, b.y - a.y), 1)
          const ux = (b.x - a.x) / dist; const uy = (b.y - a.y) / dist
          const x1 = a.x + ux * (ra + 3); const y1 = a.y + uy * (ra + 3)
          const x2 = b.x - ux * (rb + 5); const y2 = b.y - uy * (rb + 5)
          const mx = (x1 + x2) / 2 - uy * dist * 0.08; const my = (y1 + y2) / 2 + ux * dist * 0.08
          const active = edge.source === selectedId || edge.target === selectedId
          return <path key={`${edge.source}-${edge.target}-${index}`}
            className={`edge rel-${edge.relationship} ${active ? 'active' : ''}`}
            d={`M${x1},${y1} Q${mx},${my} ${x2},${y2}`}
            markerEnd={edge.relationship === 'prerequisite' || edge.relationship === 'part_of' ? 'url(#arrow)' : undefined}/>
        })}
      </g>
      <g className="nodes">
        {concepts.map(concept => {
          const point = positions[concept.id]
          if (!point) return null
          const r = point.r
          const selected = concept.id === selectedId
          const label = shortLabel(concept.label, maxLabel)
          return <g key={concept.id} transform={`translate(${point.x},${point.y})`} tabIndex={0} role="button"
            aria-pressed={selected}
            aria-label={`${concept.label}, ${STATUS_LABEL[concept.status]}${concept.average_score != null ? `, ${concept.average_score}%` : ''}`}
            className={`node status-${concept.status} ${selected ? 'selected' : ''} ${neighbours.has(concept.id) ? 'neighbour' : ''}`}
            onClick={() => onSelect(concept)} onKeyDown={event => keySelect(event, concept)}>
            <title>{concept.label}</title>
            <circle className="node-halo" r={r + 10}/>
            <circle className="node-body" r={r}/>
            <circle r={r * 0.62} fill="url(#node-core)" cx={-r * 0.2} cy={-r * 0.25} pointerEvents="none"/>
            <text className="node-label" y={r + 18} textAnchor="middle">{label}</text>
          </g>
        })}
      </g>
    </svg>
  </div>
}
