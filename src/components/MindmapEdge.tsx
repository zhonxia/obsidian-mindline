import type { EdgeProps } from '@xyflow/react'
import { BaseEdge, getBezierPath } from '@xyflow/react'
import type { TreeNode } from '../../types'

interface MindmapEdgeData {
  // No custom data needed for now
}

export function MindmapEdge({ id, sourceX, sourceY, targetX, targetY }: EdgeProps) {
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition: 'right' as const,
    targetPosition: 'left' as const,
    curvature: 0.15,
  })

  return (
    <BaseEdge
      id={id}
      path={edgePath}
      style={{ stroke: 'var(--background-modifier-border, #c9d1d9)', strokeWidth: 1 }}
    />
  )
}
