export interface TreeNode {
  id: string
  title: string
  content: string
  children: TreeNode[]
  parentId: string | null
  collapsed: boolean
  depth: number
  /** 节点来源：heading = 标题创建的节点；content = 从标题内容拆出的文本节点 */
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
