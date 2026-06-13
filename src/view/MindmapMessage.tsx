import React from 'react'

interface Props {
  title: string
  detail?: string
}

export default function MindmapMessage({ title, detail }: Props) {
  return (
    <div className="mindmap-message">
      <div className="mindmap-message-card">
        <div className="mindmap-message-title">{title}</div>
        {detail && <div className="mindmap-message-detail">{detail}</div>}
      </div>
    </div>
  )
}
