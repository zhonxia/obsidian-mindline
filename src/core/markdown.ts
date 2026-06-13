import { fromMarkdown } from 'mdast-util-from-markdown'
import type { Root, Content, Heading, Paragraph, Code, List, ListItem, Blockquote, Break } from 'mdast'
import { createNode, addChild } from './tree'
import type { TreeNode } from '../types'

/**
 * Markdown → Document Tree
 *
 * 核心规则：
 *   - 内部统一使用幕布式大纲节点，所有节点都可以有子节点。
 *   - Markdown 标题会转为带 "# " 前缀的节点文本，用于显示 H1/H2 样式。
 *   - Markdown 列表会保留为大纲层级。
 *   - 普通段落和复杂块会作为当前节点下的普通大纲项。
 *
 * 算法：栈式解析，O(n)
 */
export function parseMarkdown(md: string): TreeNode {
  const ast = fromMarkdown(md) as Root
  const root = createNode('__root__')

  const headingStack: { node: TreeNode; level: number }[] = [{ node: root, level: 0 }]
  let currentParent: TreeNode = root

  for (const node of ast.children) {
    if (node.type === 'heading') {
      const level = (node as Heading).depth
      const title = `${'#'.repeat(level)} ${extractText(node as Heading)}`.trim()
      const newNode = createNode(title)

      while (headingStack.length > 1 && headingStack[headingStack.length - 1].level >= level) {
        headingStack.pop()
      }

      const parent = headingStack[headingStack.length - 1].node
      addChild(parent, newNode)
      headingStack.push({ node: newNode, level })
      currentParent = newNode
    } else if (node.type === 'list') {
      appendList(currentParent, node as List)
    } else if (node.type === 'paragraph') {
      for (const line of paragraphToOutlineLines(node as Paragraph)) {
        addChild(currentParent, createNode(line))
      }
    } else {
      const text = serializeNode(node as Content)
      if (text) addChild(currentParent, createNode(text))
    }
  }

  updateDepths(root, -1)

  return root
}

function appendList(parent: TreeNode, list: List): void {
  for (const item of (list.children || []) as ListItem[]) {
    const node = listItemToNode(item)
    if (node) addChild(parent, node)
  }
}

function listItemToNode(item: ListItem): TreeNode | null {
  let title = ''
  const nestedLists: List[] = []
  const extraNodes: TreeNode[] = []

  for (const child of item.children || []) {
    if (child.type === 'paragraph') {
      const text = extractParagraphText(child as Paragraph)
      if (!title) {
        title = text
      } else if (text) {
        extraNodes.push(createNode(text))
      }
    } else if (child.type === 'list') {
      nestedLists.push(child as List)
    } else if (child.type === 'heading') {
      const h = child as Heading
      const text = `${'#'.repeat(h.depth)} ${extractText(h)}`.trim()
      if (!title) {
        title = text
      } else {
        extraNodes.push(createNode(text))
      }
    } else {
      const text = serializeNode(child as Content)
      if (!title) {
        title = text
      } else if (text) {
        extraNodes.push(createNode(text))
      }
    }
  }

  if (!title && nestedLists.length === 0 && extraNodes.length === 0) return null

  const node = createNode(title || '(empty)')
  for (const extra of extraNodes) addChild(node, extra)
  for (const nested of nestedLists) appendList(node, nested)
  return node
}

function paragraphToOutlineLines(para: Paragraph): string[] {
  const byBreak = splitBySoftBreaks(para)
  if (byBreak.length > 1) return byBreak

  const text = extractParagraphText(para)
  return text.split('\n').map(line => line.trim()).filter(Boolean)
}

function updateDepths(node: TreeNode, depth: number): void {
  node.depth = depth
  for (const child of node.children) updateDepths(child, depth + 1)
}

/** 提取段落纯文本 */
function extractParagraphText(para: Paragraph): string {
  return para.children
    .filter(c => c.type !== 'break')
    .map(c => {
      if (c.type === 'inlineCode') return `\`${(c as any).value}\``
      if (c.type === 'strong') return `**${inlineChildrenText((c as any).children)}**`
      if (c.type === 'emphasis') return `*${inlineChildrenText((c as any).children)}*`
      if (c.type === 'link') return `[${inlineChildrenText((c as any).children)}](${(c as any).url})`
      if (c.type === 'image') return `![${(c as any).alt}](${(c as any).url})`
      if (c.type === 'delete') return `~~${inlineChildrenText((c as any).children)}~~`
      if ('value' in c) return c.value as string
      return ''
    })
    .join('')
    .trim()
}

/** 按软换行（Break 节点）分割段落 */
function splitBySoftBreaks(para: Paragraph): string[] {
  const lines: string[] = []
  let currentLine = ''

  for (const child of para.children) {
    if (child.type === 'break') {
      if (currentLine.trim()) {
        lines.push(currentLine.trim())
      }
      currentLine = ''
    } else if (child.type === 'inlineCode') {
      currentLine += `\`${(child as any).value}\``
    } else if (child.type === 'strong') {
      currentLine += `**${inlineChildrenText((child as any).children)}**`
    } else if (child.type === 'emphasis') {
      currentLine += `*${inlineChildrenText((child as any).children)}*`
    } else if (child.type === 'link') {
      currentLine += `[${inlineChildrenText((child as any).children)}](${(child as any).url})`
    } else if (child.type === 'image') {
      currentLine += `![${(child as any).alt}](${(child as any).url})`
    } else if (child.type === 'delete') {
      currentLine += `~~${inlineChildrenText((child as any).children)}~~`
    } else if ('value' in child) {
      currentLine += (child as any).value
    }
  }

  if (currentLine.trim()) {
    lines.push(currentLine.trim())
  }

  return lines
}

function inlineChildrenText(children: any[]): string {
  return children.map((c: any) => {
    if ('value' in c) return c.value
    if (c.type === 'inlineCode') return `\`${c.value}\``
    return ''
  }).join('')
}

/**
 * Document Tree → Markdown
 *
 * 规则：
 *   内部统一按幕布式大纲节点保存。
 *   如果想显示 Markdown 标题样式，直接把 "# " / "## " 写进节点标题。
 */
export function serializeMarkdown(root: TreeNode): string {
  const lines: string[] = []

  const walkChildren = (children: TreeNode[], depth: number): void => {
    const indent = '  '.repeat(depth)
    for (const node of children) {
      const title = normalizeOutlineLine(node.title)
      lines.push(`${indent}- ${title}`)
      if (node.content && node.content.trim()) {
        for (const line of node.content.split('\n').map(s => s.trim()).filter(Boolean)) {
          lines.push(`${indent}  - ${line}`)
        }
      }
      if (node.children.length > 0) walkChildren(node.children, depth + 1)
    }
  }

  walkChildren(root.children, 0)

  const md = lines.join('\n').trim()
  return md ? md + '\n' : ''
}

function normalizeOutlineLine(text: string): string {
  const oneLine = (text || '').replace(/\s*\n\s*/g, ' ').trim()
  return oneLine || '(empty)'
}

/* ── 内部工具 ──────────────────────────────────── */

function extractText(heading: Heading): string {
  return heading.children
    .map(c => {
      if ('value' in c) return c.value
      if ('children' in c) return (c as any).children.map((x: any) => x.value || '').join('')
      return ''
    })
    .join('')
    .trim()
}

/**
 * 把 AST 节点数组序列化回 Markdown 字符串
 * 用于 hasComplex 时的 fallback
 */
function serializeBody(nodes: Content[]): string {
  return nodes.map(n => serializeNode(n)).join('\n').trim()
}

function serializeNode(node: Content): string {
  switch (node.type) {
    case 'paragraph':
      return (node as Paragraph).children.map(c => {
        if (c.type === 'inlineCode') return `\`${(c as any).value}\``
        if (c.type === 'break') return '\n'
        if (c.type === 'strong') return `**${inlineChildrenText((c as any).children)}**`
        if (c.type === 'emphasis') return `*${inlineChildrenText((c as any).children)}*`
        if (c.type === 'link') return `[${inlineChildrenText((c as any).children)}](${(c as any).url})`
        if (c.type === 'image') return `![${(c as any).alt}](${(c as any).url})`
        if (c.type === 'delete') return `~~${inlineChildrenText((c as any).children)}~~`
        if ('value' in c) return c.value as string
        return ''
      }).join('')

    case 'code': {
      const c = node as Code
      const lang = c.lang || ''
      return '```' + lang + '\n' + c.value + '\n```'
    }

    case 'list': {
      const l = node as any
      return (l.children || []).map((item: any, i: number) => {
        const text = (item.children || []).map((c: any) => {
          if (c.type === 'paragraph') return serializeNode(c as Content)
          if (c.type === 'list') return serializeNode(c as Content)
          return ''
        }).join('\n')
        const prefix = l.ordered ? `${(l.start ?? 1) + i}. ` : '- '
        return prefix + text
      }).join('\n')
    }

    case 'blockquote':
      return (node as Blockquote).children
        .map(c => '> ' + serializeNode(c as Content))
        .join('\n')

    case 'thematicBreak':
      return '---'

    case 'heading': {
      const h = node as Heading
      return '#'.repeat(h.depth) + ' ' + extractText(h)
    }

    case 'table':
      return serializeBody(((node as any).children || []) as Content[])

    default:
      return ''
  }
}
