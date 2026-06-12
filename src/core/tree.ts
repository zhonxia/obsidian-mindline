import { nanoid } from 'nanoid'
import type { TreeNode } from '../types'

export function createNode(title: string, content: string = '', parentId: string | null = null, depth: number = 0): TreeNode {
  return {
    id: nanoid(10),
    title,
    content,
    children: [],
    parentId,
    collapsed: false,
    depth,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

export function addChild(parent: TreeNode, child: TreeNode): void {
  child.parentId = parent.id
  parent.children.push(child)
}

export function addSibling(parent: TreeNode, refNode: TreeNode, newChild: TreeNode): void {
  const idx = parent.children.indexOf(refNode)
  newChild.parentId = parent.id
  parent.children.splice(idx + 1, 0, newChild)
}

export function removeNode(parent: TreeNode, node: TreeNode): void {
  const idx = parent.children.indexOf(node)
  if (idx >= 0) parent.children.splice(idx, 1)
}

export function moveNode(oldParent: TreeNode, newParent: TreeNode, node: TreeNode, index: number): void {
  removeNode(oldParent, node)
  node.parentId = newParent.id
  newParent.children.splice(index, 0, node)
}

export function flatten(root: TreeNode): TreeNode[] {
  const result: TreeNode[] = []
  const walk = (node: TreeNode, depth: number) => {
    node.depth = depth
    result.push(node)
    if (!node.collapsed) node.children.forEach(c => walk(c, depth + 1))
  }
  root.children.forEach(c => walk(c, 0))
  return result
}

export function findById(root: TreeNode, id: string): TreeNode | null {
  if (root.id === id) return root
  for (const child of root.children) {
    const found = findById(child, id)
    if (found) return found
  }
  return null
}

export function findParent(root: TreeNode, id: string): TreeNode | null {
  for (const child of root.children) {
    if (child.id === id) return root
    const found = findParent(child, id)
    if (found) return found
  }
  return null
}

export function getDepth(root: TreeNode, id: string): number {
  let depth = 0
  const walk = (node: TreeNode, d: number): boolean => {
    if (node.id === id) { depth = d; return true }
    for (const c of node.children) { if (walk(c, d + 1)) return true }
    return false
  }
  walk(root, 0)
  return depth
}

export function countAll(root: TreeNode): number {
  let n = 0
  const walk = (node: TreeNode) => { n++; node.children.forEach(walk) }
  walk(root)
  return n
}
