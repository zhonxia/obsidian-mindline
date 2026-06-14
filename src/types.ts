export interface TreeNode {
  id: string
  viewKey?: string
  title: string
  content: string
  children: TreeNode[]
  parentId: string | null
  collapsed: boolean
  depth: number
  sourceType?: 'heading' | 'paragraph' | 'listItem' | 'code' | 'blockquote' | 'thematicBreak'
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6
  /** 旧数据兼容字段；新模型中节点统一视为大纲项 */
  kind?: 'heading' | 'content'
  createdAt: number
  updatedAt: number
}

export interface Document {
  id: string
  path: string
  root: TreeNode
  modified: boolean
}

export interface MindmapViewportState {
  x: number
  y: number
}

export interface MindmapFileViewState {
  pan?: MindmapViewportState
  zoom?: number
  collapsedKeys?: string[]
  selectedNodeKey?: string | null
}

export interface MindmapPluginData {
  fileStates: Record<string, MindmapFileViewState>
}

export interface MindmapViewStateStore {
  getFileViewState(filePath: string): MindmapFileViewState
  updateFileViewState(filePath: string, patch: Partial<MindmapFileViewState>): void
}
