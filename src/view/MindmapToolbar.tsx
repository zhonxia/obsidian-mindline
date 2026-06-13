import React from 'react'

interface Props {
  zoom: number
  onZoomIn: () => void
  onZoomOut: () => void
  onFitToView: () => void
}

export default function MindmapToolbar({ zoom, onZoomIn, onZoomOut, onFitToView }: Props) {
  return (
    <div className="mindmap-toolbar">
      <button className="mindmap-toolbar-btn" onClick={onZoomIn} title="放大">+</button>
      <span className="mindmap-toolbar-label">{Math.round(zoom * 100)}%</span>
      <button className="mindmap-toolbar-btn" onClick={onZoomOut} title="缩小">−</button>
      <button className="mindmap-toolbar-btn" onClick={onFitToView} title="适应画布">⊡</button>
    </div>
  )
}
