import { Plugin, Notice, WorkspaceLeaf } from 'obsidian'
import { MindmapView, VIEW_TYPE_MINDMAP } from './view/MindmapView'
import type { MindmapFileViewState, MindmapPluginData, MindmapViewStateStore } from './types'

const DEFAULT_DATA: MindmapPluginData = {
  fileStates: {},
}

export default class MindMapPlugin extends Plugin implements MindmapViewStateStore {
  // 始终记住最后打开的文件路径（通过事件监听，不依赖 getActiveFile）
  private lastFilePath: string | null = null
  private data: MindmapPluginData = DEFAULT_DATA
  private saveDataTimer: number = 0

  async onload() {
    console.log('[MindMap] Plugin loading...')
    this.data = this.normalizeData(await this.loadData())

    // ── 核心事件：追踪当前文件 ──
    // 这是唯一可靠的方式获取"用户正在看哪个文件"
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => {
      const af = this.app.workspace.getActiveFile()
      if (af) {
        this.lastFilePath = af.path
        console.log('[MindMap] tracked file:', af.path)
      }
    }))
    
    // 也监听 file-open 作为备份（用 workspace，不用 vault）
    this.registerEvent(this.app.workspace.on('file-open', (file) => {
      if (file) this.lastFilePath = file.path
    }))

    // Register view type
    this.registerView(VIEW_TYPE_MINDMAP, (leaf) => new MindmapView(leaf, this))

    // Ribbon Icon
    for (const icon of ['brain', 'brain-circuit', 'git-branch', 'file-text']) {
      try {
        this.addRibbonIcon(icon, 'Toggle Mindline', () => this.toggleMindMapView())
        break
      } catch (_) {}
    }

    // Command
    this.addCommand({
      id: 'toggle-mindmap-view',
      name: 'Toggle Mindline',
      callback: () => this.toggleMindMapView(),
    })

    // Status bar
    const sb = this.addStatusBarItem()
    sb.setText('🧠')
    sb.title = 'Toggle Mindline'
    sb.style.cursor = 'pointer'
    sb.addEventListener('click', () => this.toggleMindMapView())

    console.log('[MindMap] Plugin loaded!')
  }

  async onunload() {
    if (this.saveDataTimer) {
      window.clearTimeout(this.saveDataTimer)
      this.saveDataTimer = 0
      await this.saveData(this.data)
    }
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_MINDMAP)
  }

  getFileViewState(filePath: string): MindmapFileViewState {
    return this.data.fileStates[filePath] || {}
  }

  updateFileViewState(filePath: string, patch: Partial<MindmapFileViewState>): void {
    if (!filePath) return
    const prev = this.data.fileStates[filePath] || {}
    this.data.fileStates[filePath] = {
      ...prev,
      ...patch,
    }
    this.scheduleSaveData()
  }

  private normalizeData(raw: unknown): MindmapPluginData {
    if (!raw || typeof raw !== 'object') return { fileStates: {} }
    const maybeData = raw as Partial<MindmapPluginData>
    return {
      fileStates: maybeData.fileStates && typeof maybeData.fileStates === 'object'
        ? maybeData.fileStates
        : {},
    }
  }

  private scheduleSaveData(): void {
    if (this.saveDataTimer) window.clearTimeout(this.saveDataTimer)
    this.saveDataTimer = window.setTimeout(() => {
      this.saveDataTimer = 0
      this.saveData(this.data)
    }, 400)
  }

  /**
   * 切换脑图/Markdown 视图
   * 
   * 关键改进：用 lastFilePath（事件追踪）代替 getActiveFile()
   */
  async toggleMindMapView() {
    const activeLeaf = this.app.workspace.activeLeaf
    if (!activeLeaf) return

    const viewType = activeLeaf.view.getViewType()

    console.log('[MindMap] toggle: viewType=', viewType, 
      'lastFilePath=', this.lastFilePath,
      'getActiveFile=', this.app.workspace.getActiveFile()?.path)

    // ── 脑图 → Markdown ──
    if (viewType === VIEW_TYPE_MINDMAP) {
      const view = activeLeaf.view as MindmapView
      const targetPath = view.getFilePath() || this.lastFilePath || ''
      if (!targetPath) return

      await activeLeaf.setViewState({
        type: 'markdown',
        state: { file: targetPath, mode: 'source' },
        active: true,
      })
      return
    }

    // ── Markdown → 脑图 ──
    // 优先级：事件追踪 > getActiveFile > leaf 当前状态
    const filePath = this.lastFilePath 
      || this.app.workspace.getActiveFile()?.path 
      || ''

    if (!filePath) {
      new Notice('⚠️ 请先打开一个笔记')
      return
    }

    console.log('[MindMap] → mindmap:', filePath)

    await activeLeaf.setViewState({
      type: VIEW_TYPE_MINDMAP,
      state: { file: filePath },
      active: true,
    })
  }
}
