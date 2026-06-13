export interface TreeNode {
  id: string
  title: string
  content: string
  children: TreeNode[]
  parentId: string | null
  collapsed: boolean
  depth: number
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
