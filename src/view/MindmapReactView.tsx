import { useState, useEffect, useRef } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
} from '@xyflow/react'
import * as d3 from 'd3'
import { parseMarkdown, serializeMarkdown } from '../core/markdown'
import type { TreeNode } from '../types'

function MindmapNode({ data }: any) {
  return (
    <div style={{
      padding: '8px 16px',
      background: '#fff',
      border: data.depth === 0 ? '2px solid #3b82f6' : '1.5px solid #94a3b8',
      borderRadius: 8,
      fontSize: data.depth === 0 ? 15 : 13,
      fontWeight: data.depth === 0 ? 700 : 500,
      color: '#1e293b',
      boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
      whiteSpace: 'nowrap',
    }}>
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
      {data.label || '(empty)'}
    </div>
  )
}

const nodeTypes = { mindmapNode: MindmapNode }

interface Props {
  fileContent: string
  fileName: string
  onSave: (content: string) => void
}

export default function MindmapReactView({ fileContent, fileName, onSave }: Props) {
  const [tree, setTree] = useState<TreeNode | null>(null)
  const [nodes, setNodes] = useState<any[]>([])
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 800, h: 600 })
  const containerRef = useRef<HTMLDivElement>(null)
  const rfWrapperRef = useRef<HTMLDivElement>(null)

  // 关键：用 ResizeObserver + 多重策略确保拿到正确的容器尺寸
  useEffect(() => {
    let attempts = 0
    const maxAttempts = 20

    const measure = () => {
      // 策略1：直接测量 rfWrapper（ReactFlow 的父容器）
      if (rfWrapperRef.current) {
        const rect = rfWrapperRef.current.getBoundingClientRect()
        if (rect.width > 10 && rect.height > 10) {
          setSize({ w: Math.round(rect.width), h: Math.round(rect.height) })
          return true
        }
      }
      
      // 策略2：测量外层容器
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect()
        if (rect.width > 10 && rect.height > 10) {
          setSize({ w: Math.round(rect.width), h: Math.round(rect.height) })
          return true
        }
      }

      // 策略3：用 window 尺寸作为兜底
      setSize({
        w: Math.max(window.innerWidth - 300, 600),
        h: Math.max(window.innerHeight - 200, 400),
      })
      return false
    }

    // 立即测一次
    measure()

    // 持续尝试直到拿到有效尺寸
    const interval = setInterval(() => {
      attempts++
      const ok = measure()
      if (ok || attempts >= maxAttempts) clearInterval(interval)
    }, 200)

    // ResizeObserver 监听窗口变化
    const ro = new ResizeObserver(() => measure())
    
    // 观察多个层级，确保至少一个能触发
    if (rfWrapperRef.current) ro.observe(rfWrapperRef.current)
    if (containerRef.current) ro.observe(containerRef.current)
    // 也观察 document body 作为最终兜底
    ro.observe(document.body)

    // 窗口 resize 时也测
    window.addEventListener('resize', measure)

    return () => {
      clearInterval(interval)
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  // Parse
  useEffect(() => {
    if (!fileContent) return
    try {
      setTree(parseMarkdown(fileContent))
    } catch (e) { console.error(e) }
  }, [fileContent])

  // Build graph — 只生成节点
  useEffect(() => {
    if (!tree) { setNodes([]); return }

    const ns: any[] = []
    let yOff = 0

    const buildFromNode = (node: TreeNode, depth: number, xBase: number, yBase: number) => {
      ns.push({
        id: node.id,
        type: 'mindmapNode',
        position: { x: xBase, y: yBase },
        data: { label: node.title || '', depth },
      })

      let childX = 0
      node.children.forEach((child) => {
        buildFromNode(child, depth + 1, xBase + 250, yBase + childX)
        childX += 80
      })
    }

    tree.children.forEach(rootChild => {
      buildFromNode(rootChild, 0, 50, yOff)
      const countDescendants = (n: TreeNode): number =>
        1 + n.children.reduce((s, c) => s + countDescendants(c), 0)
      yOff += countDescendants(rootChild) * 80
    })

    console.log(`[MindMap] ${ns.length} nodes, container ${size.w}x${size.h}`)
    setNodes(ns)
  }, [tree])

  // Save
  useEffect(() => {
    if (!tree) return
    onSave(serializeMarkdown(tree))
  }, [tree, onSave])

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100vh',   // 用 viewport 高度而不是百分比
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* ReactFlow 的包装 div — 用明确的像素尺寸 */}
      <div
        ref={rfWrapperRef}
        style={{
          width: `${size.w}px`,
          height: `${size.h}px`,
          position: 'absolute',
          top: 0,
          left: 0,
        }}
      >
        <ReactFlow
          nodes={nodes}
          edges={[]}
          nodeTypes={nodeTypes}
          fitView
          minZoom={0.05}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
          onInit={(inst) => {
            console.log('[MindMap] RF init OK, size:', size.w, 'x', size.h)
            setTimeout(() => inst?.fitView?.({ padding: 0.3 }), 400)
          }}
          style={{ width: '100%', height: '100%' }}
        >
          <Background color="#e5e7eb" gap={20} size={1} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  )
}
