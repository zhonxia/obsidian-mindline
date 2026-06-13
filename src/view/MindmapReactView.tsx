import React, { useMemo, useRef, useCallback, useState, useEffect } from 'react'

import { parseMarkdown, serializeMarkdown } from '../core/markdown'
import { createNode, findById, findParent } from '../core/tree'
import type { TreeNode } from '../types'
import {
  buildGraphFromTree,
  parseHeadingMarker,
  renderInlineMarkdown,
  estimateNodeHeight,
  PADDING,
  NODE_W,
  NODE_H,
  type MindmapRenderNode,
  type MindmapRenderEdge,
  type DropPosition,
  type DropTarget,
} from './MindmapLayout'
import MindmapEdges from './MindmapEdges'
import MindmapContextMenu from './MindmapContextMenu'
import MindmapToolbar from './MindmapToolbar'
import MindmapErrorBoundary from './MindmapErrorBoundary'
import MindmapMessage from './MindmapMessage'

interface Props {
  filePath: string
  fileContent: string
  fileName?: string
  fileLoaded: boolean
  fileError: string
  onSaveContent: (newContent: string) => void
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
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)
  const draggingNodeIdRef = useRef<string | null>(null)
  const dropTargetRef = useRef<DropTarget | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  /** 保存计数器：每次 saveTree 递增，fileContent 变化时递减 */
  const saveCounterRef = useRef(0)
  const MAX_UNDO = 50
  const undoStackRef = useRef<TreeNode[]>([])

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
      undoStackRef.current.push(cloneTree(prev))
      if (undoStackRef.current.length > MAX_UNDO) undoStackRef.current.shift()
      const next = cloneTree(prev)
      modify(next)
      const md = serializeMarkdown(next)
      saveCounterRef.current += 1
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

      if (position === 'inside') {
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
  const handleDoubleClick = useCallback((nodeId: string, text: string) => {
    setEditingNodeId(nodeId)
    setEditValue(text)
    setContextMenu(null)
  }, [])

  const handleEditSave = useCallback(() => {
    const newText = editValue.trim()
    if (!editingNodeId) return
    saveTree((newTree) => {
      const node = findById(newTree, editingNodeId!)
      if (!node) return
      if (newText === node.title) return
      node.title = newText
    })
    setEditingNodeId(null)
    setEditValue('')
  }, [editingNodeId, editValue, saveTree])

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
    setEditValue('')
    editValueRef.current = ''
    return sibling.id
  }, [saveTree])

  const insertChildFor = useCallback((nodeId: string): string | null => {
    const currentTree = treeRef.current
    const parentNode = currentTree ? findById(currentTree, nodeId) : null
    if (!parentNode) return null

    const child = createNode('')
    saveTree((newTree) => {
      const parent = findById(newTree, nodeId)
      if (!parent) return
      child.depth = parent.depth + 1
      parent.children.push(child)
      parent.collapsed = false
    })
    setSelectedNodeId(child.id)
    setEditingNodeId(child.id)
    setEditValue('')
    editValueRef.current = ''
    return child.id
  }, [saveTree])

  const commitEditingAndInsertSibling = useCallback((nodeId: string) => {
    const currentTree = treeRef.current
    if (!currentTree || !findParent(currentTree, nodeId)) return null

    const currentText = editValueRef.current.trim()
    const sibling = createNode('')

    saveTree((newTree) => {
      const node = findById(newTree, nodeId)
      if (!node) return

      node.title = currentText

      const parent = findParent(newTree, nodeId)
      if (!parent) return
      sibling.depth = node.depth
      const idx = parent.children.indexOf(node)
      parent.children.splice(idx + 1, 0, sibling)
    })

    setSelectedNodeId(sibling.id)
    setEditingNodeId(sibling.id)
    setEditValue('')
    editValueRef.current = ''
    return sibling.id
  }, [saveTree])

  const commitEditingAndInsertChild = useCallback((nodeId: string) => {
    const currentTree = treeRef.current
    const currentNode = currentTree ? findById(currentTree, nodeId) : null
    if (!currentNode) return null

    const currentText = editValueRef.current.trim()
    const child = createNode('')

    saveTree((newTree) => {
      const node = findById(newTree, nodeId)
      if (!node) return

      node.title = currentText

      child.depth = node.depth + 1
      node.children.push(child)
      node.collapsed = false
    })

    setSelectedNodeId(child.id)
    setEditingNodeId(child.id)
    setEditValue('')
    editValueRef.current = ''
    return child.id
  }, [saveTree])

  const handleEditCancel = useCallback(() => {
    setEditingNodeId(null)
    setEditValue('')
  }, [])

  // ── 右键菜单操作 ─────────────────────────────
  const handleAddChild = useCallback((nodeId: string) => {
    const parent = tree ? findById(tree, nodeId) : null
    if (!parent) {
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
      if (idx <= 0) return
      const newParent = oldParent.children[idx - 1]
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
      if (!grandParent) return
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

  // ── 窗口大小变化自适应 ──
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

  // ── 工具栏缩放回调 ─────────────────────────
  const handleZoomIn = useCallback(() => {
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
  }, [zoom])

  const handleZoomOut = useCallback(() => {
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
  }, [zoom])

  // ── 滚轮 / 触控板 ──
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      const container = containerRef.current
      if (!container) return
      const rect = container.getBoundingClientRect()
      if (e.clientX < rect.left || e.clientX > rect.right ||
          e.clientY < rect.top || e.clientY > rect.bottom) return

      e.preventDefault()
      e.stopPropagation()
      const absDY = Math.abs(e.deltaY)
      const isTrackpad = e.deltaMode === 0 && absDY < 5

      if (isTrackpad && !e.ctrlKey) {
        setPan(prev => ({
          x: prev.x - (e.deltaX || 0),
          y: prev.y - e.deltaY,
        }))
      } else {
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

  // ── 画布拖拽 ──
  const handleCanvasPointerDown = useCallback((e: React.PointerEvent) => {
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

  // ── 节点拖拽 ──
  const handleNodePointerDown = useCallback((e: React.PointerEvent, nodeId: string) => {
    if (editingNodeId) return
    e.stopPropagation()
    e.preventDefault()

    const container = containerRef.current
    if (!container) return

    draggingNodeIdRef.current = nodeId
    dropTargetRef.current = null
    setDraggingNodeId(nodeId)
    setDropTarget(null)

    const handlePointerMove = (ev: PointerEvent) => {
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
      if (editingNodeId) {
        if (e.key === 'Escape') { handleEditCancel(); e.preventDefault() }
        return
      }
      if ((e.target as HTMLElement)?.tagName === 'INPUT' ||
          (e.target as HTMLElement)?.tagName === 'TEXTAREA') return

      // Ctrl+Z / Cmd+Z 撤回
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault()
        e.stopPropagation()
        const prev = undoStackRef.current.pop()
        if (prev) {
          const md = serializeMarkdown(prev)
          saveCounterRef.current += 1
          onSaveContent(md)
          setTree(prev)
          setEditingNodeId(null)
          setContextMenu(null)
          if (selectedNodeId) {
            const restoreSid = selectedNodeId
            requestAnimationFrame(() => {
              if (!findById(prev, restoreSid)) setSelectedNodeId(null)
            })
          }
        }
        return
      }

      const sid = selectedNodeId
      if (!sid) return

      if (e.key === 'Tab' || e.code === 'Tab') {
        e.preventDefault()
        e.stopPropagation()
        e.stopImmediatePropagation()
        if (e.shiftKey) {
          handleOutdent(sid)
        } else {
          insertChildFor(sid)
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
      handleOutdent, handleDeleteNode, navigateSelection,
      handleEditCancel, insertChildFor, insertSiblingAfter, onSaveContent])

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
    return <MindmapMessage title="当前文档没有大纲项，无法生成脑图" detail={fileName || filePath} />
  }

  return (
    <MindmapErrorBoundary filePath={filePath}>
      {/* 右键菜单 */}
      {contextMenu && (
        <MindmapContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          nodeId={contextMenu.nodeId}
          canDelete={!!findParent(tree, contextMenu.nodeId)}
          onAddChild={handleAddChild}
          onAddSibling={handleAddSibling}
          onDelete={handleDeleteNode}
        />
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
          <MindmapEdges edges={graph.edges} width={graph.width} height={graph.height} />

          {graph.nodes.map(node => {
            const isEditing = editingNodeId === node.id
            const isDragging = draggingNodeId === node.id
            const dropPosition = dropTarget?.nodeId === node.id && draggingNodeId !== null && draggingNodeId !== node.id
              ? dropTarget.position
              : null
            const headingMarker = parseHeadingMarker(node.label)

            return (
              <div
                key={node.id}
                data-node-id={node.id}
                className={`mm-node depth-${Math.min(node.depth, 5)}${headingMarker.level ? ` heading-mark heading-mark-${headingMarker.level}` : ''}${isDragging ? ' dragging' : ''}${dropPosition ? ` drop-target drop-${dropPosition}` : ''}${node.id === selectedNodeId ? ' selected' : ''}`}
                style={{
                  left: `${node.x}px`,
                  top: `${node.y}px`,
                  width: `${NODE_W}px`,
                  minHeight: `${node.nodeH ?? NODE_H}px`,
                }}
                title={node.content ? `${node.label}\n\n${node.content}` : node.label}
                onDoubleClick={() => handleDoubleClick(node.id, node.label)}
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
                        if (e.key === 'Tab' && !e.shiftKey) {
                          e.preventDefault()
                          e.stopPropagation()
                          commitEditingAndInsertChild(node.id)
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
                    <div className="mm-edit-hint">Enter 新建同级 · Tab 新建子级 · Shift+Enter 换行 · Esc 取消</div>
                  </div>
                ) : (
                  <>
                    <div className="mm-body">
                      <span className="mm-title">
                        {headingMarker.level && <span className="mm-heading-badge">H{headingMarker.level}</span>}
                        <span dangerouslySetInnerHTML={{ __html: renderInlineMarkdown(headingMarker.label) }} />
                      </span>
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

        <MindmapToolbar zoom={zoom} onZoomIn={handleZoomIn} onZoomOut={handleZoomOut} onFitToView={fitToView} />

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
