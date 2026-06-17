import React, { useMemo, useRef, useCallback, useState, useEffect } from 'react'

import { parseMarkdown, refreshTreeMetadata, serializeMarkdown } from '../core/markdown'
import { createNode, findById, findParent } from '../core/tree'
import type { MindmapFileViewState, TreeNode } from '../types'
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

function applyCollapsedKeys(root: TreeNode, collapsedKeys: Set<string>): void {
  const walk = (node: TreeNode) => {
    node.collapsed = !!node.viewKey && collapsedKeys.has(node.viewKey) && node.children.length > 0
    node.children.forEach(walk)
  }
  root.children.forEach(walk)
}

function findByViewKey(root: TreeNode, viewKey: string): TreeNode | null {
  if (root.viewKey === viewKey) return root
  for (const child of root.children) {
    const found = findByViewKey(child, viewKey)
    if (found) return found
  }
  return null
}

interface Props {
  filePath: string
  fileContent: string
  fileName?: string
  fileLoaded: boolean
  fileError: string
  onSaveContent: (newContent: string) => void
  initialViewState?: MindmapFileViewState
  onViewStateChange?: (patch: Partial<MindmapFileViewState>) => void
}

export default function MindmapReactView({
  filePath, fileContent, fileName, fileLoaded, fileError, onSaveContent,
  initialViewState, onViewStateChange,
}: Props) {
  const [tree, setTree] = useState<TreeNode | null>(null)
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [contextMenu, setContextMenu] = useState<{
    nodeId: string; x: number; y: number
  } | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(() => new Set())

  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const zoomRef = useRef(1)
  const panRef = useRef({ x: 0, y: 0 })
  const graphRef = useRef<ReturnType<typeof buildGraphFromTree> | null>(null)
  const treeRef = useRef<TreeNode | null>(null)
  const editingNodeIdRef = useRef<string | null>(null)
  const editValueRef = useRef('')
  const initialFitDone = useRef(false)
  const hasRestoredViewportRef = useRef(false)
  const hasLoadedTreeForFileRef = useRef(false)
  const skipNextViewportPersistRef = useRef(false)
  const hasAppliedInitialViewportRef = useRef(false)
  const ignoreNextBlurSaveRef = useRef(false)

  // 节点拖拽状态（Pointer Events 驱动）
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)
  const draggingNodeIdRef = useRef<string | null>(null)
  const dropTargetRef = useRef<DropTarget | null>(null)
  const selectedNodeIdsRef = useRef<Set<string>>(new Set())

  const containerRef = useRef<HTMLDivElement>(null)
  const editingElRef = useRef<HTMLSpanElement | null>(null)
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
  useEffect(() => {
    initialFitDone.current = false
    hasRestoredViewportRef.current = false
    hasLoadedTreeForFileRef.current = false
    skipNextViewportPersistRef.current = false
    hasAppliedInitialViewportRef.current = false
  }, [filePath])

  // ── 文件内容同步 ─────────────────────────────
  useEffect(() => {
    if (saveCounterRef.current > 0) {
      saveCounterRef.current -= 1
      return
    }
    if (fileLoaded && fileContent) {
      const t = parseMarkdown(fileContent)
      applyCollapsedKeys(t, new Set(initialViewState?.collapsedKeys || []))
      setTree(t)
      setEditingNodeId(null)
      const selectedNode = initialViewState?.selectedNodeKey
        ? findByViewKey(t, initialViewState.selectedNodeKey)
        : null
      const nextSelectedId = selectedNode?.id || null
      setSelectedNodeId(nextSelectedId)
      setSelectedNodeIds(nextSelectedId ? new Set([nextSelectedId]) : new Set())
      hasLoadedTreeForFileRef.current = true
    }
  }, [fileContent, fileLoaded, initialViewState?.collapsedKeys, initialViewState?.selectedNodeKey])

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
  useEffect(() => { selectedNodeIdsRef.current = selectedNodeIds }, [selectedNodeIds])

  useEffect(() => {
    if (!editingNodeId) return
    const timer = requestAnimationFrame(() => {
      const el = editingElRef.current
      if (!el) return
      el.focus()
      const range = document.createRange()
      range.selectNodeContents(el)
      range.collapse(false)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
    })
    return () => cancelAnimationFrame(timer)
  }, [editingNodeId])

  useEffect(() => {
    if (!tree || !onViewStateChange) return
    const selectedNode = selectedNodeId ? findById(tree, selectedNodeId) : null
    onViewStateChange({ selectedNodeKey: selectedNode?.viewKey || null })
  }, [onViewStateChange, selectedNodeId, tree])

  // ── 树操作工具 ───────────────────────────────
  const cloneTree = (t: TreeNode): TreeNode => JSON.parse(JSON.stringify(t))

  const getCollapsedKeys = useCallback((root: TreeNode): string[] => {
    const keys: string[] = []
    const walk = (node: TreeNode) => {
      if (node.viewKey && node.collapsed && node.children.length > 0) keys.push(node.viewKey)
      node.children.forEach(walk)
    }
    root.children.forEach(walk)
    return keys
  }, [])

  const setTreeOnly = useCallback((modify: (t: TreeNode) => void) => {
    setTree(prev => {
      if (!prev) return prev
      const next = cloneTree(prev)
      modify(next)
      refreshTreeMetadata(next)
      onViewStateChange?.({ collapsedKeys: getCollapsedKeys(next) })
      return next
    })
  }, [getCollapsedKeys, onViewStateChange])

  const saveTree = useCallback((modify: (t: TreeNode) => void) => {
    setTree(prev => {
      if (!prev) return prev
      undoStackRef.current.push(cloneTree(prev))
      if (undoStackRef.current.length > MAX_UNDO) undoStackRef.current.shift()
      const next = cloneTree(prev)
      modify(next)
      refreshTreeMetadata(next)
      const md = serializeMarkdown(next)
      saveCounterRef.current += 1
      onSaveContent(md)
      onViewStateChange?.({ collapsedKeys: getCollapsedKeys(next) })
      return next
    })
  }, [getCollapsedKeys, onSaveContent, onViewStateChange])

  const selectSingleNode = useCallback((nodeId: string | null) => {
    setSelectedNodeId(nodeId)
    setSelectedNodeIds(nodeId ? new Set([nodeId]) : new Set())
  }, [])

  const selectNodeFromPointer = useCallback((nodeId: string, e: React.PointerEvent): void => {
    if (e.metaKey || e.ctrlKey) {
      setSelectedNodeIds(prev => {
        const next = new Set(prev)
        if (next.has(nodeId)) {
          next.delete(nodeId)
        } else {
          next.add(nodeId)
        }
        if (next.size === 0) {
          setSelectedNodeId(null)
        } else {
          setSelectedNodeId(nodeId)
        }
        return next
      })
      return
    }

    if (e.shiftKey && selectedNodeId && treeRef.current) {
      const parent = findParent(treeRef.current, nodeId)
      const anchorParent = findParent(treeRef.current, selectedNodeId)
      if (parent && anchorParent && parent.id === anchorParent.id) {
        const start = parent.children.findIndex(c => c.id === selectedNodeId)
        const end = parent.children.findIndex(c => c.id === nodeId)
        if (start >= 0 && end >= 0) {
          const [from, to] = start < end ? [start, end] : [end, start]
          const ids = parent.children.slice(from, to + 1).map(c => c.id)
          setSelectedNodeIds(new Set(ids))
          setSelectedNodeId(nodeId)
          return
        }
      }
    }

    selectSingleNode(nodeId)
  }, [selectSingleNode, selectedNodeId])

  const createSiblingForNode = (node: TreeNode): TreeNode => {
    const sibling = createNode('')
    sibling.sourceType = node.sourceType || (node.headingLevel ? 'heading' : undefined)
    sibling.headingLevel = node.headingLevel
    return sibling
  }

  const createChildForNode = (node: TreeNode): TreeNode => {
    const child = createNode('')
    child.sourceType = node.sourceType === 'listItem' ? 'listItem' : 'paragraph'
    return child
  }

  const applyEditedText = (node: TreeNode, text: string): void => {
    const marker = parseHeadingMarker(text)
    if (marker.level) {
      node.title = marker.label
      node.sourceType = 'heading'
      node.headingLevel = marker.level as TreeNode['headingLevel']
      return
    }
    node.title = text
  }

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
    selectSingleNode(draggedNodeId)
  }, [saveTree, isAncestor, selectSingleNode])

  // ── 节点编辑 ─────────────────────────────────
  const startEditingNode = useCallback((nodeId: string, initialText?: string, placeCursorAtEnd: boolean = true) => {
    const currentTree = treeRef.current
    const node = currentTree ? findById(currentTree, nodeId) : null
    if (!node) return
    const nextValue = initialText ?? node.title
    selectSingleNode(nodeId)
    setEditingNodeId(nodeId)
    setEditValue(nextValue)
    editValueRef.current = nextValue
    setContextMenu(null)
    requestAnimationFrame(() => {
      const el = editingElRef.current
      if (!el) return
      el.focus()
      const range = document.createRange()
      range.selectNodeContents(el)
      range.collapse(placeCursorAtEnd)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
    })
  }, [selectSingleNode])

  const handleDoubleClick = useCallback((nodeId: string, text: string) => {
    startEditingNode(nodeId, text)
  }, [startEditingNode])

  const handleEditSave = useCallback(() => {
    if (ignoreNextBlurSaveRef.current) {
      ignoreNextBlurSaveRef.current = false
      return
    }
    const newText = editValueRef.current.trim()
    if (!editingNodeId) return
    saveTree((newTree) => {
      const node = findById(newTree, editingNodeId!)
      if (!node) return
      if (newText === node.title) return
      applyEditedText(node, newText)
    })
    setEditingNodeId(null)
    setEditValue('')
    editValueRef.current = ''
  }, [editingNodeId, saveTree])

  const insertSiblingAfter = useCallback((nodeId: string): string | null => {
    const currentTree = treeRef.current
    if (!currentTree || !findParent(currentTree, nodeId)) return null

    const currentNode = findById(currentTree, nodeId)
    if (!currentNode) return null
    const sibling = createSiblingForNode(currentNode)
    saveTree((newTree) => {
      const parent = findParent(newTree, nodeId)
      const refNode = findById(newTree, nodeId)
      if (!parent || !refNode) return
      sibling.depth = refNode.depth
      const idx = parent.children.indexOf(refNode)
      parent.children.splice(idx + 1, 0, sibling)
    })
    selectSingleNode(sibling.id)
    setEditingNodeId(sibling.id)
    setEditValue('')
    editValueRef.current = ''
    return sibling.id
  }, [saveTree, selectSingleNode])

  const insertChildFor = useCallback((nodeId: string): string | null => {
    const currentTree = treeRef.current
    const parentNode = currentTree ? findById(currentTree, nodeId) : null
    if (!parentNode) return null

    const child = createChildForNode(parentNode)
    saveTree((newTree) => {
      const parent = findById(newTree, nodeId)
      if (!parent) return
      child.depth = parent.depth + 1
      parent.children.push(child)
      parent.collapsed = false
    })
    selectSingleNode(child.id)
    setEditingNodeId(child.id)
    setEditValue('')
    editValueRef.current = ''
    return child.id
  }, [saveTree, selectSingleNode])

  const commitEditingAndInsertSibling = useCallback((nodeId: string) => {
    const currentTree = treeRef.current
    if (!currentTree || !findParent(currentTree, nodeId)) return null

    const currentText = editValueRef.current.trim()
    const currentNode = findById(currentTree, nodeId)
    if (!currentNode) return null
    const sibling = createSiblingForNode(currentNode)

    saveTree((newTree) => {
      const node = findById(newTree, nodeId)
      if (!node) return

      applyEditedText(node, currentText)

      const parent = findParent(newTree, nodeId)
      if (!parent) return
      sibling.depth = node.depth
      const idx = parent.children.indexOf(node)
      parent.children.splice(idx + 1, 0, sibling)
    })

    selectSingleNode(sibling.id)
    setEditingNodeId(sibling.id)
    setEditValue('')
    editValueRef.current = ''
    return sibling.id
  }, [saveTree, selectSingleNode])

  const commitEditingAndInsertChild = useCallback((nodeId: string) => {
    const currentTree = treeRef.current
    const currentNode = currentTree ? findById(currentTree, nodeId) : null
    if (!currentNode) return null

    const currentText = editValueRef.current.trim()
    const child = createChildForNode(currentNode)

    saveTree((newTree) => {
      const node = findById(newTree, nodeId)
      if (!node) return

      applyEditedText(node, currentText)

      child.depth = node.depth + 1
      node.children.push(child)
      node.collapsed = false
    })

    selectSingleNode(child.id)
    setEditingNodeId(child.id)
    setEditValue('')
    editValueRef.current = ''
    return child.id
  }, [saveTree, selectSingleNode])

  const handleEditCancel = useCallback(() => {
    ignoreNextBlurSaveRef.current = true
    setEditingNodeId(null)
    setEditValue('')
    editValueRef.current = ''
  }, [])

  // ── 右键菜单操作 ─────────────────────────────
  const handleAddChild = useCallback((nodeId: string) => {
    const parent = tree ? findById(tree, nodeId) : null
    if (!parent) {
      setContextMenu(null)
      return
    }

    const child = createChildForNode(parent)
    child.title = '新节点'
    saveTree((newTree) => {
      const newParent = findById(newTree, nodeId)
      if (!newParent) return
      child.depth = newParent.depth + 1
      newParent.children.push(child)
      newParent.collapsed = false
    })
    selectSingleNode(child.id)
    setContextMenu(null)
  }, [tree, saveTree, selectSingleNode])

  const handleAddSibling = useCallback((nodeId: string) => {
    const parent = tree ? findParent(tree, nodeId) : null
    if (!parent) {
      setContextMenu(null)
      return
    }

    const refNode = tree ? findById(tree, nodeId) : null
    if (!refNode) {
      setContextMenu(null)
      return
    }
    const sibling = createSiblingForNode(refNode)
    sibling.title = '新节点'
    saveTree((newTree) => {
      const newParent = findParent(newTree, nodeId)
      if (!newParent) return
      const refNode = findById(newTree, nodeId)!
      sibling.depth = refNode.depth
      const idx = newParent.children.indexOf(refNode)
      newParent.children.splice(idx + 1, 0, sibling)
    })
    selectSingleNode(sibling.id)
    setContextMenu(null)
  }, [tree, saveTree, selectSingleNode])

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
    if (selectedNodeId === nodeId) selectSingleNode(nextSelection === tree?.id ? null : nextSelection)
  }, [tree, saveTree, selectedNodeId, selectSingleNode])

  const getMergeableSelectedIds = useCallback((root: TreeNode, ids: string[]): string[] => {
    if (ids.length < 2) return []
    const parents = ids.map(id => findParent(root, id))
    const firstParent = parents[0]
    if (!firstParent || parents.some(parent => !parent || parent.id !== firstParent.id)) return []
    const selectedSet = new Set(ids)
    return firstParent.children
      .filter(child => selectedSet.has(child.id))
      .map(child => child.id)
  }, [])

  const handleMergeSelected = useCallback(() => {
    const currentTree = treeRef.current
    if (!currentTree) return
    const ids = getMergeableSelectedIds(currentTree, Array.from(selectedNodeIdsRef.current))
    if (ids.length < 2) return

    const keepId = ids[0]
    saveTree((newTree) => {
      const parent = findParent(newTree, keepId)
      if (!parent) return
      const orderedNodes = parent.children.filter(child => ids.includes(child.id))
      if (orderedNodes.length < 2) return

      const keepNode = orderedNodes[0]
      const mergedTitles = orderedNodes.map(node => node.title.trim()).filter(Boolean)
      const mergedContent = orderedNodes.map(node => node.content.trim()).filter(Boolean)
      keepNode.title = mergedTitles.join('\n')
      keepNode.content = mergedContent.join('\n\n')
      keepNode.children = orderedNodes.flatMap(node => node.children)
      keepNode.children.forEach(child => {
        child.parentId = keepNode.id
      })
      keepNode.collapsed = orderedNodes.some(node => node.collapsed)

      const removeIds = new Set(orderedNodes.slice(1).map(node => node.id))
      parent.children = parent.children.filter(child => !removeIds.has(child.id))
    })

    selectSingleNode(keepId)
    setContextMenu(null)
  }, [getMergeableSelectedIds, saveTree, selectSingleNode])

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
    setTreeOnly((newTree) => {
      const node = findById(newTree, nodeId)
      if (!node || node.children.length === 0) return
      node.collapsed = !node.collapsed
    })
  }, [setTreeOnly])

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
    if (target) selectSingleNode(target)
  }, [selectedNodeId, getSiblingIds, selectSingleNode])

  const handleContextMenu = useCallback((e: React.MouseEvent, nodeId: string) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ nodeId, x: e.clientX, y: e.clientY })
    if (!selectedNodeIdsRef.current.has(nodeId)) selectSingleNode(nodeId)
    setEditingNodeId(null)
  }, [selectSingleNode])

  const handleCanvasClick = useCallback(() => {
    setContextMenu(null)
    setEditingNodeId(null)
    selectSingleNode(null)
  }, [selectSingleNode])

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

    if (!hasRestoredViewportRef.current && initialViewState?.pan && typeof initialViewState.zoom === 'number') {
      skipNextViewportPersistRef.current = true
      setPan(initialViewState.pan)
      setZoom(Math.min(3, Math.max(0.1, initialViewState.zoom)))
      initialFitDone.current = true
      hasRestoredViewportRef.current = true
      hasAppliedInitialViewportRef.current = true
      return
    }

    const timer = requestAnimationFrame(() => {
      fitToView()
      hasAppliedInitialViewportRef.current = true
    })
    initialFitDone.current = true
    return () => cancelAnimationFrame(timer)
  }, [graph, fitToView, initialViewState?.pan, initialViewState?.zoom])

  useEffect(() => {
    if (!filePath || !hasLoadedTreeForFileRef.current || !onViewStateChange) return
    if (!initialFitDone.current) return
    if (!hasAppliedInitialViewportRef.current) return
    if (skipNextViewportPersistRef.current) {
      skipNextViewportPersistRef.current = false
      return
    }
    const timer = window.setTimeout(() => {
      onViewStateChange({ pan, zoom })
    }, 250)
    return () => window.clearTimeout(timer)
  }, [filePath, onViewStateChange, pan, zoom])

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
      if (hasRestoredViewportRef.current) return
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
          const position: DropPosition = localY < band ? 'before' : localY > rect.height - band ? 'after' : 'inside'
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
              if (!findById(prev, restoreSid)) {
                selectSingleNode(null)
              } else {
                selectSingleNode(restoreSid)
              }
            })
          }
        }
        return
      }

      const sid = selectedNodeId
      if (!sid) return

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'm') {
        e.preventDefault()
        e.stopPropagation()
        handleMergeSelected()
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault()
        e.stopPropagation()
        startEditingNode(sid, e.key)
      } else if (e.key === 'F2') {
        e.preventDefault()
        e.stopPropagation()
        startEditingNode(sid)
      } else if (e.key === 'Tab' || e.code === 'Tab') {
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
      handleOutdent, handleDeleteNode, handleMergeSelected, navigateSelection,
      handleEditCancel, insertChildFor, insertSiblingAfter, onSaveContent,
      selectSingleNode, startEditingNode])

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
          canMerge={getMergeableSelectedIds(tree, Array.from(selectedNodeIds)).length >= 2}
          onAddChild={handleAddChild}
          onAddSibling={handleAddSibling}
          onDelete={handleDeleteNode}
          onMergeSelected={handleMergeSelected}
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
            const isSelected = selectedNodeIds.has(node.id)
            const dropPosition = dropTarget?.nodeId === node.id && draggingNodeId !== null && draggingNodeId !== node.id
              ? dropTarget.position
              : null
            const headingMarker = parseHeadingMarker(node.label, node.headingLevel)

            return (
              <div
                key={node.id}
                data-node-id={node.id}
                className={`mm-node depth-${Math.min(node.depth, 5)}${headingMarker.level ? ` heading-mark heading-mark-${headingMarker.level}` : ''}${isEditing ? ' editing' : ''}${isDragging ? ' dragging' : ''}${dropPosition ? ` drop-target drop-${dropPosition}` : ''}${isSelected ? ' selected' : ''}${isSelected && selectedNodeIds.size > 1 ? ' multi-selected' : ''}`}
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
                  selectNodeFromPointer(node.id, e)
                  if (isEditing) return
                  if (e.metaKey || e.ctrlKey || e.shiftKey) return
                  handleNodePointerDown(e, node.id)
                }}
              >
                <div className="mm-body">
                  <span className="mm-title">
                    {headingMarker.level && <span className="mm-heading-badge">H{headingMarker.level}</span>}
                    {isEditing ? (
                      <span
                        ref={editingElRef}
                        className="mm-title-editor"
                        contentEditable
                        suppressContentEditableWarning
                        spellCheck={false}
                        onInput={e => {
                          const value = e.currentTarget.textContent || ''
                          editValueRef.current = value
                        }}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault()
                            e.stopPropagation()
                            ignoreNextBlurSaveRef.current = true
                            commitEditingAndInsertSibling(node.id)
                          } else if (e.key === 'Tab' && !e.shiftKey) {
                            e.preventDefault()
                            e.stopPropagation()
                            ignoreNextBlurSaveRef.current = true
                            commitEditingAndInsertChild(node.id)
                          } else if (e.key === 'Escape') {
                            e.preventDefault()
                            e.stopPropagation()
                            handleEditCancel()
                          }
                        }}
                        onBlur={handleEditSave}
                        onClick={e => e.stopPropagation()}
                        onPointerDown={e => e.stopPropagation()}
                      >
                        {editValue}
                      </span>
                    ) : (
                      <span dangerouslySetInnerHTML={{ __html: renderInlineMarkdown(headingMarker.label) }} />
                    )}
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
