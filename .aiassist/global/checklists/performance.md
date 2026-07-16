# 性能检查清单

本清单用于 `/tech-design`、`/review --stage=code --mode=panel` 的 performance-auditor 维度，以及任何涉及响应时间、资源消耗或前端渲染的实现。

## 核心原则

- [ ] 未测量不优化
- [ ] 先打基准，再改代码，再对比
- [ ] 小型测试抓回归，大型测试抓真实用户体验

## Web Vitals 目标

| 指标 | 良好 | 需改进 | 差 |
|---|---|---|---|
| LCP | ≤ 2.5s | ≤ 4.0s | > 4.0s |
| INP | ≤ 200ms | ≤ 500ms | > 500ms |
| CLS | ≤ 0.1 | ≤ 0.25 | > 0.25 |

## 前端

### 图片
- [ ] 使用现代格式（WebP/AVIF）
- [ ] 响应式尺寸（srcset/sizes）
- [ ] 明确 width/height（防 CLS）
- [ ] 首屏外图片懒加载

### JavaScript
- [ ] 初始 bundle ≤ 200KB gzipped
- [ ] 路由/重功能使用动态 import
- [ ] Tree shaking 生效
- [ ] 无阻塞 `<head>` 的 JS
- [ ] 长任务（>50ms）拆分，优先用 `scheduler.yield()`

### CSS / 字体
- [ ] 关键 CSS 内联或预加载
- [ ] 字体 WOFF2、自托管、预加载 LCP 字体
- [ ] `font-display: swap` 或 `optional`

### 网络 / 渲染
- [ ] 静态资源长期缓存 + hash
- [ ] HTTP/2 或 HTTP/3
- [ ] 减少重定向
- [ ] 动画使用 transform/opacity
- [ ] 长列表虚拟化

## 后端

### 数据库
- [ ] 无 N+1 查询
- [ ] 过滤/排序列有索引
- [ ] 列表接口分页
- [ ] 连接池配置正确

### API
- [ ] p95 响应时间 < 200ms
- [ ] 无请求处理器中的同步重计算
- [ ] 批量操作替代循环单条调用
- [ ] 响应压缩（gzip/brotli）
- [ ] 合理缓存

## 测量命令

```bash
# Lighthouse
npx lighthouse https://localhost:3000 --output json

# Bundle 分析
npx webpack-bundle-analyzer stats.json
# 或 Vite: npx vite-bundle-visualizer
```

## 反模式

| 反模式 | 影响 | 修复 |
|---|---|---|
| N+1 查询 | DB 负载线性增长 | join/includes/batch loading |
| 无界查询 | 内存耗尽/超时 | 分页 + LIMIT |
| 缺失索引 | 数据增长后读取变慢 | 加索引 |
| 阻塞主线程 | INP 差 | 拆分长任务、Web Workers |
| 未压缩资源 | 带宽浪费 | gzip/brotli |

---

来源：改编自 `reference/agent-skills/references/performance-checklist.md`。
