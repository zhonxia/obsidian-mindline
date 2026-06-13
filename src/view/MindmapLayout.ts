import type { TreeNode } from '../types'

export const LEVEL_X = 320
export const SIBLING_GAP = 36
export const TREE_GAP = 64
export const NODE_W = 260
export const NODE_H = 34
export const PADDING = 48

export interface LayoutNode {
  data: TreeNode
  depth: number
  nodeH: number
  subtreeH: number
  children: LayoutNode[]
}

export interface MindmapRenderNode {
  id: string
  label: string
  content: string
  depth: number
  childCount: number
  collapsed: boolean
  kind?: 'heading' | 'content'
  sourceType?: TreeNode['sourceType']
  headingLevel?: TreeNode['headingLevel']
  nodeH?: number
  x: number
  y: number
}

export interface MindmapRenderEdge {
  id: string
  source: MindmapRenderNode
  target: MindmapRenderNode
}

export type DropPosition = 'before' | 'inside' | 'after'

export interface DropTarget {
  nodeId: string
  position: DropPosition
}

/** 从 TreeNode 树计算画布布局 */
export function buildGraphFromTree(rootTree: TreeNode): {
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

export function measureSubtree(node: TreeNode, depth: number): LayoutNode {
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

export function placeSubtree(
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
    sourceType: data.sourceType,
    headingLevel: data.headingLevel,
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

/** 估算节点实际渲染高度（含标题换行和内容行） */
export function estimateNodeHeight(node: TreeNode): number {
  const titleUnitsPerLine = 18
  const titleLines = countWrappedLines(node.title || '(empty)', titleUnitsPerLine)

  let h = 12 + titleLines * 17
  if (node.content && node.content.trim()) {
    const contentLines = node.content.split('\n').reduce((total, line) => {
      return total + countWrappedLines(line, 22)
    }, 0)
    h += 4 + contentLines * 16
  }
  return Math.max(NODE_H, Math.ceil(h))
}

export function countWrappedLines(text: string, unitsPerLine: number): number {
  const lines = text.split('\n')
  return lines.reduce((total, line) => {
    const visualUnits = Math.max(1, estimateTextUnits(line.trim()))
    return total + Math.max(1, Math.ceil(visualUnits / unitsPerLine))
  }, 0)
}

export function estimateTextUnits(text: string): number {
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

export function parseHeadingMarker(text: string, headingLevel?: TreeNode['headingLevel']): { level: number | null; label: string } {
  if (headingLevel) return { level: headingLevel, label: text }
  const match = text.match(/^(#{1,6})\s+(.+)$/)
  if (!match) return { level: null, label: text }
  return { level: match[1].length, label: match[2] }
}

/** 渲染标题中的基本 Markdown 内联语法（**粗体** *斜体* `代码` ~~删除线~~） */
export function renderInlineMarkdown(text: string): string {
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>')
  html = html.replace(/`(.+?)`/g, '<code>$1</code>')
  html = html.replace(/~~(.+?)~~/g, '<del>$1</del>')
  return html
}
