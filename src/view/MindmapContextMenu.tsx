import React from 'react'

interface Props {
  x: number
  y: number
  nodeId: string
  canDelete: boolean
  onAddChild: (nodeId: string) => void
  onAddSibling: (nodeId: string) => void
  onDelete: (nodeId: string) => void
}

export default function MindmapContextMenu({ x, y, nodeId, canDelete, onAddChild, onAddSibling, onDelete }: Props) {
  return (
    <div
      className="mindmap-context-menu"
      style={{ position: 'fixed', left: x, top: y }}
      onMouseDown={e => e.stopPropagation()}
    >
      <div className="mindmap-context-item" onClick={() => onAddChild(nodeId)}>
        ➕ 添加子节点
      </div>
      <div className="mindmap-context-item" onClick={() => onAddSibling(nodeId)}>
        ⬆ 添加同级节点
      </div>
      {canDelete && (
        <div className="mindmap-context-item danger" onClick={() => onDelete(nodeId)}>
          🗑 删除节点
        </div>
      )}
    </div>
  )
}
