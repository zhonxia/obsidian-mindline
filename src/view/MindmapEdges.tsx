import React from 'react'
import { NODE_W } from './MindmapLayout'
import type { MindmapRenderEdge } from './MindmapLayout'

interface BusGroup {
  source: MindmapRenderEdge['source']
  children: Array<{ edge: MindmapRenderEdge; child: MindmapRenderEdge['target']; childY: number }>
  turnX: number
  sourceY: number
  minY: number
  maxY: number
}

/** 圆角半径 */
const EDGE_R = 5

/** 将 edges 按 source 分组，生成总线式连线 */
function busEdgeGroups(edges: MindmapRenderEdge[]): BusGroup[] {
  const map = new Map<string, BusGroup>()
  for (const e of edges) {
    let g = map.get(e.source.id)
    if (!g) {
      const sh = e.source.nodeH ?? 34
      const sx = e.source.x + NODE_W
      const sy = e.source.y + sh / 2
      const gap = e.target.x - sx
      const run = Math.max(gap * 0.5, 24)
      g = { source: e.source, children: [], turnX: sx + run, sourceY: sy, minY: Infinity, maxY: -Infinity }
      map.set(e.source.id, g)
    }
    const th = e.target.nodeH ?? 34
    const ty = e.target.y + th / 2
    g.children.push({ edge: e, child: e.target, childY: ty })
    if (ty < g.minY) g.minY = ty
    if (ty > g.maxY) g.maxY = ty
  }
  return [...map.values()]
}

/** 生成总线连接线的 SVG path */
function busEdgePath(children: number[], turnX: number, childX: number): string {
  if (children.length === 0) return ''
  if (children.length === 1) {
    const ty = children[0]
    return `M ${turnX} ${ty} L ${childX} ${ty}`
  }
  const minTy = Math.min(...children)
  const maxTy = Math.max(...children)
  const branches = children.map(ty => {
    const dx = childX - turnX
    return `M ${turnX} ${ty} L ${childX - Math.min(dx * 0.3, 8)} ${ty}`
  }).join(' ')
  return `M ${turnX} ${minTy} L ${turnX} ${maxTy} ${branches}`
}

interface Props {
  edges: MindmapRenderEdge[]
  width: number
  height: number
}

export default function MindmapEdges({ edges, width, height }: Props) {
  return (
    <svg className="mindmap-edges" width={width} height={height}>
      {busEdgeGroups(edges).map((g, gi) => {
        const { source, children, turnX, sourceY } = g
        const childYs = children.map(c => c.childY)
        const childX = children.length > 0 ? children[0].child.x : turnX

        return (
          <g key={`bus-${gi}`}>
            <path
              d={`M ${source.x + NODE_W} ${sourceY} L ${turnX} ${sourceY}`}
            />
            {children.length === 1 && Math.abs(children[0].childY - sourceY) < 2 ? (
              <path d={`M ${turnX} ${sourceY} L ${childX} ${sourceY}`} />
            ) : (
              <path d={busEdgePath(childYs, turnX, childX)} />
            )}
          </g>
        )
      })}
    </svg>
  )
}
