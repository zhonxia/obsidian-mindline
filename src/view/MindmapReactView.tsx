import React, { useMemo, useRef, useCallback, useState, useEffect, ReactNode } from 'react'
import * as d3Hierarchy from 'd3-hierarchy'

import { parseMarkdown } from '../core/markdown'

const LEVEL_X = 240
const ROW_Y = 58
const TREE_GAP = 36
const NODE_W = 168
const NODE_H = 34
const PADDING = 32

interface Props {
  filePath: string
  fileContent: string
  fileName?: string
  fileLoaded: boolean
  fileError: string
}

interface MindmapRenderNode {
  id: string
  label: string
  depth: number
  childCount: number
  x: number
  y: number
}

interface MindmapRenderEdge {
  id: string
  source: MindmapRenderNode
  target: MindmapRenderNode
}

/** 错误边界 — 捕获渲染异常，避免整个插件白屏 */
class MindmapErrorBoundary extends React.Component<
  { children: ReactNode; filePath: string },
  { hasError: boolean; error?: Error }
> {
  constructor(props: { children: ReactNode; filePath: string }) {
    super(props)
    this.state = { hasError: false }
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="mindmap-message">
          <div className="mindmap-message-card">
            <div className="mindmap-message-title">脑图渲染出错</div>
            <div className="mindmap-message-detail">
              {this.state.error?.message || '未知错误'}

文件路径：{this.props.filePath}
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

function MindmapMessage({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="mindmap-message">
      <div className="mindmap-message-card">
        <div className="mindmap-message-title">{title}</div>
        {detail && <div className="mindmap-message-detail">{detail}</div>}
      </div>
    </div>
  )
}

function buildGraph(markdown: string): {
  nodes: MindmapRenderNode[]
  edges: MindmapRenderEdge[]
  width: number
  height: number
  error?: string
} {
  const root = parseMarkdown(markdown)
  if (!root.children.length) {
    return {
      nodes: [],
      edges: [],
      width: 0,
      height: 0,
      error: '当前文档没有标题（# Heading），无法生成脑图',
    }
  }

  const nodes: MindmapRenderNode[] = []
  const edgeRefs: { id: string; sourceId: string; targetId: string }[] = []
  let yOffset = 0

  for (const child of root.children) {
    const hierarchyRoot = d3Hierarchy.hierarchy<any>(child, d => d.children)
    const tree = d3Hierarchy.tree<any>()
      .nodeSize([ROW_Y, LEVEL_X])
      .separation((a, b) => (a.parent === b.parent ? 1 : 1.25))

    tree(hierarchyRoot)

    const descendants = hierarchyRoot.descendants()
    const minTreeY = Math.min(...descendants.map(d => d.x ?? 0))
    const maxTreeY = Math.max(...descendants.map(d => d.x ?? 0))

    for (const d of descendants) {
      const data = d.data
      nodes.push({
        id: data.id,
        label: data.title || '(empty)',
        depth: d.depth,
        childCount: data.children?.length || 0,
        x: PADDING + (d.y ?? 0),
        y: PADDING + yOffset + (d.x ?? 0) - minTreeY,
      })
    }

    for (const link of hierarchyRoot.links()) {
      edgeRefs.push({
        id: `e_${link.source.data.id}_${link.target.data.id}`,
        sourceId: link.source.data.id,
        targetId: link.target.data.id,
      })
    }

    yOffset += Math.max(ROW_Y, maxTreeY - minTreeY + ROW_Y) + TREE_GAP
  }

  const byId = new Map(nodes.map(node => [node.id, node]))
  const edges = edgeRefs.flatMap(edge => {
    const source = byId.get(edge.sourceId)
    const target = byId.get(edge.targetId)
    return source && target ? [{ id: edge.id, source, target }] : []
  })

  const maxX = Math.max(...nodes.map(node => node.x + NODE_W), NODE_W)
  const maxY = Math.max(...nodes.map(node => node.y + NODE_H), NODE_H)

  return {
    nodes,
    edges,
    width: maxX + PADDING,
    height: maxY + PADDING,
  }
}

function edgePath(edge: MindmapRenderEdge): string {
  const sx = edge.source.x + NODE_W
  const sy = edge.source.y + NODE_H / 2
  const tx = edge.target.x
  const ty = edge.target.y + NODE_H / 2
  const mid = Math.max(48, (tx - sx) / 2)

  return `M ${sx} ${sy} C ${sx + mid} ${sy}, ${tx - mid} ${ty}, ${tx} ${ty}`
}

export default function MindmapReactView({ filePath, fileContent, fileName, fileLoaded, fileError }: Props) {
  console.log('[MindMap-React] render', {
    fileLoaded,
    fileError,
    contentLength: fileContent?.length,
    filePath,
  })

  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const dragRef = useRef<{
    dragging: boolean
    startX: number
    startY: number
    panX: number
    panY: number
  }>({ dragging: false, startX: 0, startY: 0, panX: 0, panY: 0 })
  const containerRef = useRef<HTMLDivElement>(null)

  const graph = useMemo(() => {
    if (!fileLoaded || fileError || !fileContent) return null
    try {
      return buildGraph(fileContent)
    } catch (error) {
      console.error('[MindMap-React] buildGraph error:', error)
      return {
        nodes: [],
        edges: [],
        width: 0,
        height: 0,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }, [fileLoaded, fileError, fileContent])

  // 用原生事件监听器（非 passive）处理滚轮缩放
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const delta = e.deltaY > 0 ? -0.08 : 0.08
      setZoom(prev => Math.min(3, Math.max(0.1, +(prev + delta).toFixed(2))))
    }

    container.addEventListener('wheel', onWheel, { passive: false })
    return () => container.removeEventListener('wheel', onWheel)
  }, [])

  // 自适应
  const fitToView = useCallback(() => {
    const container = containerRef.current
    if (!container || !graph || graph.nodes.length === 0) return
    const rect = container.getBoundingClientRect()
    const scaleX = (rect.width - 40) / graph.width
    const scaleY = (rect.height - 40) / graph.height
    const newZoom = Math.min(scaleX, scaleY, 1.5)
    const offsetX = (rect.width - graph.width * newZoom) / 2
    const offsetY = (rect.height - graph.height * newZoom) / 2
    setZoom(newZoom)
    setPan({ x: offsetX, y: offsetY })
  }, [graph])

  useEffect(() => {
    if (!graph || graph.nodes.length === 0) return
    const container = containerRef.current
    if (!container) return
    const timer = requestAnimationFrame(() => fitToView())
    const ro = new ResizeObserver(() => fitToView())
    ro.observe(container)
    return () => { cancelAnimationFrame(timer); ro.disconnect() }
  }, [graph, fitToView])

  // 拖拽
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.mm-node')) return
    const d = dragRef.current
    d.dragging = true
    d.startX = e.clientX
    d.startY = e.clientY
    d.panX = pan.x
    d.panY = pan.y
  }, [pan])

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    const d = dragRef.current
    if (!d.dragging) return
    setPan({ x: d.panX + (e.clientX - d.startX), y: d.panY + (e.clientY - d.startY) })
  }, [])

  const onMouseUp = useCallback(() => {
    dragRef.current.dragging = false
  }, [])

  if (!fileLoaded) {
    return <MindmapMessage title="正在读取文件" detail={filePath || '等待 Obsidian 传入当前 Markdown 文件'} />
  }

  if (fileError) {
    return <MindmapMessage title="读取文件失败" detail={fileError} />
  }

  if (!fileContent) {
    return <MindmapMessage title="当前文件内容为空，无法生成脑图" detail={fileName || filePath} />
  }

  if (!graph || graph.error || graph.nodes.length === 0) {
    return <MindmapMessage title={graph?.error || '没有可显示的节点'} detail={fileName || filePath} />
  }

  return (
    <MindmapErrorBoundary filePath={filePath}>
      <div
        ref={containerRef}
        className="mindmap-react-inner"
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
      >
        <div
          className="mindmap-canvas"
          style={{
            width: `${graph.width}px`,
            height: `${graph.height}px`,
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: '0 0',
          }}
        >
          <svg className="mindmap-edges" width={graph.width} height={graph.height}>
            {graph.edges.map(edge => (
              <path key={edge.id} d={edgePath(edge)} />
            ))}
          </svg>

          {graph.nodes.map(node => (
            <div
              key={node.id}
              className={`mm-node depth-${Math.min(node.depth, 4)}`}
              style={{
                left: `${node.x}px`,
                top: `${node.y}px`,
                width: `${NODE_W}px`,
                minHeight: `${NODE_H}px`,
              }}
              title={node.label}
            >
              <span className="mm-title">{node.label}</span>
              {node.childCount > 0 && <span className="mm-badge">{node.childCount}</span>}
            </div>
          ))}
        </div>

        <div className="mindmap-zoom-info">{Math.round(zoom * 100)}%</div>
      </div>
    </MindmapErrorBoundary>
  )
}
