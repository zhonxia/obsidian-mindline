import { Plugin, WorkspaceLeaf } from 'obsidian'
import { MindmapView, VIEW_TYPE_MINDMAP } from './view/MindmapView'

export default class MindMapPlugin extends Plugin {
  async onload() {
    try {
      console.log('[MindMap] Plugin loading...')

      // Register view type
      this.registerView(VIEW_TYPE_MINDMAP, (leaf) => new MindmapView(leaf))

      // ── Ribbon Icon: 左下角图标，点击切换脑图/Markdown ──
      // 使用 'brain-circuit' 或 fallback 到 'file-text'（兼容旧版 Obsidian）
      const iconNames = ['brain', 'brain-circuit', 'git-branch', 'file-text']
      for (const icon of iconNames) {
        try {
          this.addRibbonIcon(icon, 'Toggle MindMap View', () => {
            this.toggleMindMapView()
          })
          console.log('[MindMap] Ribbon icon added:', icon)
          break
        } catch (e) {
          // Icon not supported, try next
          console.log('[MindMap] Icon', icon, 'not available, trying next...')
        }
      }

      // ── Commands ──
      this.addCommand({
        id: 'toggle-mindmap-view',
        name: 'Toggle MindMap View',
        callback: () => {
          this.toggleMindMapView()
        },
      })

      // Status bar item as backup
      const statusBarItem = this.addStatusBarItem()
      statusBarItem.setText('🧠')
      statusBarItem.title = 'Toggle MindMap View'
      statusBarItem.style.cursor = 'pointer'
      statusBarItem.onClickEvent(() => {
        this.toggleMindMapView()
      })

      console.log('[MindMap] Plugin loaded successfully!')
    } catch (err) {
      console.error('[MindMap] FATAL ERROR during onload:', err)
    }
  }

  async onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_MINDMAP)
  }

  /**
   * 核心切换逻辑：
   * - 当前是 Markdown → 切成脑图（同一位置）
   * - 当前是脑图 → 先保存，再切回 Markdown
   */
  async toggleMindMapView() {
    const activeFile = this.app.workspace.getActiveFile()
    const activeLeaf = this.app.workspace.activeLeaf

    if (!activeFile || !activeLeaf) return

    const viewType = activeLeaf.view.getViewType()

    // 脑图 → Markdown：先保存再切换
    if (viewType === VIEW_TYPE_MINDMAP) {
      const view = activeLeaf.view as MindmapView
      await view.saveCurrentTree()

      await activeLeaf.setViewState({
        type: 'markdown',
        state: { file: activeFile.path, mode: 'source' },
        active: true,
      })
      return
    }

    // Markdown → 脑图：直接切换
    await activeLeaf.setViewState({
      type: VIEW_TYPE_MINDMAP,
      state: { file: activeFile.path },
      active: true,
    })
  }
}
