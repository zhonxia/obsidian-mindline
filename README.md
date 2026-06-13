# Mindline

> A Mubu-style Markdown outline mind map plugin for Obsidian.

[![version](https://img.shields.io/badge/version-0.2.0-blue)](https://github.com/zhonxia/obsidian-mindline)
[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Obsidian](https://img.shields.io/badge/Obsidian-%3E%3D1.0.0-7C3AED)](https://obsidian.md)

---

## 功能特性

- **双向同步** — Markdown 文件与脑图实时双向同步，修改任一视图自动反映到另一视图
- **完整编辑** — 双击编辑节点、右键菜单添加/删除、拖拽重组层级
- **键盘快捷键** — 全套键盘操作，无需离开键盘即可完成脑图编辑
- **撤销重做** — 支持 Ctrl+Z 撤回最近 50 步操作
- **节点折叠** — 点击折叠/展开子节点，保持视图清晰
- **拖拽平移** — 画布自由拖拽，支持鼠标和触控板
- **缩放控制** — 滚轮缩放 + 底部工具栏 + 触控板捏合
- **Markdown 渲染** — 节点文本支持**粗体**/*斜体*/`代码`/~~删除线~~
- **H1-H5 标题样式** — 节点按标题层级自动应用不同颜色和字重
- **总线式连线** — 子节点共享垂直总线，视觉整洁

---

## 安装

### 从 Obsidian 社区插件市场安装（即将上架）

1. 打开 Obsidian → 设置 → 第三方插件 → 浏览
2. 搜索 "Mindline"
3. 安装并启用

### 手动安装

```bash
# 克隆仓库到 Obsidian 插件目录
cd your-vault/.obsidian/plugins
git clone https://github.com/zhonxia/obsidian-mindline.git
cd obsidian-mindline
npm install
npm run build
```

然后在 Obsidian 设置 → 第三方插件中启用 "Mindline"。

---

## 使用方法

### 打开脑图视图

1. 打开任意 Markdown 笔记
2. 点击左侧功能区图标（脑图图标）
3. 或使用命令面板：`Ctrl/Cmd + P` → "Mindline: 切换脑图视图"

> 文件内需有 Markdown 标题（`# Heading`）才能生成脑图。

### 编辑操作

| 操作 | 方式 |
|------|------|
| 编辑节点 | 双击节点 / Enter |
| 添加子节点 | 右键 → 添加子节点 / `Tab` |
| 添加同级节点 | 右键 → 添加同级节点 / `Enter` |
| 删除节点 | 右键 → 删除节点 / `Delete` / `Backspace` |
| 拖拽移动 | 按住节点拖拽到目标位置 |
| 折叠子节点 | 点击节点上的折叠按钮 |

### 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Tab` | 为选中节点添加子节点 |
| `Shift + Tab` | 将节点提升一级（反向缩进） |
| `Enter` | 在选中节点后添加同级节点 |
| `Shift + Enter` | 添加子节点 |
| `Delete` / `Backspace` | 删除选中节点 |
| `↑` / `↓` | 在同层级节点间导航 |
| `F2` / `双击` | 编辑当前节点 |
| `Ctrl/Cmd + Z` | 撤销 |
| `Escape` | 取消编辑 / 取消选择 |

### 鼠标与触控板

| 手势 | 功能 |
|------|------|
| 鼠标左键拖拽空白区域 | 平移画布 |
| 鼠标滚轮 | 以光标为中心缩放 |
| 触控板双指滑动 | 平移画布 |
| 触控板捏合 | 缩放画布 |

### 缩放工具栏

底部居中浮动工具栏：

- **`+`** — 放大
- **`−`** — 缩小
- **百分比** — 显示当前缩放比例
- **`⊡`** — 适应画布（自动全览所有节点）

---

## 节点样式

节点颜色根据标题层级自动变化：

| 层级 | 语法 | 样式 |
|------|------|------|
| H1 | `# 标题` | 深灰色边框，粗体 |
| H2 | `## 标题` | 蓝色边框 |
| H3 | `### 标题` | 绿色边框 |
| H4 | `#### 标题` | 青绿色边框 |
| H5 | `##### 标题` | 橙色虚线边框 |
| 普通 | 无前缀 | 浅灰色边框 |

---

## 开发

```bash
# 安装依赖
npm install

# 开发模式（自动重新构建）
npm run dev

# 类型检查
npm run typecheck

# 生产构建
npm run build
```

---

## 技术栈

- **TypeScript** — 严格模式类型安全
- **React 18** — Hooks + 函数式组件
- **Esbuild** — 快速打包
- **mdast** — Markdown AST 解析

---

## 路线图

- [ ] 设置面板（自定义样式、快捷键）
- [ ] 导出为 PNG/SVG 图片
- [ ] 多文件脑图联动
- [ ] 搜索和过滤节点
- [ ] 连接线样式选项

---

## License

MIT © Qin Bai
