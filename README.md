# Mindline

> A Mubu-style Markdown outline mind map plugin for Obsidian. Visualize and edit your Markdown headings as an interactive mind map.

[![version](https://img.shields.io/badge/version-0.3.0-blue)](https://github.com/zhonxia/obsidian-mindline)
[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Obsidian](https://img.shields.io/badge/Obsidian-%3E%3D1.0.0-7C3AED)](https://obsidian.md)
[![Downloads](https://img.shields.io/badge/dynamic/json?url=https://raw.githubusercontent.com/zhonxia/obsidian-mindline/main/package.json&query=$.version&label=latest)](https://github.com/zhonxia/obsidian-mindline/releases)

---

## ✨ 功能特性

### 核心功能

- **📄 双向同步** — Markdown 文件与脑图实时双向同步，修改任一视图自动反映到另一视图
- **✏️ 内联编辑** — 基于 contentEditable 的无缝编辑体验，双击直接进入编辑模式，光标自动定位到文字末尾
- **🔗 节点多选** — 支持 `Cmd/Ctrl + 点击` 多选、`Shift + 点击` 连续选择，批量操作更高效
- **🧩 节点合并** — 将同一父节点下的多个选中节点合并为一个，标题自动拼接，子节点智能追加
- **↩️ 撤销重做** — 支持 `Ctrl+Z / Ctrl+Shift+Z` 撤回/重做，最多 50 步操作历史
- **📌 节点折叠** — 点击折叠/展开子节点，保持大型脑图视图清晰

### 交互体验

- **🖱️ 拖拽重组** — 按住节点拖拽到目标位置，实时调整层级结构
- **🔍 画布操控** — 拖拽平移画布、滚轮/捏合缩放，底部工具栏一键「适应画布」
- **⌨️ 全键盘操作** — 从导航、编辑到删除，全程无需离开键盘
- **🎨 Markdown 渲染** — 节点文本支持 **粗体** / *斜体* / `代码` / ~~删除线~~
- **🌈 H1-H5 标题样式** — 节点按标题层级自动着色，视觉层次分明
- **🚌 总线式连线** — 同层级子节点共享垂直总线，减少连线交叉，视觉整洁

---

## 📸 预览

![Mindline Overview](assets/mindline-overview.png)

*Obsidian 内 Mindline 脑图视图：H1-H5 自动着色，总线式连线，缩放工具栏，节点多选高亮*

---

## 📦 安装

### 从 Obsidian 社区插件市场安装（审核中）

1. 打开 Obsidian → **设置** → **第三方插件** → **浏览**
2. 搜索 **"Mindline"**
3. 安装并启用

### 手动安装（BRAT 推荐）

使用 [BRAT](https://github.com/TfTHacker/obsidian42-brat) 插件自动安装：

1. 安装并启用 BRAT
2. 命令面板 → `BRAT: Add a beta plugin for testing`
3. 输入仓库地址：`https://github.com/zhonxia/obsidian-mindline`
4. 完成后在第三方插件列表启用 **Mindline**

### 完全手动安装

```bash
# 克隆仓库到 Obsidian 插件目录
cd your-vault/.obsidian/plugins
git clone https://github.com/zhonxia/obsidian-mindline.git
cd obsidian-mindline
npm install
npm run build
```

然后在 Obsidian **设置 → 第三方插件** 中启用 **Mindline**。

---

## 🚀 使用方法

### 打开脑图视图

1. 打开任意 Markdown 笔记（文件内需有标题 `# Heading` 才能生成脑图）
2. 点击左侧功能区图标（脑图图标）或
3. 命令面板：`Ctrl/Cmd + P` → **"Mindline: 切换脑图视图"**

---

### 节点选择

| 操作 | 方式 |
|------|------|
| 单选节点 | 单击节点 |
| 多选节点 | `Cmd/Ctrl + 单击` 节点 |
| 连续选择 | `Shift + 单击` 同一父节点下的节点 |
| 取消选择 | `Escape` 或单击画布空白区域 |

> 选中节点会显示橙色高亮边框，多选时每个选中节点均有高亮。

---

### 编辑操作

| 操作 | 方式 |
|------|------|
| 编辑节点 | 双击节点 / `F2` / `Enter` |
| 添加子节点 | `Tab` |
| 添加同级节点 | `Enter`（在非编辑状态下） |
| 删除节点 | `Delete` / `Backspace` |
| 合并选中节点 | `Cmd/Ctrl + M`（需先多选节点） |
| 拖拽移动 | 按住节点拖拽到目标位置 |
| 折叠子节点 | 点击节点上的折叠按钮 `▾` |

---

### 快捷键一览

#### 编辑快捷键

| 快捷键 | 功能 |
|--------|------|
| `Tab` | 为选中节点添加子节点 |
| `Shift + Tab` | 将节点提升一级（反向缩进/Outdent） |
| `Enter` | 在选中节点后添加同级节点 |
| `Shift + Enter` | 添加子节点（等效于 `Tab`） |
| `Delete` / `Backspace` | 删除选中节点 |
| `F2` / 双击 | 编辑当前节点 |
| `Escape` | 取消编辑 / 取消选择 |

#### 导航快捷键

| 快捷键 | 功能 |
|--------|------|
| `↑` / `↓` | 在同层级节点间导航 |
| `Tab`（编辑中） | 确认编辑并退出 |

#### 批量操作快捷键

| 快捷键 | 功能 |
|--------|------|
| `Cmd/Ctrl + 单击` | 多选节点 |
| `Shift + 单击` | 连续选择节点 |
| `Cmd/Ctrl + M` | 合并选中节点（同一父节点下） |
| `Cmd/Ctrl + Z` | 撤销 |
| `Cmd/Ctrl + Shift + Z` | 重做 |

---

### 鼠标与触控板手势

| 手势 | 功能 |
|------|------|
| 鼠标左键拖拽空白区域 | 平移画布 |
| 鼠标左键拖拽节点 | 移动节点到目标位置 |
| 鼠标滚轮 | 以光标为中心缩放 |
| 触控板双指滑动 | 平移画布 |
| 触控板捏合 | 缩放画布 |

---

### 缩放工具栏

底部居中浮动工具栏：

- **`+`** — 放大（每次 +10%）
- **`−`** — 缩小（每次 -10%）
- **百分比** — 显示当前缩放比例，点击恢复 100%
- **`⊡`** — 适应画布（自动全览所有节点）

---

## 🎨 节点样式

节点颜色和样式根据 Markdown 标题层级自动变化：

| 层级 | 语法 | 样式 |
|------|------|------|
| H1 | `# 标题` | 深灰边框，粗体，最大字号 |
| H2 | `## 标题` | 蓝色边框 |
| H3 | `### 标题` | 绿色边框 |
| H4 | `#### 标题` | 青绿色边框 |
| H5 | `##### 标题` | 橙色虚线边框 |
| 普通文本 | 无前缀 | 浅灰色边框，常规字重 |

---

## 🧩 节点合并功能详解

节点合并允许你将多个同级节点合并为一个，适用于整理重复或过于细碎的节点。

### 使用步骤

1. **选择节点** — 使用 `Cmd/Ctrl + 单击` 或 `Shift + 单击` 选择同一父节点下的多个节点
2. **触发合并** — 按 `Cmd/Ctrl + M`，或右键菜单选择「合并选中节点」
3. **确认结果** — 合并后，顺序最靠前的节点保留，其余节点的标题拼接为多行标题，所有子节点自动追加

### 合并规则

- ✅ **支持**：同一父节点下的多个节点
- ❌ **不支持**：跨层级节点合并（会破坏 Markdown 结构）
- 📝 合并后保留节点内容 = 各节点标题以 `\n\n` 拼接
- 👶 被合并节点的子节点自动追加到保留节点的子节点列表末尾
- 🎯 合并完成后自动选中合并后的节点

---

## 🔧 开发

```bash
# 安装依赖
npm install

# 开发模式（监听文件变化，自动重新构建）
npm run dev

# 类型检查
npm run typecheck

# 生产构建
npm run build
```

构建产物：`main.js`、`manifest.json`、`styles.css`、`versions.json`

---

## 🏗️ 技术栈

| 技术 | 用途 |
|------|------|
| **TypeScript 5** | 严格模式类型安全 |
| **React 18** | Hooks + 函数式组件 |
| **Esbuild** | 快速打包（~1s 完成构建） |
| **mdast** | Markdown AST 解析与序列化 |
| **Obsidian API** | 插件生命周期、编辑器集成 |

---

## 🗺️ 路线图

- [x] 节点多选与合并
- [x] contentEditable 内联编辑
- [x] 视图状态持久化
- [ ] 设置面板（自定义样式、快捷键映射）
- [ ] 导出为 PNG / SVG 图片
- [ ] 多文件脑图联动
- [ ] 节点搜索和过滤
- [ ] 连接线样式选项（曲线/直线切换）
- [ ] 节点备注与富文本支持

---

## 🐛 问题反馈

遇到问题或有功能建议？欢迎在 [GitHub Issues](https://github.com/zhonxia/obsidian-mindline/issues) 中提出。

---

## ❤️ 致谢

- 灵感来自 [幕布 (Mubu)](https://mubu.com) 的大纲脑图体验
- 基于 [Obsidian](https://obsidian.md) 插件 API 构建

---

## License

MIT © Qin Bai
