import { ItemView, WorkspaceLeaf, Notice } from 'obsidian'
import { createRoot, Root } from 'react-dom/client'
import { StrictMode } from 'react'
import MindmapReactView from './MindmapReactView'

export const VIEW_TYPE_MINDMAP = 'mindmap-view'

export class MindmapView extends ItemView {
  private root: Root | null = null
  private filePath: string = ''
  private fileContent: string = ''
  private fileName: string = ''
  private latestTreeJson: string = ''

  constructor(leaf: WorkspaceLeaf) {
    super(leaf)
  }

  getViewType(): string { return VIEW_TYPE_MINDMAP }

  getDisplayText(): string {
    return this.fileName ? `🧠 ${this.fileName}` : 'MindMap'
  }

  getFilePath(): string { return this.filePath }

  async setState(state: any): Promise<void> {
    const fp = state?.file || ''
    if (fp) {
      this.filePath = fp
      await this.loadFile()
    }
    return Promise.resolve()
  }

  private async loadFile(): Promise<void> {
    if (!this.filePath) return

    try {
      let file = this.app.vault.getAbstractFileByPath(this.filePath)
      if (!file) file = this.app.workspace.getActiveFile() as any
      
      if (file) {
        this.fileContent = await this.app.vault.read(file as any)
        this.fileName = (file as any).name || 'untitled'
        this.filePath = (file as any).path || this.filePath
        this.refreshView()
      }
    } catch (e) {
      console.error('[MindMap-View] load error:', e)
    }
  }

  public async saveCurrentTree(): Promise<void> {
    if (!this.latestTreeJson || !this.filePath) return
    try {
      const file = this.app.vault.getAbstractFileByPath(this.filePath)
        || this.app.workspace.getActiveFile()
      if (file) await this.app.vault.modify(file as any, this.latestTreeJson)
    } catch (e) { console.error(e) }
  }

  public updateLatestTree(s: string) { this.latestTreeJson = s }

  async onOpen() {
    // 关键：给 Obsidian 的 containerEl 强制设置像素高度
    // Obsidian 的 ItemView 容器默认没有明确尺寸，React Flow 需要具体像素
    const applySize = () => {
      const rect = this.containerEl.parentElement?.getBoundingClientRect()
      const h = rect?.height || window.innerHeight - 120
      this.containerEl.style.cssText = `
        display: flex;
        flex-direction: column;
        width: 100%;
        height: ${h}px;
        overflow: hidden;
      `
    }
    applySize()
    
    // 延迟再设置一次（等 DOM 渲染完）
    setTimeout(applySize, 100)
    setTimeout(applySize, 500)
    
    // 窗口 resize 时也更新
    this.registerEvent(this.app.workspace.on('resize', applySize))
    
    // 创建 React 容器
    const reactContainer = document.createElement('div')
    reactContainer.className = 'mindmap-react-container'
    reactContainer.style.cssText = `
      position: relative;
      width: 100%;
      flex: 1;
      min-height: 400px;   /* 兜底：确保有最小高度 */
    `
    this.containerEl.appendChild(reactContainer)

    this.root = createRoot(reactContainer)

    const af = this.app.workspace.getActiveFile()
    if (af && !this.filePath) {
      this.filePath = af.path
      await this.loadFile()
    }
    this.refreshView()
  }

  async onClose() {
    await this.saveCurrentTree()
    this.root?.unmount()
    this.root = null
  }

  private refreshView() {
    if (!this.root) return
    const self = this
    this.root.render(
      <StrictMode>
        <MindmapReactView
          fileContent={this.fileContent}
          fileName={this.fileName}
          onSave={(content) => {
            self.updateLatestTree(content)
            const f = self.app.vault.getAbstractFileByPath(self.filePath)
              || self.app.workspace.getActiveFile()
            if (f) self.app.vault.modify(f as any, content).catch(() => {})
          }}
        />
      </StrictMode>
    )
  }
}
