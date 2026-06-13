import { fromMarkdown } from 'mdast-util-from-markdown'
import type { Root, Content, Heading, Paragraph, Code, List, ListItem, Blockquote, Break } from 'mdast'
import { createNode, addChild } from './tree'
import type { TreeNode } from '../types'

/**
 * Markdown → Document Tree
 *
 * 核心规则：
 *   - 内部统一展示为可编辑节点。
 *   - 保存时保留 Markdown 原生语义：heading / paragraph / list item。
 *   - Markdown 标题仍保存为 # / ##，不会强制改成列表。
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
      const title = extractText(node as Heading)
      const newNode = createNode(title, '', null, 0, undefined, 'heading', level as TreeNode['headingLevel'])

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
        addChild(currentParent, createNode(line, '', null, 0, undefined, 'paragraph'))
      }
    } else {
      const text = serializeNode(node as Content)
      if (text) addChild(currentParent, createNode(text, '', null, 0, undefined, node.type as TreeNode['sourceType']))
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
        extraNodes.push(createNode(text, '', null, 0, undefined, 'paragraph'))
      }
    } else if (child.type === 'list') {
      nestedLists.push(child as List)
    } else if (child.type === 'heading') {
      const h = child as Heading
      const text = `${'#'.repeat(h.depth)} ${extractText(h)}`.trim()
      if (!title) {
        title = text
      } else {
        extraNodes.push(createNode(text, '', null, 0, undefined, 'heading', h.depth as TreeNode['headingLevel']))
      }
    } else {
      const text = serializeNode(child as Content)
      if (!title) {
        title = text
      } else if (text) {
        extraNodes.push(createNode(text, '', null, 0, undefined, child.type as TreeNode['sourceType']))
      }
    }
  }

  if (!title && nestedLists.length === 0 && extraNodes.length === 0) return null

  const node = createNode(title || '(empty)', '', null, 0, undefined, 'listItem')
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
 *   保留 Markdown 原生语义。
 *   heading 写回 # / ##，paragraph 写回正文，listItem 写回列表。
 */
export function serializeMarkdown(root: TreeNode): string {
  const lines: string[] = []

  const walkChildren = (children: TreeNode[], depth: number, context: 'root' | 'heading' | 'list'): void => {
    for (const node of children) {
      serializeTreeNode(node, lines, depth, context)
    }
  }

  walkChildren(root.children, 0, 'root')

  const md = lines.join('\n').trim()
  return md ? md + '\n' : ''
}

function serializeTreeNode(
  node: TreeNode,
  lines: string[],
  depth: number,
  context: 'root' | 'heading' | 'list',
): void {
  const title = normalizeOutlineLine(node.title)
  const sourceType = inferSourceType(node, context)

  if (sourceType === 'heading') {
    if (lines.length > 0 && lines[lines.length - 1] !== '') lines.push('')
    const marker = parseHeadingMarker(title)
    const level = clampHeadingLevel(node.headingLevel ?? marker.level ?? Math.max(1, depth + 1))
    lines.push(`${'#'.repeat(level)} ${marker.label}`)
    if (node.content && node.content.trim()) {
      lines.push('', node.content.trim())
    }
    if (node.children.length > 0) {
      lines.push('')
      for (const child of node.children) serializeTreeNode(child, lines, depth + 1, 'heading')
    }
    return
  }

  if (sourceType === 'listItem') {
    const indent = '  '.repeat(Math.max(0, depth))
    lines.push(`${indent}- ${title}`)
    for (const child of node.children) serializeTreeNode(child, lines, depth + 1, 'list')
    return
  }

  if (sourceType === 'code' || sourceType === 'blockquote' || sourceType === 'thematicBreak') {
    if (lines.length > 0 && lines[lines.length - 1] !== '') lines.push('')
    lines.push(title)
    if (node.children.length > 0) {
      lines.push('')
      for (const child of node.children) serializeTreeNode(child, lines, depth, 'heading')
    }
    return
  }

  if (lines.length > 0 && lines[lines.length - 1] !== '') lines.push('')
  lines.push(title)
  if (node.children.length > 0) {
    lines.push('')
    for (const child of node.children) serializeTreeNode(child, lines, depth, 'heading')
  }
}

function inferSourceType(node: TreeNode, context: 'root' | 'heading' | 'list'): NonNullable<TreeNode['sourceType']> {
  if (node.sourceType) return node.sourceType
  if (node.headingLevel) return 'heading'
  if (/^#{1,6}\s+/.test(node.title)) return 'heading'
  if (context === 'list') return 'listItem'
  return 'paragraph'
}

function parseHeadingMarker(text: string): { level: number | null; label: string } {
  const match = text.match(/^(#{1,6})\s+(.+)$/)
  if (!match) return { level: null, label: text }
  return { level: match[1].length, label: match[2] }
}

function clampHeadingLevel(level: number): 1 | 2 | 3 | 4 | 5 | 6 {
  return Math.min(6, Math.max(1, level)) as 1 | 2 | 3 | 4 | 5 | 6
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
