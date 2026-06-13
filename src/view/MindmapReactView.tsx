import React, { useMemo, useRef, useCallback, useState, useEffect, ReactNode } from 'react'
import * as d3Hierarchy from 'd3-hierarchy'
import { nanoid } from 'nanoid'

import { parseMarkdown, serializeMarkdown } from '../core/markdown'
import { createNode, findById, findParent } from '../core/tree'
import type { TreeNode } from '../types'

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
  let yOffset = 0

  for (const child of rootTree.children) {
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

  const byId = new Map(nodes.map(n => [n.id, n]))
  const edges = edgeRefs.flatMap(er => {
    const s = byId.get(er.sourceId)
    const t = byId.get(er.targetId)
    return s && t ? [{ id: er.id, source: s, target: t }] : []
  })

  const maxX = Math.max(...nodes.map(n => n.x + NODE_W), NODE_W)
  const maxY = Math.max(...nodes.map(n => n.y + NODE_H), NODE_H)

  return { nodes, edges, width: maxX + PADDING, height: maxY + PADDING }
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

function edgePath(edge: MindmapRenderEdge): string {
  const sx = edge.source.x + NODE_W
  const sy = edge.source.y + NODE_H / 2
  const tx = edge.target.x
  const ty = edge.target.y + NODE_H / 2
  const mid = Math.max(48, (tx - sx) / 2)
  return `M ${sx} ${sy} C ${sx + mid} ${sy}, ${tx - mid} ${ty}, ${tx} ${ty}`
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
  // tree 状态：内部维护的文档树
  const [tree, setTree] = useState<TreeNode | null>(null)
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [contextMenu, setContextMenu] = useState<{
    nodeId: string; x: number; y: number
  } | null>(null)

  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const dragRef = useRef<{
    dragging: boolean; startX: number; startY: number; panX: number; panY: number
  }>({ dragging: false, startX: 0, startY: 0, panX: 0, panY: 0 })
  const containerRef = useRef<HTMLDivElement>(null)
  const justSavedRef = useRef(false)

  // 当 fileContent 从外部变化时，重建 tree（排除自己刚保存的）
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

  // 从 tree 计算画布布局
  const graph = useMemo(() => {
    if (!tree) return null
    try {
      return buildGraphFromTree(tree)
    } catch (e) {
      console.error('[MindMap-React] buildGraph error:', e)
      return null
    }
  }, [tree])

  // 保存 tree → markdown → 通知父组件写入文件
  // 每次修改前先深拷贝，避免直接修改 state
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

  // 编辑节点标题
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

  // 添加子节点
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

  // 添加同级节点
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

  // 删除节点
  const handleDeleteNode = useCallback((nodeId: string) => {
    saveTree((newTree) => {
      const parent = findParent(newTree, nodeId)
      if (!parent) return // 不能删除根节点
      const idx = parent.children.findIndex(c => c.id === nodeId)
      if (idx >= 0) parent.children.splice(idx, 1)
    })
    setContextMenu(null)
  }, [saveTree])

  // 右键菜单
  const handleContextMenu = useCallback((e: React.MouseEvent, nodeId: string) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ nodeId, x: e.clientX, y: e.clientY })
    setEditingNodeId(null)
  }, [])

  // 点击空白关闭右键菜单
  const handleCanvasClick = useCallback(() => {
    setContextMenu(null)
    setEditingNodeId(null)
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

  // 滚轮缩放（原生事件，非 passive）
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

  // 拖拽
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.mm-node')) return
    setContextMenu(null)
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

  // ── 渲染 ──────────────────────────────────

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
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onClick={handleCanvasClick}
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
            {graph.edges.map(edge => (
              <path key={edge.id} d={edgePath(edge)} />
            ))}
          </svg>

          {graph.nodes.map(node => {
            const isEditing = editingNodeId === node.id
            return (
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
                onDoubleClick={() => handleDoubleClick(node.id, node.label)}
                onContextMenu={e => handleContextMenu(e, node.id)}
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
                    onMouseDown={e => e.stopPropagation()}
                  />
                ) : (
                  <>
                    <span className="mm-title">{node.label}</span>
                    {node.childCount > 0 && <span className="mm-badge">{node.childCount}</span>}
                  </>
                )}
              </div>
            )
          })}
        </div>

        <div className="mindmap-zoom-info">{Math.round(zoom * 100)}%</div>
      </div>
    </MindmapErrorBoundary>
  )
}
