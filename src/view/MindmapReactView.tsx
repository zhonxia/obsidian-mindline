import React, { useMemo, useRef, useCallback, useState, useEffect, ReactNode } from 'react'
import { nanoid } from 'nanoid'

import { parseMarkdown, serializeMarkdown } from '../core/markdown'
import { createNode, findById, findParent } from '../core/tree'
import type { TreeNode } from '../types'

const LEVEL_X = 320
const SIBLING_GAP = 24
const TREE_GAP = 56
const NODE_W = 260
const NODE_H = 34
const CONTENT_NODE_H = 24
const PADDING = 48

interface Props {
  filePath: string
  fileContent: string
  fileName?: string
  fileLoaded: boolean
  fileError: string
  onSaveContent: (newContent: string) => void
}

/** 从 TreeNode 树计算画布布局 */
function buildGraphFromTree(rootTree: TreeNode): {
  nodes: MindmapRenderNode[]
  edges: MindmapRenderEdge[]
  width: number
  height: number
} {
  const nodes: MindmapRenderNode[] = []
  const edgeRefs: { id: string; sourceId: string; targetId: string }[] = []
  let cursorY = PADDING

  for (const child of rootTree.children) {
    const layoutRoot = measureSubtree(child, 0)
    placeSubtree(layoutRoot, PADDING, cursorY, nodes, edgeRefs)
    cursorY += layoutRoot.subtreeH + TREE_GAP
  }

  const byId = new Map(nodes.map(n => [n.id, n]))
  const edges = edgeRefs.flatMap(er => {
    const s = byId.get(er.sourceId)
    const t = byId.get(er.targetId)
    return s && t ? [{ id: er.id, source: s, target: t }] : []
  })

  const maxX = Math.max(...nodes.map(n => n.x + NODE_W), NODE_W)
  const maxY = Math.max(...nodes.map(n => n.y + (n.nodeH ?? NODE_H)), NODE_H)

  return { nodes, edges, width: maxX + PADDING, height: maxY + PADDING }
}

interface LayoutNode {
  data: TreeNode
  depth: number
  nodeH: number
  subtreeH: number
  children: LayoutNode[]
}

function measureSubtree(node: TreeNode, depth: number): LayoutNode {
  const children = node.collapsed ? [] : node.children.map(child => measureSubtree(child, depth + 1))
  const nodeH = estimateNodeHeight(node)
  const childrenH = children.reduce((sum, child) => sum + child.subtreeH, 0) +
    Math.max(0, children.length - 1) * SIBLING_GAP
  return {
    data: node,
    depth,
    nodeH,
    subtreeH: Math.max(nodeH, childrenH),
    children,
  }
}

function placeSubtree(
  layoutNode: LayoutNode,
  x: number,
  top: number,
  nodes: MindmapRenderNode[],
  edgeRefs: { id: string; sourceId: string; targetId: string }[],
): void {
  const nodeY = top + (layoutNode.subtreeH - layoutNode.nodeH) / 2
  const data = layoutNode.data

  nodes.push({
    id: data.id,
    label: data.title || '(empty)',
    content: data.content || '',
    depth: layoutNode.depth,
    childCount: data.children?.length || 0,
    kind: data.kind,
    nodeH: layoutNode.nodeH,
    x,
    y: nodeY,
  })

  let childTop = top
  for (const child of layoutNode.children) {
    edgeRefs.push({
      id: `e_${data.id}_${child.data.id}`,
      sourceId: data.id,
      targetId: child.data.id,
    })
    placeSubtree(child, x + LEVEL_X, childTop, nodes, edgeRefs)
    childTop += child.subtreeH + SIBLING_GAP
  }
}

interface MindmapRenderNode {
  id: string
  label: string
  content: string
  depth: number
  childCount: number
  kind?: 'heading' | 'content'
  nodeH?: number
  x: number
  y: number
}

interface MindmapRenderEdge {
  id: string
  source: MindmapRenderNode
  target: MindmapRenderNode
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

/** 将 edges 按 source 分组，生成总线式连线 */
function busEdgeGroups(edges: MindmapRenderEdge[]): BusGroup[] {
  const map = new Map<string, BusGroup>()
  for (const e of edges) {
    let g = map.get(e.source.id)
    if (!g) {
      const sh = e.source.nodeH ?? NODE_H
      const sx = e.source.x + NODE_W
      const sy = e.source.y + sh / 2
      const gap = e.target.x - sx
      const run = Math.max(gap * 0.5, 24)
      g = { source: e.source, children: [], turnX: sx + run, sourceY: sy, minY: Infinity, maxY: -Infinity }
      map.set(e.source.id, g)
    }
    const th = e.target.nodeH ?? NODE_H
    const ty = e.target.y + th / 2
    g.children.push({ edge: e, child: e.target, childY: ty })
    if (ty < g.minY) g.minY = ty
    if (ty > g.maxY) g.maxY = ty
  }
  return [...map.values()]
}

interface BusGroup {
  source: MindmapRenderNode
  children: Array<{ edge: MindmapRenderEdge; child: MindmapRenderNode; childY: number }>
  turnX: number
  sourceY: number
  minY: number
  maxY: number
}

/** 圆角半径 */
const EDGE_R = 5

/** 生成总线连接线的 SVG path */
function busEdgePath(children: number[], turnX: number, childX: number): string {
  if (children.length === 0) return ''
  if (children.length === 1) {
    const ty = children[0]
    return `M ${turnX} ${ty} L ${childX} ${ty}`
  }
  // 垂直总线：第一个子节点 → 最后一个子节点
  const minTy = Math.min(...children)
  const maxTy = Math.max(...children)
  // 分支：turnX → 到每个子节点的左边缘
  const branches = children.map(ty => {
    const dx = childX - turnX
    return `M ${turnX} ${ty} L ${childX - Math.min(dx * 0.3, 8)} ${ty}`
  }).join(' ')
  return `M ${turnX} ${minTy} L ${turnX} ${maxTy} ${branches}`
}

/** 估算节点实际渲染高度（含标题换行和内容行） */
function estimateNodeHeight(node: TreeNode): number {
  const titleUnitsPerLine = node.kind === 'content' ? 20 : 18
  const titleLines = countWrappedLines(node.title || '(empty)', titleUnitsPerLine)

  if (node.kind === 'content') {
    return Math.max(CONTENT_NODE_H, 12 + titleLines * 15)
  }

  let h = 12 + titleLines * 17
  if (node.content && node.content.trim()) {
    const contentLines = node.content.split('\n').reduce((total, line) => {
      return total + countWrappedLines(line, 22)
    }, 0)
    h += 4 + contentLines * 16
  }
  return Math.max(NODE_H, Math.ceil(h))
}

function countWrappedLines(text: string, unitsPerLine: number): number {
  const lines = text.split('\n')
  return lines.reduce((total, line) => {
    const visualUnits = Math.max(1, estimateTextUnits(line.trim()))
    return total + Math.max(1, Math.ceil(visualUnits / unitsPerLine))
  }, 0)
}

function estimateTextUnits(text: string): number {
  let units = 0
  for (const char of text) {
    if (/[\u3000-\u9fff\uff00-\uffef]/.test(char)) {
      units += 1
    } else if (/\s/.test(char)) {
      units += 0.35
    } else {
      units += 0.58
    }
  }
  return units
}

/** 错误边界 */
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
              {'\n文件路径：' + this.props.filePath}
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

export default function MindmapReactView({
  filePath, fileContent, fileName, fileLoaded, fileError, onSaveContent,
}: Props) {
  const [tree, setTree] = useState<TreeNode | null>(null)
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [contextMenu, setContextMenu] = useState<{
    nodeId: string; x: number; y: number
  } | null>(null)

  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const zoomRef = useRef(1)
  const panRef = useRef({ x: 0, y: 0 })

  // 节点拖拽状态（Pointer Events 驱动）
  // 注意：事件回调里需要同步读取值，所以同时维护 state（驱动渲染）和 ref（驱动逻辑）
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null)
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)
  const draggingNodeIdRef = useRef<string | null>(null)
  const dropTargetIdRef = useRef<string | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  const justSavedRef = useRef(false)

  // 画布拖拽用 useRef（mousedown 兼容鼠标，触控板用 wheel 平移）
  const panDragRef = useRef<{
    dragging: boolean; startX: number; startY: number; panX: number; panY: number
  }>({ dragging: false, startX: 0, startY: 0, panX: 0, panY: 0 })

  // 节点拖拽用的全局 pointer 事件清理函数 ref
  const dragCleanupRef = useRef<(() => void) | null>(null)

  // 同步 zoom/pan 到 ref（供 wheel 事件回调读取最新值）
  useEffect(() => { zoomRef.current = zoom }, [zoom])
  useEffect(() => { panRef.current = pan }, [pan])

  // ── 文件内容同步 ─────────────────────────────
  useEffect(() => {
    if (justSavedRef.current) {
      justSavedRef.current = false
      return
    }
    if (fileLoaded && fileContent) {
      const t = parseMarkdown(fileContent)
      setTree(t)
      setEditingNodeId(null)
    }
  }, [fileContent, fileLoaded])

  // ── 布局计算 ─────────────────────────────────
  const graph = useMemo(() => {
    if (!tree) return null
    try {
      return buildGraphFromTree(tree)
    } catch (e) {
      console.error('[MindMap-React] buildGraph error:', e)
      return null
    }
  }, [tree])

  // ── 树操作工具 ───────────────────────────────
  const cloneTree = (t: TreeNode): TreeNode => JSON.parse(JSON.stringify(t))

  const saveTree = useCallback((modify: (t: TreeNode) => void) => {
    setTree(prev => {
      if (!prev) return prev
      const next = cloneTree(prev)
      modify(next)
      const md = serializeMarkdown(next)
      justSavedRef.current = true
      onSaveContent(md)
      return next
    })
  }, [onSaveContent])

  const isAncestor = useCallback((root: TreeNode, ancestorId: string, nodeId: string): boolean => {
    if (root.id === ancestorId) {
      const findNode = (n: TreeNode): boolean => {
        if (n.id === nodeId) return true
        for (const c of n.children) {
          if (findNode(c)) return true
        }
        return false
      }
      return findNode(root)
    }
    for (const c of root.children) {
      if (isAncestor(c, ancestorId, nodeId)) return true
    }
    return false
  }, [])

  // ── 拖放：改变节点父子关系 ──────────────────
  const handleDrop = useCallback((draggedNodeId: string, targetNodeId: string) => {
    if (draggedNodeId === targetNodeId) return
    saveTree((newTree) => {
      const draggedNode = findById(newTree, draggedNodeId)
      const targetNode = findById(newTree, targetNodeId)
      if (!draggedNode || !targetNode) return
      if (isAncestor(draggedNode, draggedNode.id, targetNodeId)) return

      const oldParent = findParent(newTree, draggedNodeId)
      if (!oldParent) return
      const idx = oldParent.children.findIndex(c => c.id === draggedNodeId)
      if (idx >= 0) oldParent.children.splice(idx, 1)

      targetNode.children.push(draggedNode)

      const updateDepth = (node: TreeNode, depth: number) => {
        node.depth = depth
        node.children.forEach(c => updateDepth(c, depth + 1))
      }
      updateDepth(draggedNode, targetNode.depth + 1)
    })
  }, [saveTree, isAncestor])

  // ── 节点编辑 ─────────────────────────────────
  const handleDoubleClick = useCallback((nodeId: string, currentTitle: string) => {
    setEditingNodeId(nodeId)
    setEditValue(currentTitle)
    setContextMenu(null)
  }, [])

  const handleEditSave = useCallback(() => {
    const newTitle = editValue.trim()
    if (!newTitle || !editingNodeId) return
    saveTree((newTree) => {
      const node = findById(newTree, editingNodeId!)
      if (!node) return
      if (newTitle === node.title) return
      node.title = newTitle
    })
    setEditingNodeId(null)
    setEditValue('')
  }, [editingNodeId, editValue, saveTree])

  const handleEditCancel = useCallback(() => {
    setEditingNodeId(null)
    setEditValue('')
  }, [])

  // ── 右键菜单操作 ─────────────────────────────
  const handleAddChild = useCallback((nodeId: string) => {
    saveTree((newTree) => {
      const parent = findById(newTree, nodeId)
      if (!parent) return
      const child = createNode('新节点')
      child.depth = parent.depth + 1
      parent.children.push(child)
    })
    setContextMenu(null)
  }, [saveTree])

  const handleAddSibling = useCallback((nodeId: string) => {
    saveTree((newTree) => {
      const parent = findParent(newTree, nodeId)
      if (!parent) return
      const refNode = findById(newTree, nodeId)!
      const sibling = createNode('新节点')
      sibling.depth = refNode.depth
      const idx = parent.children.indexOf(refNode)
      parent.children.splice(idx + 1, 0, sibling)
    })
    setContextMenu(null)
  }, [saveTree])

  const handleDeleteNode = useCallback((nodeId: string) => {
    saveTree((newTree) => {
      const parent = findParent(newTree, nodeId)
      if (!parent) return
      const idx = parent.children.findIndex(c => c.id === nodeId)
      if (idx >= 0) parent.children.splice(idx, 1)
    })
    setContextMenu(null)
  }, [saveTree])

  const handleContextMenu = useCallback((e: React.MouseEvent, nodeId: string) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ nodeId, x: e.clientX, y: e.clientY })
    setEditingNodeId(null)
  }, [])

  const handleCanvasClick = useCallback(() => {
    setContextMenu(null)
    setEditingNodeId(null)
  }, [])

  // ── 自适应 ───────────────────────────────────
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

  // ── 滚轮 / 触控板（原生事件，非 passive）───
  // Mac 触控板：双指滑动 → wheel 事件（deltaMode=0, 小数值）→ 平移
  // Mac 触控板：捏合 → wheel 事件（ctrlKey=true）→ 缩放
  // 鼠标滚轮：deltaY 为大整数（≥50）→ 缩放（以光标为中心）
  // 用 window + capture 确保在 Obsidian 父级滚动容器之前拦截事件
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      const container = containerRef.current
      if (!container) return
      // 只处理在 mindmap 容器内的事件
      const rect = container.getBoundingClientRect()
      if (e.clientX < rect.left || e.clientX > rect.right ||
          e.clientY < rect.top || e.clientY > rect.bottom) return

      e.preventDefault()
      e.stopPropagation()
      const absDY = Math.abs(e.deltaY)
      // 触控板判定：deltaMode=0(像素) + deltaY 极小（触控板典型值 0.5~3，鼠标 ≥8）
      const isTrackpad = e.deltaMode === 0 && absDY < 5

      if (isTrackpad && !e.ctrlKey) {
        // 触控板双指滑动 → 平移画布
        setPan(prev => ({
          x: prev.x - (e.deltaX || 0),
          y: prev.y - e.deltaY,
        }))
      } else {
        // 鼠标滚轮 或 触控板捏合 → 以光标为中心缩放
        const cx = e.clientX - rect.left
        const cy = e.clientY - rect.top
        const oldZoom = zoomRef.current
        const oldPan = panRef.current

        const factor = e.deltaY > 0 ? -1 : 1
        const newZoom = Math.min(3, Math.max(0.1, +(oldZoom + factor * 0.1).toFixed(2)))
        const scale = newZoom / oldZoom

        setZoom(newZoom)
        setPan({
          x: cx - (cx - oldPan.x) * scale,
          y: cy - (cy - oldPan.y) * scale,
        })
      }
    }
    window.addEventListener('wheel', onWheel, { passive: false, capture: true })
    return () => window.removeEventListener('wheel', onWheel)
  }, [])

  // ── 画布拖拽（鼠标中键/左键拖拽，触控板不用此方式）──
  const handleCanvasPointerDown = useCallback((e: React.PointerEvent) => {
    // 只响应鼠标左键/中键拖拽画布；触控板用 wheel 平移，不在这里处理
    if (e.pointerType === 'touch') return
    if ((e.target as HTMLElement).closest('.mm-node')) return
    setContextMenu(null)
    const d = panDragRef.current
    d.dragging = true
    d.startX = e.clientX
    d.startY = e.clientY
    d.panX = pan.x
    d.panY = pan.y
  }, [pan])

  const handleCanvasPointerMove = useCallback((e: React.PointerEvent) => {
    const d = panDragRef.current
    if (!d.dragging) return
    setPan({ x: d.panX + (e.clientX - d.startX), y: d.panY + (e.clientY - d.startY) })
  }, [])

  const handleCanvasPointerUp = useCallback(() => {
    panDragRef.current.dragging = false
  }, [])

  // ── 节点拖拽（Pointer Events，兼容鼠标/触控板/三指拖拽）──
  const handleNodePointerDown = useCallback((e: React.PointerEvent, nodeId: string) => {
    if (editingNodeId) return
    e.stopPropagation()
    e.preventDefault()

    const container = containerRef.current
    if (!container) return

    // 同时更新 state（驱动渲染）和 ref（驱动事件回调逻辑）
    draggingNodeIdRef.current = nodeId
    dropTargetIdRef.current = null
    setDraggingNodeId(nodeId)
    setDropTargetId(null)

    const handlePointerMove = (ev: PointerEvent) => {
      // 用 elementsFromPoint 获取指针下所有元素，跳过拖拽中的节点
      const elements = document.elementsFromPoint(ev.clientX, ev.clientY)
      let foundId: string | null = null
      for (const el of elements) {
        const nodeEl = (el as HTMLElement).closest?.('[data-node-id]') as HTMLElement | null
        if (nodeEl && nodeEl.dataset.nodeId && nodeEl.dataset.nodeId !== draggingNodeIdRef.current) {
          foundId = nodeEl.dataset.nodeId
          break
        }
      }
      dropTargetIdRef.current = foundId
      setDropTargetId(foundId)
    }

    const handlePointerUp = (ev: PointerEvent) => {
      const dragId = draggingNodeIdRef.current
      const tgtId = dropTargetIdRef.current
      if (dragId && tgtId && dragId !== tgtId) {
        handleDrop(dragId, tgtId)
      }
      draggingNodeIdRef.current = null
      dropTargetIdRef.current = null
      setDraggingNodeId(null)
      setDropTargetId(null)
      container.removeEventListener('pointermove', handlePointerMove)
      container.removeEventListener('pointerup', handlePointerUp)
    }

    container.addEventListener('pointermove', handlePointerMove)
    container.addEventListener('pointerup', handlePointerUp)
    dragCleanupRef.current = () => {
      container.removeEventListener('pointermove', handlePointerMove)
      container.removeEventListener('pointerup', handlePointerUp)
    }
  }, [editingNodeId, handleDrop])

  // 组件卸载时清理拖拽监听
  useEffect(() => {
    return () => {
      if (dragCleanupRef.current) dragCleanupRef.current()
    }
  }, [])

  // ── 渲染 ─────────────────────────────────────
  if (!fileLoaded) {
    return <MindmapMessage title="正在读取文件" detail={filePath || '等待传入文件'} />
  }
  if (fileError) {
    return <MindmapMessage title="读取文件失败" detail={fileError} />
  }
  if (!fileContent) {
    return <MindmapMessage title="文件内容为空" detail={fileName || filePath} />
  }
  if (!tree) {
    return <MindmapMessage title="正在解析文档结构…" />
  }
  if (!graph || graph.nodes.length === 0) {
    return <MindmapMessage title="当前文档没有标题（# Heading），无法生成脑图" detail={fileName || filePath} />
  }

  return (
    <MindmapErrorBoundary filePath={filePath}>
      {/* 右键菜单 */}
      {contextMenu && (
        <div
          className="mindmap-context-menu"
          style={{ position: 'fixed', left: contextMenu.x, top: contextMenu.y }}
          onMouseDown={e => e.stopPropagation()}
        >
          <div className="mindmap-context-item" onClick={() => handleAddChild(contextMenu.nodeId)}>
            ➕ 添加子节点
          </div>
          <div className="mindmap-context-item" onClick={() => handleAddSibling(contextMenu.nodeId)}>
            ⬆ 添加同级节点
          </div>
          {findParent(tree, contextMenu.nodeId) && (
            <div className="mindmap-context-item danger" onClick={() => handleDeleteNode(contextMenu.nodeId)}>
              🗑 删除节点
            </div>
          )}
        </div>
      )}

      <div
        ref={containerRef}
        className="mindmap-react-inner"
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handleCanvasPointerMove}
        onPointerUp={handleCanvasPointerUp}
        onPointerLeave={handleCanvasPointerUp}
        onClick={handleCanvasClick}
        style={{ touchAction: 'none' }}
      >
        <div
          className="mindmap-canvas"
          style={{
            width: `${graph.width}px`,
            height: `${graph.height}px`,
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: '0 0',
          }}
          onClick={e => e.stopPropagation()}
        >
          <svg className="mindmap-edges" width={graph.width} height={graph.height}>
            {busEdgeGroups(graph.edges).map((g, gi) => {
              const { source, children, turnX, sourceY } = g
              const childYs = children.map(c => c.childY)
              const childX = children.length > 0 ? children[0].child.x : turnX

              return (
                <g key={`bus-${gi}`}>
                  {/* 水平线：父节点右边缘 → 转折点 */}
                  <path
                    d={`M ${source.x + NODE_W} ${sourceY} L ${turnX} ${sourceY}`}
                  />
                  {/* 如果只有1个子节点且水平对齐，画直线 */}
                  {children.length === 1 && Math.abs(children[0].childY - sourceY) < 2 ? (
                    <path d={`M ${turnX} ${sourceY} L ${childX} ${sourceY}`} />
                  ) : (
                    <>
                      {/* 总线：垂直主干 + 分支线 */}
                      <path d={busEdgePath(childYs, turnX, childX)} />
                    </>
                  )}
                </g>
              )
            })}
          </svg>

          {graph.nodes.map(node => {
            const isEditing = editingNodeId === node.id
            const isDragging = draggingNodeId === node.id
            const isDropTarget = dropTargetId === node.id && draggingNodeId !== null && draggingNodeId !== node.id

            return (
              <div
                key={node.id}
                data-node-id={node.id}
                className={`mm-node depth-${Math.min(node.depth, 4)}${node.kind === 'content' ? ' kind-content' : ''}${isDragging ? ' dragging' : ''}${isDropTarget ? ' drop-target' : ''}`}
                style={{
                  left: `${node.x}px`,
                  top: `${node.y}px`,
                  width: `${NODE_W}px`,
                  minHeight: `${node.nodeH ?? NODE_H}px`,
                }}
                title={node.content ? `${node.label}\n\n${node.content}` : node.label}
                onDoubleClick={() => handleDoubleClick(node.id, node.label)}
                onContextMenu={e => handleContextMenu(e, node.id)}
                onPointerDown={e => handleNodePointerDown(e, node.id)}
              >
                {isEditing ? (
                  <input
                    className="mm-edit-input"
                    value={editValue}
                    onChange={e => setEditValue(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleEditSave()
                      if (e.key === 'Escape') handleEditCancel()
                    }}
                    onBlur={handleEditSave}
                    autoFocus
                    onClick={e => e.stopPropagation()}
                    onPointerDown={e => e.stopPropagation()}
                  />
                ) : (
                  <>
                    <div className="mm-body">
                      <span className="mm-title">{node.label}</span>
                      {node.content && <div className="mm-content">{node.content}</div>}
                    </div>
                    {node.childCount > 0 && <span className="mm-badge">{node.childCount}</span>}
                    {/* 拖拽手柄：按住此区域拖拽节点 */}
                    <span
                      className="mm-drag-handle"
                      title="拖拽到其它节点上以改变层级"
                      style={{
                        position: 'absolute',
                        left: -8,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        width: 16,
                        height: 24,
                        cursor: 'grab',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#94a3b8',
                        fontSize: 10,
                        borderRadius: 4,
                        userSelect: 'none',
                      }}
                      onPointerDown={e => {
                        e.stopPropagation()
                        handleNodePointerDown(e, node.id)
                      }}
                    >⋮</span>
                  </>
                )}
              </div>
            )
          })}
        </div>

        <div className="mindmap-zoom-info">{Math.round(zoom * 100)}%</div>

        {/* 拖拽提示 */}
        {draggingNodeId && (
          <div className="mindmap-drag-hint">
            拖拽到目标节点上释放以改变层级关系
          </div>
        )}
      </div>
    </MindmapErrorBoundary>
  )
}
