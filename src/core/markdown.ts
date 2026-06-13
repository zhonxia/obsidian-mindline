import { fromMarkdown } from 'mdast-util-from-markdown'
import type { Root, Content, Heading, Paragraph, Code, List, ListItem, Blockquote, Break } from 'mdast'
import { createNode, addChild } from './tree'
import type { TreeNode } from '../types'

/**
 * Markdown → Document Tree
 *
 * 核心规则：
 *   Heading → TreeNode (kind='heading')
 *   标题内容 → 智能拆分：
 *     - 单段落、单行 → TreeNode.content 内联文本
 *     - 多段落 → 每段一个子节点 (kind='content')
 *     - 列表 → 每项一个子节点 (kind='content')
 *     - 单段多行（有软换行）→ 每行一个子节点 (kind='content')
 *     - 代码块/引用/分隔线 → 序列化到 TreeNode.content
 *
 * 算法：栈式解析，O(n)
 */
export function parseMarkdown(md: string): TreeNode {
  const ast = fromMarkdown(md) as Root
  const root = createNode('__root__')

  const stack: { node: TreeNode; level: number }[] = [{ node: root, level: 0 }]
  let bodyNodes: Content[] = []
  let pendingTarget: TreeNode | null = null

  const flushBody = () => {
    if (!pendingTarget || bodyNodes.length === 0) {
      bodyNodes = []
      pendingTarget = null
      return
    }

    // 分析 bodyNodes 结构，决定是内联还是拆子节点
    const decision = analyzeBody(bodyNodes)

    if (decision.type === 'inline') {
      pendingTarget.content = decision.value
    } else {
      for (const childNode of decision.children) {
        addChild(pendingTarget, childNode)
      }
    }

    bodyNodes = []
    pendingTarget = null
  }

  for (const node of ast.children) {
    if (node.type === 'heading') {
      flushBody()

      const level = (node as Heading).depth
      const title = extractText(node as Heading)
      const newNode = createNode(title, '', null, 0, 'heading')

      // 弹出栈中 level >= 当前 level 的节点
      while (stack.length > 1 && stack[stack.length - 1].level >= level) {
        stack.pop()
      }

      const parent = stack[stack.length - 1].node
      addChild(parent, newNode)
      pendingTarget = newNode
      stack.push({ node: newNode, level })
    } else {
      bodyNodes.push(node as Content)
    }
  }

  flushBody()

  return root
}

/**
 * 分析 body 内容，返回"内联"或"子节点数组"
 */
type BodyDecision =
  | { type: 'inline'; value: string }
  | { type: 'children'; children: TreeNode[] }

function analyzeBody(nodes: Content[]): BodyDecision {
  if (nodes.length === 0) return { type: 'inline', value: '' }

  // 如果包含非文本内容（代码块、引用、分隔线），全部序列化为 content
  const hasComplex = nodes.some(n =>
    n.type === 'code' || n.type === 'blockquote' || n.type === 'thematicBreak' || n.type === 'table'
  )
  if (hasComplex) {
    return { type: 'inline', value: serializeBody(nodes) }
  }

  // 列表 → 每一项拆为子节点
  if (nodes.length === 1 && nodes[0].type === 'list') {
    const list = nodes[0] as List
    const children: TreeNode[] = []
    for (const item of (list.children || []) as ListItem[]) {
      const text = extractListItemText(item)
      if (text) {
        children.push(createNode(text, '', null, 0, 'content'))
      }
    }
    if (children.length > 0) return { type: 'children', children }
    return { type: 'inline', value: '' }
  }

  // 多个段落 → 每段拆为子节点
  if (nodes.length > 1) {
    const children: TreeNode[] = []
    for (const n of nodes) {
      if (n.type === 'paragraph') {
        const text = extractParagraphText(n as Paragraph)
        if (text) children.push(createNode(text, '', null, 0, 'content'))
      }
      // 跳过非段落内容（已在 hasComplex 处理）
    }
    if (children.length > 0) return { type: 'children', children }
    return { type: 'inline', value: serializeBody(nodes) }
  }

  // 单个段落 → 检查是否多行（按 \n 分割）
  if (nodes.length === 1 && nodes[0].type === 'paragraph') {
    const para = nodes[0] as Paragraph
    // 先用 soft break 分割
    let lines = splitBySoftBreaks(para)
    // 如果 soft break 只有 1 行，再按 \n 分割（无换行的纯文本）
    if (lines.length <= 1) {
      const rawText = extractParagraphText(para)
      const newlineLines = rawText.split('\n').map(s => s.trim()).filter(s => s.length > 0)
      if (newlineLines.length > 1) {
        lines = newlineLines
      }
    }
    if (lines.length > 1) {
      const children = lines.map(line => createNode(line, '', null, 0, 'content'))
      return { type: 'children', children }
    }
    // 单行 → 内联文本
    const text = extractParagraphText(para)
    return { type: 'inline', value: text }
  }

  // fallback
  return { type: 'inline', value: serializeBody(nodes) }
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

/** 提取列表项的纯文本 */
function extractListItemText(item: ListItem): string {
  const firstChild = item.children?.[0]
  if (!firstChild) return ''
  if (firstChild.type === 'paragraph') {
    return extractParagraphText(firstChild as Paragraph)
  }
  return ''
}

/**
 * Document Tree → Markdown
 *
 * 规则：
 *   kind='heading' (默认) → # 标题
 *   kind='content' → 纯文本行（不加 #）
 *   content 字段 → 在标题后的空行输出
 */
export function serializeMarkdown(root: TreeNode): string {
  const lines: string[] = []

  // 返回：最后一个输出的节点是否是 content 类型
  const walkChildren = (children: TreeNode[], depth: number): boolean => {
    let prevWasContent = false

    for (const node of children) {
      if (node.kind === 'content') {
        lines.push(node.title)
        prevWasContent = true
      } else {
        if (prevWasContent) {
          lines.push('')
        }
        const prefix = '#'.repeat(depth)
        lines.push(`${prefix} ${node.title}`)
        if (node.content && node.content.trim()) {
          lines.push('', node.content)
        }
        lines.push('')
        prevWasContent = false
      }

      if (node.children.length > 0 && node.kind !== 'content') {
        // 递归处理子节点，子节点的 prevWasContent 可能影响外层
        const childEndsWithContent = walkChildren(node.children, depth + 1)
        if (childEndsWithContent) {
          prevWasContent = true
        }
      }
    }

    return prevWasContent
  }

  walkChildren(root.children, 1)

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n'
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
