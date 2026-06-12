import { fromMarkdown } from 'mdast-util-from-markdown'
import { toMarkdown } from 'mdast-util-to-markdown'
import type { Root, Content, Heading, Paragraph, Code, List, Blockquote } from 'mdast'
import { createNode, addChild } from './tree'
import type { TreeNode } from '../types'

/**
 * Markdown → Document Tree
 *
 * 核心规则：
 *   Heading = Node.title
 *   Heading 之间的所有内容 = Node.body（原样保留，包括代码块、列表、段落）
 *   Heading level = 树层级
 *
 * 算法：栈式解析，O(n)
 */
export function parseMarkdown(md: string): TreeNode {
  const ast = fromMarkdown(md) as Root
  const root = createNode('__root__')

  // 栈：追踪当前层级路径
  const stack: { node: TreeNode; level: number }[] = [{ node: root, level: 0 }]
  let currentNode: TreeNode | null = null
  let bodyNodes: Content[] = []

  const flushBody = () => {
    if (currentNode && bodyNodes.length > 0) {
      currentNode.content = serializeBody(bodyNodes)
      bodyNodes = []
    }
  }

  for (const node of ast.children) {
    if (node.type === 'heading') {
      // 先把之前累积的 body 写入上一个节点
      flushBody()

      const level = (node as Heading).depth
      const title = extractText(node as Heading)
      const newNode = createNode(title)

      // 弹出栈中 level >= 当前 level 的节点
      while (stack.length > 1 && stack[stack.length - 1].level >= level) {
        stack.pop()
      }

      // 挂到栈顶节点下面
      const parent = stack[stack.length - 1].node
      addChild(parent, newNode)
      currentNode = newNode
      stack.push({ node: newNode, level })
    } else {
      // 非 heading 内容 → 累积到 body
      bodyNodes.push(node as Content)
    }
  }

  // 最后一个节点的 body
  flushBody()

  return root
}

/**
 * Document Tree → Markdown
 *
 * 规则：
 *   depth 1 → #
 *   depth 2 → ##
 *   depth 3 → ###
 *   body → 原样输出
 *
 * 不保留原格式，重新序列化。
 */
export function serializeMarkdown(root: TreeNode): string {
  const lines: string[] = []

  const walk = (node: TreeNode, depth: number) => {
    if (depth === 0) {
      // root 节点，跳过
    } else {
      const prefix = '#'.repeat(depth)
      lines.push(`${prefix} ${node.title}`)
      if (node.content && node.content.trim()) {
        lines.push('', node.content)
      }
      lines.push('')
    }
    // collapsed 是纯视图状态，序列化必须无视它
    node.children.forEach(c => walk(c, depth + 1))
  }

  root.children.forEach(c => walk(c, 1))

  // 清理多余空行
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
 * 这是 body 内容的序列化器
 */
function serializeBody(nodes: Content[]): string {
  return nodes.map(n => serializeNode(n)).join('\n').trim()
}

function serializeNode(node: Content): string {
  switch (node.type) {
    case 'paragraph':
      return (node as Paragraph).children.map((c: any) => {
        if ('value' in c) return c.value
        if (c.type === 'strong') return `**${serializeInline(c.children)}**`
        if (c.type === 'emphasis') return `*${serializeInline(c.children)}*`
        if (c.type === 'inlineCode') return `\`${c.value}\``
        if (c.type === 'link') return `[${serializeInline(c.children)}](${c.url})`
        if (c.type === 'image') return `![${c.alt}](${c.url})`
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

    default:
      return ''
  }
}

function serializeInline(children: any[]): string {
  return children.map(c => {
    if ('value' in c) return c.value
    if (c.type === 'inlineCode') return `\`${c.value}\``
    return ''
  }).join('')
}
