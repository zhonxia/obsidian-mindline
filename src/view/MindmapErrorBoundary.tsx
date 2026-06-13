import React, { Component, ReactNode } from 'react'

interface Props {
  children: ReactNode
  filePath: string
}

interface State {
  hasError: boolean
  error?: Error
}

/** 错误边界 —— 捕获渲染异常，显示友好提示 */
export default class MindmapErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="mindmap-message">
          <div className="mindmap-message-card">
            <div className="mindmap-message-title">脑图渲染出错</div>
            <div className="mindmap-message-detail">
              {this.state.error?.message || '未知错误'}
              {'\n文件路径：' + this.props.filePath}
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
