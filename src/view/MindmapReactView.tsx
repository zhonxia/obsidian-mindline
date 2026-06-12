import { useState, useEffect, useCallback, useRef } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  BaseEdge,
  getBezierPath,
  applyNodeChanges,
  applyEdgeChanges,
  type NodeChange,
  type EdgeChange,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import * as d3 from 'd3'
import { parseMarkdown, serializeMarkdown } from '../core/markdown'
import { findById } from '../core/tree'
import type { TreeNode } from '../types'
import { MindmapNode } from '../components/MindmapNode'
import { MindmapEdge } from '../components/MindmapEdge'

const NODE_W = 48
const DEPTH_W = 220
const TREE_GAP = 24
const MARGIN = { top: 16, left: 30 }

const nodeTypes = { mindmapNode: MindmapNode }
const edgeTypes = { mindmapEdge: MindmapEdge }

interface MindmapReactViewProps {
  fileContent: string
  fileName: string
  onSave: (content: string) => void
  /** 供外部获取当前 tree 的 ref */
  onTreeChange?: (tree: TreeNode | null) => void
}

export default function MindmapReactView({ fileContent, fileName, onSave, onTreeChange }: MindmapReactViewProps) {
  const [tree, setTree] = useState<TreeNode | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [nodes, setNodes] = useState<any[]>([])
  const [edges, setEdges] = useState<any[]>([])
  const [fitKey, setFitKey] = useState(0)
  const rfInstance = useRef<any>(null)
  const initKey = useRef(0)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Parse markdown → tree
  useEffect(() => {
    if (fileContent) {
      const root = parseMarkdown(fileContent)
      setTree(root)
    }
  }, [fileContent])

  // Notify parent when tree changes (for save-on-toggle)
  useEffect(() => {
    if (onTreeChange) {
      onTreeChange(tree)
    }
  }, [tree, onTreeChange])

  // Auto-save when tree changes (no debounce — Obsidian vault.modify is fast)
  useEffect(() => {
    if (!tree) return
    const md = serializeMarkdown(tree)
    onSave(md)
  }, [tree, onSave])

  // Build graph when tree changes
  useEffect(() => {
    if (!tree) { setNodes([]); setEdges([]); return }
    const { nodes: ns, edges: es } = buildGraph(tree, activeId, focusedId)
    setNodes(ns)
    setEdges(es)
    initKey.current++
    setFitKey(initKey.current)
  }, [tree, focusedId])

  // buildGraph function (ported from MindMD)
  function buildGraph(root: TreeNode, activeId: string | null, focusedId: string | null) {
    const nodes: any[] = []
    const edges: any[] = []

    function preview(body: string): string {
      return body.replace(/\n/g, ' ').slice(0, 60)
    }

    let yOffset = 0
    const layoutRoots = focusedId
      ? (findById(root, focusedId) || root).id === root.id ? root.children : [findById(root, focusedId)!]
      : root.children

    for (const child of layoutRoots) {
      const h = d3.hierarchy<TreeNode>(child, d => d.collapsed ? undefined : d.children)
      const treeLayout = d3.tree<TreeNode>().nodeSize([NODE_W, DEPTH_W]).separation((a, b) => a.parent === b.parent ? 1 : 1.3)
      treeLayout(h)

      h.each(d => {
        const node = d.data
        nodes.push({
          id: node.id,
          type: 'mindmapNode',
          position: { x: d.y! + MARGIN.left, y: d.x! + yOffset + MARGIN.top },
          sourcePosition: Position.Right,
          targetPosition: Position.Left,
          data: {
            id: node.id,
            label: node.title || '',
            depth: d.depth,
            isActive: node.id === activeId,
            collapsed: node.collapsed,
            childCount: node.children.length,
            preview: preview(node.content),
            shouldEdit: false,
            onToggleCollapse: handleToggleCollapse,
            onSetFocused: handleSetFocused,
            onUpdateTitle: handleUpdateTitle,
          },
        })
      })

      h.links().forEach(link => {
        edges.push({
          id: `e_${link.source.data.id}_${link.target.data.id}`,
          source: link.source.data.id,
          target: link.target.data.id,
          type: 'mindmapEdge',
        })
      })

      const maxY = Math.max(...h.descendants().map(d => d.x!))
      yOffset += maxY + TREE_GAP
    }

    return { nodes, edges }
  }

  // Callbacks
  const handleToggleCollapse = useCallback((id: string) => {
    setTree(prev => {
      if (!prev) return prev
      const node = findById(prev, id)
      if (node) node.collapsed = !node.collapsed
      return { ...prev }
    })
  }, [])

  const handleSetFocused = useCallback((id: string) => {
    setFocusedId(prev => prev === id ? null : id)
  }, [])

  const handleUpdateTitle = useCallback((id: string, title: string) => {
    setTree(prev => {
      if (!prev) return prev
      const node = findById(prev, id)
      if (node) node.title = title
      return { ...prev }
    })
  }, [])

  // Manual save (for Save button)
  const handleSave = useCallback(() => {
    if (tree) {
      const md = serializeMarkdown(tree)
      onSave(md)
    }
  }, [tree, onSave])

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div style={{ position: 'absolute', top: 8, left: 8, zIndex: 10, display: 'flex', gap: 8 }}>
        <button onClick={handleSave} style={{ padding: '4px 12px', cursor: 'pointer', fontSize: 12 }}>
          Save to Markdown
        </button>
        {focusedId && (
          <button onClick={() => setFocusedId(null)} style={{ padding: '4px 12px', cursor: 'pointer', fontSize: 12 }}>
            ← Back
          </button>
        )}
      </div>

      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable={true}
        nodesConnectable={false}
        elementsSelectable={true}
        selectNodesOnDrag={false}
        fitView={false}
        minZoom={0.15}
        maxZoom={3}
        proOptions={{ hideAttribution: true }}
        onInit={(instance) => { rfInstance.current = instance }}
      >
        <Background color="var(--background-modifier-border, #e2e8f0)" gap={20} size={0.8} />
        <Controls showInteractive={false} position="bottom-right" />
      </ReactFlow>
    </div>
  )
}
