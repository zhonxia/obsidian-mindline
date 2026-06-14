import { ItemView, TFile, WorkspaceLeaf } from 'obsidian'
import { createRoot, Root } from 'react-dom/client'
import { StrictMode } from 'react'
import MindmapReactView from './MindmapReactView'
import type { MindmapFileViewState, MindmapViewStateStore } from '../types'

export const VIEW_TYPE_MINDMAP = 'mindmap-view'

export class MindmapView extends ItemView {
  private root: Root | null = null
  private reactContainer: HTMLElement | null = null
  private filePath: string = ''
  private fileContent: string = ''
  private fileName: string = ''
  private fileLoaded: boolean = false
  private fileError: string = ''
  private refreshTimer: number = 0
  private viewStateStore: MindmapViewStateStore

  constructor(leaf: WorkspaceLeaf, viewStateStore: MindmapViewStateStore) {
    super(leaf)
    this.viewStateStore = viewStateStore
  }

  getViewType(): string { return VIEW_TYPE_MINDMAP }

  getDisplayText(): string {
    return this.fileName ? `${this.fileName}` : 'MindMap'
  }

  getFilePath(): string { return this.filePath }

  getState(): Record<string, unknown> {
    return { file: this.filePath }
  }

  async setState(state: any): Promise<void> {
    const fp = state?.file || ''
    if (fp) {
      console.log('[MindMap-View] setState:', fp, { alreadyLoaded: this.fileLoaded })
      this.filePath = fp
      this.fileContent = ''
      this.fileName = ''
      this.fileLoaded = false
      this.fileError = ''
      // 不在这里 render，等 onOpen() 创建 root 后再 render
      await this.loadFile()
    }
    return Promise.resolve()
  }

  /** 将编辑后的 Markdown 内容写回文件 */
  private async handleSaveContent(newContent: string): Promise<void> {
    try {
      const file = this.app.vault.getAbstractFileByPath(this.filePath)
      if (!(file instanceof TFile)) {
        console.warn('[MindMap-View] handleSaveContent: file not found', this.filePath)
        return
      }
      await this.app.vault.modify(file, newContent)
      this.fileContent = newContent
      console.log('[MindMap-View] handleSaveContent: saved', { length: newContent.length })
    } catch (e) {
      console.error('[MindMap-View] handleSaveContent error:', e)
    }
  }

  private async loadFile(): Promise<void> {
    if (!this.filePath) {
      this.fileLoaded = true
      this.fileError = '没有收到要打开的 Markdown 文件路径'
      console.log('[MindMap-View] loadFile: no filePath')
      this.scheduleRefresh()
      return
    }

    try {
      const file = this.app.vault.getAbstractFileByPath(this.filePath)
      if (!(file instanceof TFile)) {
        throw new Error(`找不到文件：${this.filePath}`)
      }

      this.fileContent = await this.app.vault.read(file)
      this.fileName = file.name || 'untitled'
      this.filePath = file.path || this.filePath
      this.fileLoaded = true
      this.fileError = ''
      console.log('[MindMap-View] loadFile: success', { fileName: this.fileName, contentLength: this.fileContent.length })
      this.scheduleRefresh()
    } catch (e) {
      console.error('[MindMap-View] loadFile error:', e)
      this.fileLoaded = true
      this.fileError = e instanceof Error ? e.message : String(e)
      this.scheduleRefresh()
    }
  }

  async onOpen() {
    console.log('[MindMap-View] onOpen() called', {
      hasRoot: !!this.root,
      hasContainer: !!this.reactContainer,
      filePath: this.filePath,
      fileLoaded: this.fileLoaded,
    })

    if (this.root && this.reactContainer) {
      console.log('[MindMap-View] onOpen: already initialized, scheduling refresh')
      this.scheduleRefresh()
      return
    }

    this.containerEl.addClass('mindmap-view-container')

    this.reactContainer = document.createElement('div')
    this.reactContainer.className = 'mindmap-react-container'
    this.reactContainer.style.width = '100%'
    this.reactContainer.style.height = '500px'
    this.reactContainer.style.minHeight = '500px'
    this.reactContainer.style.position = 'relative'
    this.reactContainer.style.overflow = 'hidden'
    this.containerEl.appendChild(this.reactContainer)

    console.log('[MindMap-View] onOpen: container created', {
      containerElSize: this.containerEl.getBoundingClientRect(),
      reactContainer: !!this.reactContainer,
    })

    this.root = createRoot(this.reactContainer)
    this.doRender()

    requestAnimationFrame(() => {
      const parent = this.containerEl.parentElement
      let h = 500
      if (parent) {
        const rect = parent.getBoundingClientRect()
        console.log('[MindMap-View] onOpen: parent rect', { h: rect.height, w: rect.width })
        if (rect.height > 100) h = Math.round(rect.height)
      }

      this.containerEl.style.height = `${h}px`
      this.reactContainer!.style.height = `${h}px`
      this.reactContainer!.style.minHeight = `${h}px`

      console.log('[MindMap-View] onOpen: size set', { h, containerSize: this.containerEl.getBoundingClientRect() })

      setTimeout(() => {
        const r2 = this.containerEl.parentElement?.getBoundingClientRect()
        if (r2 && r2.height > 100 && Math.abs(r2.height - h) > 10) {
          const h2 = Math.round(r2.height)
          this.containerEl.style.height = `${h2}px`
          this.reactContainer!.style.height = `${h2}px`
          this.reactContainer!.style.minHeight = `${h2}px`
          console.log('[MindMap-View] onOpen: size corrected', { h2 })
        }

        if (this.filePath && !this.fileLoaded) {
          console.log('[MindMap-View] onOpen: file not loaded, loading now')
          this.loadFile()
        } else {
          console.log('[MindMap-View] onOpen: refreshing render', { fileLoaded: this.fileLoaded, contentLength: this.fileContent.length })
          this.scheduleRefresh()
        }
      }, 150)
    })
  }

  async onClose() {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer)
      this.refreshTimer = 0
    }
    this.root?.unmount()
    this.root = null
    this.reactContainer = null
  }

  private scheduleRefresh() {
    if (this.refreshTimer) clearTimeout(this.refreshTimer)
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = 0
      this.doRender()
    }, 50)
  }

  private doRender() {
    if (!this.root) {
      console.warn('[MindMap-View] doRender: root is null, skipping render')
      return
    }

    const saveContent = (newContent: string) => {
      this.handleSaveContent(newContent)
    }

    const initialViewState: MindmapFileViewState = this.filePath
      ? this.viewStateStore.getFileViewState(this.filePath)
      : {}

    const saveViewState = (patch: Partial<MindmapFileViewState>) => {
      this.viewStateStore.updateFileViewState(this.filePath, patch)
    }

    console.log('[MindMap-View] doRender:', {
      filePath: this.filePath,
      fileLoaded: this.fileLoaded,
      contentLength: this.fileContent.length,
      fileName: this.fileName,
    })

    this.root.render(
      <StrictMode>
        <MindmapReactView
          filePath={this.filePath}
          fileContent={this.fileContent}
          fileName={this.fileName}
          fileLoaded={this.fileLoaded}
          fileError={this.fileError}
          onSaveContent={saveContent}
          initialViewState={initialViewState}
          onViewStateChange={saveViewState}
        />
      </StrictMode>
    )
  }
}
