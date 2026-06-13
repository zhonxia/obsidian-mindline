import React, { useMemo, useRef, useCallback, useState, useEffect, ReactNode } from 'react'

import { parseMarkdown, serializeMarkdown } from '../core/markdown'
import { createNode, findById, findParent } from '../core/tree'
import type { TreeNode } from '../types'

const LEVEL_X = 320
const SIBLING_GAP = 36
const TREE_GAP = 64
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
    collapsed: data.collapsed,
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
  collapsed: boolean
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

type DropPosition = 'before' | 'inside' | 'after'

interface DropTarget {
  nodeId: string
  position: DropPosition
}

/** 渲染标题中的基本 Markdown 内联语法（**粗体** *斜体* `代码` ~~删除线~~） */
function renderInlineMarkdown(text: string): string {
  // 安全转义 HTML
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  // **粗体**
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  // *斜体*（不匹配 **）
  html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>')
  // `代码`
  html = html.replace(/`(.+?)`/g, '<code>$1</code>')
  // ~~删除线~~
  html = html.replace(/~~(.+?)~~/g, '<del>$1</del>')
  return html
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
  const [editingNodeKind, setEditingNodeKind] = useState<'heading' | 'content'>('heading')
  const [editValue, setEditValue] = useState('')
  const [contextMenu, setContextMenu] = useState<{
    nodeId: string; x: number; y: number
  } | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)

  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const zoomRef = useRef(1)
  const panRef = useRef({ x: 0, y: 0 })
  const graphRef = useRef<ReturnType<typeof buildGraphFromTree> | null>(null)
  const treeRef = useRef<TreeNode | null>(null)
  const editingNodeIdRef = useRef<string | null>(null)
  const editValueRef = useRef('')
  const initialFitDone = useRef(false)

  // 节点拖拽状态（Pointer Events 驱动）
  // 注意：事件回调里需要同步读取值，所以同时维护 state（驱动渲染）和 ref（驱动逻辑）
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)
  const draggingNodeIdRef = useRef<string | null>(null)
  const dropTargetRef = useRef<DropTarget | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  /** 保存计数器：每次 saveTree 递增，fileContent 变化时递减。
   *   防止异步写入期间的陈旧数据覆盖本地状态。 */
  const saveCounterRef = useRef(0)

  // 画布拖拽用 useRef（mousedown 兼容鼠标，触控板用 wheel 平移）
  const panDragRef = useRef<{
    dragging: boolean; startX: number; startY: number; panX: number; panY: number
  }>({ dragging: false, startX: 0, startY: 0, panX: 0, panY: 0 })

  // 节点拖拽用的全局 pointer 事件清理函数 ref
  const dragCleanupRef = useRef<(() => void) | null>(null)

  // 同步 zoom/pan 到 ref（供 wheel 事件回调读取最新值）
  useEffect(() => { zoomRef.current = zoom }, [zoom])
  useEffect(() => { panRef.current = pan }, [pan])
  useEffect(() => { editingNodeIdRef.current = editingNodeId }, [editingNodeId])
  useEffect(() => { editValueRef.current = editValue }, [editValue])
  useEffect(() => { initialFitDone.current = false }, [filePath])

  // ── 文件内容同步 ─────────────────────────────
  useEffect(() => {
    // 跳过由本组件 saveTree 触发的文件更新（与 saveCounterRef 配对）
    if (saveCounterRef.current > 0) {
      saveCounterRef.current -= 1
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

  useEffect(() => { graphRef.current = graph }, [graph])
  useEffect(() => { treeRef.current = tree }, [tree])

  // ── 树操作工具 ───────────────────────────────
  const cloneTree = (t: TreeNode): TreeNode => JSON.parse(JSON.stringify(t))

  const saveTree = useCallback((modify: (t: TreeNode) => void) => {
    setTree(prev => {
      if (!prev) return prev
      const next = cloneTree(prev)
      modify(next)
      const md = serializeMarkdown(next)
      saveCounterRef.current += 1  // 配对 useEffect 中的递减
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

  // ── 拖放：改变节点父子关系 / 同级顺序 ────────
  const handleDrop = useCallback((draggedNodeId: string, targetNodeId: string, position: DropPosition) => {
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

      const updateDepth = (node: TreeNode, depth: number) => {
        node.depth = depth
        node.children.forEach(c => updateDepth(c, depth + 1))
      }

      if (position === 'inside' && targetNode.kind !== 'content') {
        targetNode.children.push(draggedNode)
        targetNode.collapsed = false
        updateDepth(draggedNode, targetNode.depth + 1)
        return
      }

      const targetParent = findParent(newTree, targetNodeId)
      if (!targetParent) return
      const targetIdx = targetParent.children.findIndex(c => c.id === targetNodeId)
      if (targetIdx < 0) return
      const insertIdx = position === 'before' ? targetIdx : targetIdx + 1
      targetParent.children.splice(insertIdx, 0, draggedNode)
      updateDepth(draggedNode, targetNode.depth)
    })
    setSelectedNodeId(draggedNodeId)
  }, [saveTree, isAncestor])

  // ── 节点编辑 ─────────────────────────────────
  const handleDoubleClick = useCallback((nodeId: string, text: string, kind?: 'heading' | 'content') => {
    setEditingNodeId(nodeId)
    setEditingNodeKind(kind || 'heading')
    setEditValue(text)
    setContextMenu(null)
  }, [])

  const handleEditSave = useCallback(() => {
    const newText = editValue.trim()
    if (!editingNodeId) return
    saveTree((newTree) => {
      const node = findById(newTree, editingNodeId!)
      if (!node) return
      if (editingNodeKind === 'content') {
        if (newText === node.content) return
        node.content = newText
      } else {
        if (newText === node.title) return
        node.title = newText
      }
    })
    setEditingNodeId(null)
    setEditValue('')
  }, [editingNodeId, editValue, editingNodeKind, saveTree])

  const insertSiblingAfter = useCallback((nodeId: string): string | null => {
    const currentTree = treeRef.current
    if (!currentTree || !findParent(currentTree, nodeId)) return null

    const sibling = createNode('')
    saveTree((newTree) => {
      const parent = findParent(newTree, nodeId)
      const refNode = findById(newTree, nodeId)
      if (!parent || !refNode) return
      sibling.depth = refNode.depth
      const idx = parent.children.indexOf(refNode)
      parent.children.splice(idx + 1, 0, sibling)
    })
    setSelectedNodeId(sibling.id)
    setEditingNodeId(sibling.id)
    setEditingNodeKind('heading')
    setEditValue('')
    editValueRef.current = ''
    return sibling.id
  }, [saveTree])

  const insertChildFor = useCallback((nodeId: string): string | null => {
    const currentTree = treeRef.current
    const parentNode = currentTree ? findById(currentTree, nodeId) : null
    if (!parentNode || parentNode.kind === 'content') return null

    const child = createNode('')
    saveTree((newTree) => {
      const parent = findById(newTree, nodeId)
      if (!parent || parent.kind === 'content') return
      child.depth = parent.depth + 1
      parent.children.push(child)
      parent.collapsed = false
    })
    setSelectedNodeId(child.id)
    setEditingNodeId(child.id)
    setEditingNodeKind('heading')
    setEditValue('')
    editValueRef.current = ''
    return child.id
  }, [saveTree])

  const commitEditingAndInsertSibling = useCallback((nodeId: string) => {
    const currentTree = treeRef.current
    if (!currentTree || !findParent(currentTree, nodeId)) return null

    const currentKind = editingNodeKind
    const currentText = editValueRef.current.trim()
    const sibling = createNode('')

    saveTree((newTree) => {
      const node = findById(newTree, nodeId)
      if (!node) return

      if (currentKind === 'content') {
        node.content = currentText
      } else {
        node.title = currentText
      }

      const parent = findParent(newTree, nodeId)
      if (!parent) return
      sibling.depth = node.depth
      const idx = parent.children.indexOf(node)
      parent.children.splice(idx + 1, 0, sibling)
    })

    setSelectedNodeId(sibling.id)
    setEditingNodeId(sibling.id)
    setEditingNodeKind('heading')
    setEditValue('')
    editValueRef.current = ''
    return sibling.id
  }, [editingNodeKind, saveTree])

  const handleEditCancel = useCallback(() => {
    setEditingNodeId(null)
    setEditingNodeKind('heading')
    setEditValue('')
  }, [])

  // ── 右键菜单操作 ─────────────────────────────
  const handleAddChild = useCallback((nodeId: string) => {
    const parent = tree ? findById(tree, nodeId) : null
    if (!parent || parent.kind === 'content') {
      setContextMenu(null)
      return
    }

    const child = createNode('新节点')
    saveTree((newTree) => {
      const newParent = findById(newTree, nodeId)
      if (!newParent) return
      child.depth = newParent.depth + 1
      newParent.children.push(child)
      newParent.collapsed = false
    })
    setSelectedNodeId(child.id)
    setContextMenu(null)
  }, [tree, saveTree])

  const handleAddSibling = useCallback((nodeId: string) => {
    const parent = tree ? findParent(tree, nodeId) : null
    if (!parent) {
      setContextMenu(null)
      return
    }

    const sibling = createNode('新节点')
    saveTree((newTree) => {
      const newParent = findParent(newTree, nodeId)
      if (!newParent) return
      const refNode = findById(newTree, nodeId)!
      sibling.depth = refNode.depth
      const idx = newParent.children.indexOf(refNode)
      newParent.children.splice(idx + 1, 0, sibling)
    })
    setSelectedNodeId(sibling.id)
    setContextMenu(null)
  }, [tree, saveTree])

  const handleDeleteNode = useCallback((nodeId: string) => {
    let nextSelection: string | null = null
    if (tree) {
      const parent = findParent(tree, nodeId)
      if (parent) {
        const idx = parent.children.findIndex(c => c.id === nodeId)
        nextSelection = parent.children[idx + 1]?.id || parent.children[idx - 1]?.id || parent.id
      }
    }

    saveTree((newTree) => {
      const parent = findParent(newTree, nodeId)
      if (!parent) return
      const idx = parent.children.findIndex(c => c.id === nodeId)
      if (idx >= 0) parent.children.splice(idx, 1)
    })
    setContextMenu(null)
    if (selectedNodeId === nodeId) setSelectedNodeId(nextSelection === tree?.id ? null : nextSelection)
  }, [tree, saveTree, selectedNodeId])

  // ── 缩进 / 反向缩进 ─────────────────────────
  const handleIndent = useCallback((nodeId: string) => {
    saveTree((newTree) => {
      const node = findById(newTree, nodeId)
      const oldParent = findParent(newTree, nodeId)
      if (!node || !oldParent) return
      const idx = oldParent.children.indexOf(node)
      if (idx <= 0) return  // 需要前一个兄弟作为新父节点
      const newParent = oldParent.children[idx - 1]
      if (newParent.kind === 'content') return
      oldParent.children.splice(idx, 1)
      newParent.children.push(node)
      newParent.collapsed = false
    })
  }, [saveTree])

  const handleOutdent = useCallback((nodeId: string) => {
    saveTree((newTree) => {
      const node = findById(newTree, nodeId)
      const oldParent = findParent(newTree, nodeId)
      if (!node || !oldParent) return
      const grandParent = findParent(newTree, oldParent.id)
      if (!grandParent) return  // 根节点不能反向缩进
      const childIdx = oldParent.children.indexOf(node)
      oldParent.children.splice(childIdx, 1)
      const parentIdx = grandParent.children.indexOf(oldParent)
      grandParent.children.splice(parentIdx + 1, 0, node)
    })
  }, [saveTree])

  // ── 节点折叠 ───────────────────────────────
  const handleToggleCollapse = useCallback((nodeId: string) => {
    saveTree((newTree) => {
      const node = findById(newTree, nodeId)
      if (!node || node.children.length === 0) return
      node.collapsed = !node.collapsed
    })
  }, [saveTree])

  // ── 选中节点导航 ───────────────────────────
  const getSiblingIds = useCallback((nodeId: string): { prev: string | null; next: string | null } => {
    if (!tree) return { prev: null, next: null }
    const parent = findParent(tree, nodeId)
    if (!parent) return { prev: null, next: null }
    const siblings = parent.children
    const idx = siblings.findIndex(c => c.id === nodeId)
    return {
      prev: idx > 0 ? siblings[idx - 1].id : null,
      next: idx < siblings.length - 1 ? siblings[idx + 1].id : null,
    }
  }, [tree])

  const navigateSelection = useCallback((direction: 'up' | 'down') => {
    if (!selectedNodeId) return
    const { prev, next } = getSiblingIds(selectedNodeId)
    const target = direction === 'up' ? prev : next
    if (target) setSelectedNodeId(target)
  }, [selectedNodeId, getSiblingIds])

  const handleContextMenu = useCallback((e: React.MouseEvent, nodeId: string) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ nodeId, x: e.clientX, y: e.clientY })
    setSelectedNodeId(nodeId)
    setEditingNodeId(null)
  }, [])

  const handleCanvasClick = useCallback(() => {
    setContextMenu(null)
    setEditingNodeId(null)
  }, [])

  // ── 自适应 ───────────────────────────────────
  const fitToView = useCallback(() => {
    const graph = graphRef.current
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
  }, [])

  // ── 初始自适应（仅首次加载）──
  useEffect(() => {
    if (!graph || graph.nodes.length === 0) return
    if (initialFitDone.current) return
    const container = containerRef.current
    if (!container) return
    const timer = requestAnimationFrame(() => fitToView())
    initialFitDone.current = true
    return () => cancelAnimationFrame(timer)
  }, [graph, fitToView])

  // ── 窗口大小变化自适应（不随 graph / 编辑状态变化重新注册）──
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let didObserveInitialSize = false
    const ro = new ResizeObserver(() => {
      if (!didObserveInitialSize) {
        didObserveInitialSize = true
        return
      }
      if (editingNodeIdRef.current) return
      fitToView()
    })
    ro.observe(container)
    return () => ro.disconnect()
  }, [fitToView])

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
        const newZoom = Math.min(3, Math.max(0.1, +(oldZoom + factor * 0.06).toFixed(3)))
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
    dropTargetRef.current = null
    setDraggingNodeId(nodeId)
    setDropTarget(null)

    const handlePointerMove = (ev: PointerEvent) => {
      // 用 elementsFromPoint 获取指针下所有元素，跳过拖拽中的节点
      const elements = document.elementsFromPoint(ev.clientX, ev.clientY)
      let foundTarget: DropTarget | null = null
      for (const el of elements) {
        const nodeEl = (el as HTMLElement).closest?.('[data-node-id]') as HTMLElement | null
        if (nodeEl && nodeEl.dataset.nodeId && nodeEl.dataset.nodeId !== draggingNodeIdRef.current) {
          const rect = nodeEl.getBoundingClientRect()
          const localY = ev.clientY - rect.top
          const band = rect.height * 0.28
          let position: DropPosition = localY < band ? 'before' : localY > rect.height - band ? 'after' : 'inside'
          if (position === 'inside' && nodeEl.dataset.nodeKind === 'content') position = 'after'
          foundTarget = { nodeId: nodeEl.dataset.nodeId, position }
          break
        }
      }
      dropTargetRef.current = foundTarget
      setDropTarget(foundTarget)
    }

    const handlePointerUp = (ev: PointerEvent) => {
      const dragId = draggingNodeIdRef.current
      const target = dropTargetRef.current
      if (dragId && target && dragId !== target.nodeId) {
        handleDrop(dragId, target.nodeId, target.position)
      }
      draggingNodeIdRef.current = null
      dropTargetRef.current = null
      setDraggingNodeId(null)
      setDropTarget(null)
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

  // ── 全局键盘快捷键 ──────────────────────
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // 编辑模式下只处理 Escape
      if (editingNodeId) {
        if (e.key === 'Escape') { handleEditCancel(); e.preventDefault() }
        return
      }
      // 输入框内不拦截
      if ((e.target as HTMLElement)?.tagName === 'INPUT' ||
          (e.target as HTMLElement)?.tagName === 'TEXTAREA') return

      const sid = selectedNodeId
      if (!sid) return

      if (e.key === 'Tab' || e.code === 'Tab') {
        e.preventDefault()
        e.stopPropagation()
        e.stopImmediatePropagation()
        if (e.shiftKey) {
          handleOutdent(sid)
        } else {
          handleIndent(sid)
        }
      } else if (e.key === 'Enter' && !contextMenu) {
        e.preventDefault()
        e.stopPropagation()
        if (e.shiftKey) {
          insertChildFor(sid)
        } else {
          insertSiblingAfter(sid)
        }
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        e.stopPropagation()
        handleDeleteNode(sid)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        e.stopPropagation()
        navigateSelection('up')
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        e.stopPropagation()
        navigateSelection('down')
      }
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [editingNodeId, selectedNodeId, contextMenu,
      handleIndent, handleOutdent, handleDeleteNode, navigateSelection,
      handleEditCancel, insertChildFor, insertSiblingAfter])

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
            const dropPosition = dropTarget?.nodeId === node.id && draggingNodeId !== null && draggingNodeId !== node.id
              ? dropTarget.position
              : null

            return (
              <div
                key={node.id}
                data-node-id={node.id}
                data-node-kind={node.kind || 'heading'}
                className={`mm-node depth-${Math.min(node.depth, 5)}${node.kind === 'content' ? ' kind-content' : ''}${isDragging ? ' dragging' : ''}${dropPosition ? ` drop-target drop-${dropPosition}` : ''}${node.id === selectedNodeId ? ' selected' : ''}`}
                style={{
                  left: `${node.x}px`,
                  top: `${node.y}px`,
                  width: `${NODE_W}px`,
                  minHeight: `${node.nodeH ?? NODE_H}px`,
                }}
                title={node.content ? `${node.label}\n\n${node.content}` : node.label}
                onDoubleClick={() => {
                  const text = node.kind === 'content' ? (node.content || node.label) : node.label
                  handleDoubleClick(node.id, text, node.kind)
                }}
                onContextMenu={e => handleContextMenu(e, node.id)}
                onPointerDown={e => {
                  setSelectedNodeId(node.id)
                  handleNodePointerDown(e, node.id)
                }}
              >
                {isEditing ? (
                  <div className="mm-edit-wrap">
                    <textarea
                      className="mm-edit-input"
                      value={editValue}
                      onChange={e => {
                        editValueRef.current = e.target.value
                        setEditValue(e.target.value)
                      }}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          e.stopPropagation()
                          commitEditingAndInsertSibling(node.id)
                        }
                        if (e.key === 'Escape') {
                          e.stopPropagation()
                          handleEditCancel()
                        }
                      }}
                      onBlur={handleEditSave}
                      autoFocus
                      rows={3}
                      onClick={e => e.stopPropagation()}
                      onPointerDown={e => e.stopPropagation()}
                    />
                    <div className="mm-edit-hint">Enter 新建同级 · Shift+Enter 换行 · Esc 取消</div>
                  </div>
                ) : (
                  <>
                    <div className="mm-body">
                      <span className="mm-title" dangerouslySetInnerHTML={{ __html: renderInlineMarkdown(node.label) }} />
                      {node.content && <div className="mm-content">{node.content}</div>}
                    </div>
                    {node.childCount > 0 && (
                      <span
                        className={`mm-collapse-btn${node.collapsed ? ' collapsed' : ''}`}
                        onClick={e => {
                          e.stopPropagation()
                          handleToggleCollapse(node.id)
                        }}
                        title={node.collapsed ? `展开 (${node.childCount}个子节点)` : `收起 (${node.childCount}个子节点)`}
                      >
                        <span className="mm-collapse-icon">{node.collapsed ? '▶' : '▼'}</span>
                        <span className="mm-collapse-count">{node.childCount}</span>
                      </span>
                    )}
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

        <div className="mindmap-toolbar">
          <button className="mindmap-toolbar-btn" onClick={() => {
            const newZoom = Math.min(3, +(zoom + 0.1).toFixed(2))
            const container = containerRef.current
            if (container) {
              const rect = container.getBoundingClientRect()
              const cx = rect.width / 2
              const cy = rect.height / 2
              const scale = newZoom / zoom
              setZoom(newZoom)
              setPan(prev => ({
                x: cx - (cx - prev.x) * scale,
                y: cy - (cy - prev.y) * scale,
              }))
            }
          }} title="放大">+</button>
          <span className="mindmap-toolbar-label">{Math.round(zoom * 100)}%</span>
          <button className="mindmap-toolbar-btn" onClick={() => {
            const newZoom = Math.max(0.1, +(zoom - 0.1).toFixed(2))
            const container = containerRef.current
            if (container) {
              const rect = container.getBoundingClientRect()
              const cx = rect.width / 2
              const cy = rect.height / 2
              const scale = newZoom / zoom
              setZoom(newZoom)
              setPan(prev => ({
                x: cx - (cx - prev.x) * scale,
                y: cy - (cy - prev.y) * scale,
              }))
            }
          }} title="缩小">−</button>
          <button className="mindmap-toolbar-btn" onClick={fitToView} title="适应画布">⊡</button>
        </div>

        {/* 拖拽提示 */}
        {draggingNodeId && (
          <div className="mindmap-drag-hint">
            {dropTarget
              ? dropTarget.position === 'before'
                ? '释放后插入到目标上方'
                : dropTarget.position === 'after'
                  ? '释放后插入到目标下方'
                  : '释放后成为目标子节点'
              : '拖到节点上方/中间/下方选择插入位置'}
          </div>
        )}
      </div>
    </MindmapErrorBoundary>
  )
}
