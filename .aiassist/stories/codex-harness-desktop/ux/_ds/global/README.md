# OPC Workstation 设计系统

项目级设计系统，由 `/tac-design` 生成。

## 来源

- **生成方式**：无外部来源，基于用户明确的调性输入生成。
- **调性**：开发者工具的精准、高冷、高密度。
- **用户**：开发者的本地桌面工具。
- **默认主题**：亮色。
- **可选主题**：暗色。
- **无品牌约束**：颜色、字体为 AI 基于调性建议，可随时回流调整。

## 内容清单

| 文件 | 用途 |
|---|---|
| `DESIGN.md` | 设计原则、token 表格、组件约定、维护纪律 |
| `tokens.css` | 全部 CSS 自定义属性（颜色、字体、间距、圆角、阴影、布局） |
| `styles.css` | `@import "./tokens.css"` + 最小工具类 |
| `preview.html` | 编译生成的可视化预览（运行 build-preview 后生成） |
| `_ds_manifest.json` | 设计系统编译清单 |
| `_ds_bundle.js` | 组件/卡片 bundle（当前无组件） |
| `_d_meta.json` | 资产记录与导入元数据 |
| `_ds/<slug>/` | 自导入后的设计系统副本 |

## 使用方式

### HTML 原型

```html
<link rel="stylesheet" href="../../global/tokens.css">
```

### React / Electron

```js
import "../../.aiassist/global/tokens.css";
```

### 主题切换

```js
document.documentElement.setAttribute('data-theme', 'dark');
```

默认跟随系统 `prefers-color-scheme`。

## 维护

修改 `DESIGN.md` 或 `tokens.css` 后，必须重新运行设计系统编译管线：

```bash
node scripts/design-system/compile-design-system.mjs .aiassist/global
node scripts/design-system/check-design-system.mjs .aiassist/global
node scripts/design-system/build-preview.mjs .aiassist/global --out .aiassist/global/preview.html
```

## 更新记录

- 2026-07-06：初版建立。亮色默认，冷青强调色，开发者工具风格。
