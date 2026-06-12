import type { NodeProps } from '@xyflow/react'
import { Handle, Position } from '@xyflow/react'
import { useState, useCallback, useEffect, useRef } from 'react'
import type { TreeNode } from '../../types'

interface MindmapNodeData {
  id: string
  label: string
  depth: number
  isActive: boolean
  collapsed: boolean
  childCount: number
  preview: string
  shouldEdit: boolean
  onToggleCollapse: (id: string) => void
  onSetFocused: (id: string) => void
  onUpdateTitle: (id: string, title: string) => void
}

export function MindmapNode({ data }: NodeProps) {
  const nodeData = data as unknown as MindmapNodeData
  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const hasChildren = nodeData.childCount > 0

  // Auto-enter edit mode when shouldEdit flag is set
  useEffect(() => {
    if (nodeData.shouldEdit) {
      setEditTitle(nodeData.label)
      setEditing(true)
      setTimeout(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      }, 60)
    }
  }, [nodeData.shouldEdit])

  const startEdit = useCallback(() => {
    setEditTitle(nodeData.label)
    setEditing(true)
    setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 50)
  }, [nodeData.label])

  const commitEdit = useCallback(() => {
    const t = editTitle.trim()
    if (t && t !== nodeData.label) {
      nodeData.onUpdateTitle(nodeData.id, t)
    }
    setEditing(false)
  }, [editTitle, nodeData.id, nodeData.label, nodeData.onUpdateTitle])

  const cancelEdit = useCallback(() => setEditing(false), [])

  const handleToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    nodeData.onToggleCollapse(nodeData.id)
  }, [nodeData.id, nodeData.onToggleCollapse])

  const [hover, setHover] = useState(false)

  return (
    <div
      className={`mm-node${nodeData.isActive ? ' active' : ''}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onDoubleClick={startEdit}
    >
      <Handle type="target" position={Position.Left} style={{ visibility: 'hidden' }} />
      <Handle type="source" position={Position.Right} style={{ visibility: 'hidden' }} />

      {editing ? (
        <input
          ref={inputRef}
          className="mm-edit-input"
          value={editTitle}
          onChange={e => setEditTitle(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); commitEdit() }
            if (e.key === 'Escape') { e.preventDefault(); cancelEdit() }
            e.stopPropagation()
          }}
          onBlur={commitEdit}
        />
      ) : (
        <div className="mm-content">
          {hover && hasChildren && (
            <span
              className="mm-toggle-btn"
              onClick={handleToggle}
              title={nodeData.collapsed ? '展开' : '折叠'}
            >
              {nodeData.collapsed ? '+' : '−'}
            </span>
          )}

          <span
            className={`mm-dot ${hasChildren ? (nodeData.collapsed ? 'collapsed' : 'expanded') : 'leaf'}`}
            onClick={() => nodeData.onSetFocused(nodeData.id)}
          >
            {hasChildren ? (nodeData.collapsed ? '▸' : '▾') : ''}
          </span>

          <span className="mm-title">{nodeData.label || 'untitled'}</span>

          {nodeData.collapsed && hasChildren && (
            <span className="mm-badge">{nodeData.childCount}</span>
          )}
        </div>
      )}
    </div>
  )
}
