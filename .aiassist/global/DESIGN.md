# 项目级设计系统

> 由 `/tac-design-system` 生成并维护，与 `tokens.css` 保持同步。
> 适用项目：OPC Workstation Desktop App（Electron + React）。

## 产品调性

- **产品**：OPC Workstation Desktop App
- **用户**：独立开发者、内容创作者，需要反复运行信息工作流
- **气质**：开发者工具式的精准、高密度、沉浸、技术感
- **平台**：桌面应用（Electron + React），默认暗色模式

## 设计原则

1. **功能极简主义** —— 每个元素都有明确用途，拒绝装饰性噪音
2. **认知清晰** —— 通过层级、边框、字体组织高密度信息
3. **开发者审美** —— 深色画布、数据用等宽字体、状态用高对比色
4. **效率优先** —— 减少高级用户的点击和视线移动

## 色彩系统

明暗两套主题，`tokens.css` 中以 CSS 自定义属性提供：

### 暗色主题（默认）

| Token | Hex | 用途 |
|---|---|---|
| `--ch-bg` | `#0e1513` | 应用背景 |
| `--ch-surface` | `#1a211f` | 面板、侧边栏、卡片 |
| `--ch-surface-high` | `#242b2a` | 浮起面板、悬停态 |
| `--ch-surface-highest` | `#2f3634` | 激活项、输入框背景 |
| `--ch-border` | `#2f3634` | 结构边框 |
| `--ch-border-strong` | `#3c4a46` | 聚焦/激活边框 |
| `--ch-text` | `#dde4e1` | 主文本 |
| `--ch-text-secondary` | `#8b929d` | 次级文本、标签 |
| `--ch-text-tertiary` | `#5f6a66` | 禁用、占位符 |
| `--ch-accent` | `#2dd4bf` | 主强调色（青） |
| `--ch-accent-dim` | `#1a9e8e` | 强调色悬停/暗淡 |
| `--ch-accent-text` | `#003731` | 强调色背景上的文本 |
| `--ch-success` | `#22c55e` | 成功/运行中 |
| `--ch-warning` | `#f59e0b` | 警告/已调度 |
| `--ch-error` | `#ef4444` | 错误/失败 |
| `--ch-info` | `#3b82f6` | 信息/HTTP/通用动作 |
| `--ch-codex` | `#a855f7` | Codex / agent 节点 |
| `--ch-skill` | `#06b6d4` | Skill / Claude Code 节点 |
| `--ch-trigger` | `#f59e0b` | 触发节点 |
| `--ch-output` | `#22c55e` | 输出节点 |

### 亮色主题

| Token | Hex | 用途 |
|---|---|---|
| `--ch-bg` | `#f6f7f5` | 应用背景 |
| `--ch-surface` | `#ffffff` | 面板、侧边栏、卡片 |
| `--ch-surface-high` | `#f0f1ef` | 浮起面板、悬停态 |
| `--ch-surface-highest` | `#e6e7e4` | 激活项、输入框背景 |
| `--ch-border` | `#d9dbd6` | 结构边框 |
| `--ch-border-strong` | `#bfc2bb` | 聚焦/激活边框 |
| `--ch-text` | `#1a1c19` | 主文本 |
| `--ch-text-secondary` | `#4d524b` | 次级文本、标签 |
| `--ch-text-tertiary` | `#7a8179` | 禁用、占位符 |
| `--ch-accent` | `#0d9488` | 主强调色（亮色背景用深青） |
| `--ch-accent-dim` | `#0f766e` | 强调色悬停/暗淡 |
| `--ch-accent-text` | `#ffffff` | 强调色背景上的文本 |
| `--ch-success` | `#16a34a` | 成功/运行中 |
| `--ch-warning` | `#d97706` | 警告/已调度 |
| `--ch-error` | `#dc2626` | 错误/失败 |
| `--ch-info` | `#2563eb` | 信息/HTTP/通用动作 |
| `--ch-codex` | `#9333ea` | Codex / agent 节点 |
| `--ch-skill` | `#0891b2` | Skill / Claude Code 节点 |
| `--ch-trigger` | `#d97706` | 触发节点 |
| `--ch-output` | `#16a34a` | 输出节点 |

### 主题切换

HTML 原型应在根元素显式声明主题：

```html
<html data-theme="dark">
```

运行时切换：

```js
document.documentElement.setAttribute('data-theme', 'light');
```

未设置 `data-theme` 时，跟随系统 `prefers-color-scheme`。

## 字体系统

- **UI 无衬线**：`Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`
- **等宽**：`"JetBrains Mono", "SF Mono", Menlo, Consolas, monospace`

| Token | 字号 | 字重 | 行高 | 用途 |
|---|---|---|---|---|
| `--ch-text-xs` | 11px | 500 | 1.25 | 标签、时间戳 |
| `--ch-text-sm` | 12px | 400 | 1.5 | 说明、元信息 |
| `--ch-text-base` | 13px | 400 | 1.5 | 正文、标签 |
| `--ch-text-md` | 14px | 400 | 1.5 | 面板标题 |
| `--ch-text-lg` | 16px | 600 | 1.5 | 分区标题 |
| `--ch-text-xl` | 20px | 600 | 1.5 | 页面标题 |
| `--ch-text-2xl` | 28px | 700 | 1.25 | 空态/大标题 |

## 间距系统

| Token | 值 |
|---|---|
| `--ch-space-1` | 4px |
| `--ch-space-2` | 8px |
| `--ch-space-3` | 12px |
| `--ch-space-4` | 16px |
| `--ch-space-5` | 20px |
| `--ch-space-6` | 24px |
| `--ch-space-8` | 32px |
| `--ch-space-10` | 40px |

## 圆角系统

| Token | 值 |
|---|---|
| `--ch-radius-sm` | 4px |
| `--ch-radius-md` | 6px |
| `--ch-radius-lg` | 8px |
| `--ch-radius-xl` | 12px |
| `--ch-radius-full` | 9999px |

## 阴影系统

| Token | 暗色 | 亮色 |
|---|---|---|
| `--ch-shadow-sm` | `0 1px 2px rgba(0,0,0,0.30)` | `0 1px 2px rgba(0,0,0,0.06)` |
| `--ch-shadow-md` | `0 4px 12px rgba(0,0,0,0.40)` | `0 4px 12px rgba(0,0,0,0.08)` |
| `--ch-shadow-lg` | `0 12px 32px rgba(0,0,0,0.50)` | `0 12px 32px rgba(0,0,0,0.12)` |

## 布局常量

| Token | 值 | 用途 |
|---|---|---|
| `--ch-topbar-height` | 48px | 顶部工具栏高度 |
| `--ch-sidebar-width` | 260px | 左侧边栏宽度 |
| `--ch-right-panel-width` | 320px | 右侧面板宽度 |
| `--ch-panel-padding` | 16px | 面板内边距 |

## 组件约定

### 按钮

- **Primary**：`background: var(--ch-accent); color: var(--ch-accent-text); border-radius: var(--ch-radius-md); padding: 6px 14px; font-weight: 600;`
- **Secondary**：`background: transparent; border: 1px solid var(--ch-border); color: var(--ch-text);`
- **Ghost**：`background: transparent; color: var(--ch-text-secondary);`，悬停添加 `var(--ch-surface-high)` 背景

### 输入框

- 背景：`var(--ch-surface-highest)`
- 边框：`1px solid var(--ch-border)`
- 圆角：`var(--ch-radius-md)`
- 字体：值用等宽，标签用无衬线
- 聚焦：`border-color: var(--ch-accent)`

### 节点（工作流编辑器）

- 圆角矩形，`var(--ch-radius-lg)`
- 左侧彩色强调条表示节点类型
- 标题无衬线，配置摘要等宽
- 连接端口：左右边缘 8px 圆点
- 选中态：`box-shadow: 0 0 0 2px var(--ch-accent)`

### 卡片

- 背景：`var(--ch-surface)`
- 边框：`1px solid var(--ch-border)`
- 圆角：`var(--ch-radius-lg)`
- 悬停：`border-color: var(--ch-border-strong)`

### 状态指示器

- 圆点 + 标签
- 运行中：闪烁青色点
- 成功：实心绿色点
- 错误：实心红色点
- 警告：实心琥珀色点

## 使用方式

HTML 原型中引用：

```html
<link rel="stylesheet" href="../../global/tokens.css">
```

React 应用可在 `src/renderer/main.jsx` 或 `src/renderer/index.css` 中导入：

```js
import "../../.aiassist/global/tokens.css";
```

## 维护纪律

- `tokens.css` 是 `DESIGN.md` 的可运行形式，二者必须同步。
- 不发明系统外的颜色或样式；如需新增 token，先更新 `DESIGN.md` 和 `tokens.css`。
- 具体 story 的 HTML 原型可基于本设计系统做局部变体，但不能脱离设计系统乱飞。
