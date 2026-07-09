# 可访问性检查清单

本清单用于 `/design`、`/browser-verify` 和 `/review --stage=code` 的前端审查。

## 键盘导航

- [ ] 所有可交互元素可用 Tab 聚焦
- [ ] 聚焦顺序符合视觉/逻辑顺序
- [ ] 聚焦可见（outline/ring）
- [ ] 自定义组件有键盘支持（Enter 激活、Escape 关闭）
- [ ] 无键盘陷阱
- [ ] 有 skip-to-content 链接
- [ ] Modal 打开时聚焦陷阱，关闭后返回原焦点

## 屏幕阅读器

- [ ] 所有图片有 `alt`（装饰图用 `alt=""`）
- [ ] 表单输入有关联 label
- [ ] 按钮/链接文本描述性，不是 "Click here"
- [ ] 纯图标按钮有 `aria-label`
- [ ] 页面只有一个 `<h1>`，标题层级不跳级
- [ ] 动态内容更新使用 `aria-live`
- [ ] 表格有 `<th>` 与 scope

## 视觉

- [ ] 正文对比度 ≥ 4.5:1
- [ ] 大文本/UI 组件对比度 ≥ 3:1
- [ ] 颜色不是唯一信息传递方式
- [ ] 文本可放大到 200% 不破坏布局
- [ ] 无每秒闪烁超过 3 次的内容

## 表单

- [ ] 每个输入有可见 label
- [ ] 必填字段明确标识（不靠颜色）
- [ ] 错误信息具体并与字段关联
- [ ] 错误状态靠图标/文字/边框表达，不靠颜色 alone
- [ ] 使用已知字段的 autocomplete

## 内容

- [ ] `<html lang="...">` 声明语言
- [ ] `<title>` 描述性
- [ ] 移动端触摸目标 ≥ 44×44px
- [ ] 空状态有意义，不是空白页

## 常见 HTML 模式

```html
<!-- 动作用 button -->
<button onClick={handleDelete}>Delete</button>

<!-- 导航用 a -->
<a href="/tasks/123">View Task</a>

<!-- 状态消息 -->
<div role="status" aria-live="polite">Task saved</div>

<!-- 错误消息 -->
<div role="alert">Error: Title is required</div>
```

## 测试工具

```bash
npx axe-core
npx pa11y
```

Chrome DevTools → Lighthouse → Accessibility
Chrome DevTools → Elements → Accessibility tree

## 反模式

| 反模式 | 问题 | 修复 |
|---|---|---|
| `div` 当按钮 | 不可聚焦、无键盘支持 | 用 `<button>` |
| 缺失 alt | 屏幕阅读器看不到图片 | 加描述性 alt |
| 只靠颜色表达状态 | 色盲用户看不到 | 加图标/文字 |
| 移除 focus outline | 用户不知道焦点在哪 | 自定义 outline |

---

来源：改编自 `reference/agent-skills/references/accessibility-checklist.md`。
