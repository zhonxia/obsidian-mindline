import { ItemView, WorkspaceLeaf, Notice } from 'obsidian'
import { createRoot, Root } from 'react-dom/client'
import { StrictMode } from 'react'
import { parseMarkdown } from '../../core/markdown'
import { serializeMarkdown } from '../../core/markdown'
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

  getViewType(): string {
    return VIEW_TYPE_MINDMAP
  }

  getDisplayText(): string {
    return this.fileName ? `🧠 ${this.fileName}` : 'MindMap'
  }

  async setState(state: any): Promise<void> {
    if (state?.file) {
      this.filePath = state.file
      await this.loadFile()
    }
    return Promise.resolve()
  }

  private async loadFile(): Promise<void> {
    if (!this.filePath) return
    try {
      const file = this.app.vault.getAbstractFileByPath(this.filePath)
      if (file) {
        this.fileContent = await this.app.vault.read(file as any)
        this.fileName = (file as any).name || 'untitled'
        this.refreshView()
      }
    } catch (e) {
      console.error('[MindMap] loadFile error:', e)
      new Notice('MindMap: 无法读取文件')
    }
  }

  /**
   * 供 main.ts 在切换视图前调用：把当前脑图内容写回 md 文件
   */
  public async saveCurrentTree(): Promise<void> {
    if (this.latestTreeJson && this.filePath) {
      try {
        const file = this.app.vault.getAbstractFileByPath(this.filePath)
        if (file) {
          await this.app.vault.modify(file as any, this.latestTreeJson)
          console.log('[MindMap] saved')
        }
      } catch (e) {
        console.error('[MindMap] save error:', e)
      }
    }
  }

  /**
   * React 组件通过 onSave 回调更新最新序列化内容
   */
  public updateLatestTree(serialized: string) {
    this.latestTreeJson = serialized
  }

  async onOpen() {
    const container = this.containerEl.children[1] || this.containerEl
    container.empty()
    const reactContainer = container.createDiv()
    reactContainer.className = 'mindmap-react-container'
    reactContainer.style.width = '100%'
    reactContainer.style.height = '100%'

    this.root = createRoot(reactContainer)
    this.refreshView()
  }

  async onClose() {
    // 关闭前保存（保险措施）
    await this.saveCurrentTree()
    if (this.root) {
      this.root.unmount()
      this.root = null
    }
  }

  private refreshView() {
    if (!this.root) return
    const self = this
    this.root.render(
      <StrictMode>
        <MindmapReactView
          fileContent={this.fileContent}
          fileName={this.fileName}
          onSave={(content: string) => {
            self.updateLatestTree(content)
            // 立即写入文件（Obsidian vault API 很快）
            if (self.filePath) {
              const file = self.app.vault.getAbstractFileByPath(self.filePath)
              if (file) {
                self.app.vault.modify(file as any, content).catch(e => {
                  console.error('[MindMap] onSave error:', e)
                })
              }
            }
          }}
        />
      </StrictMode>
    )
  }
}
