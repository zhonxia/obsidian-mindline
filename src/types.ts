export interface TreeNode {
  id: string
  title: string
  content: string
  children: TreeNode[]
  parentId: string | null
  collapsed: boolean
  depth: number
  createdAt: number
  updatedAt: number
}

export interface Document {
  id: string
  path: string
  root: TreeNode
  modified: boolean
}
