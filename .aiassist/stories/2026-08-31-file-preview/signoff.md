# 签核记录 — 2026-08-31-file-preview

## Assertion（门 1：断言签核）

- 日期：2026-09-02
- signer：**AI**（auto 签核，无升级点；规格锚点由人定——PRD §6.3/§7/§10.4 均经访谈与 tech-design 人确认）
- REQ 版本：v1（hash `d06296e2ed011b1fc699777634a8b2f4eaa7c17954962e28f76383a725ccefb9`）

### REQ-ID 列表与测试覆盖

| REQ-ID | capability / entity | 测试文件 | 状态 |
|---|---|---|---|
| REQ-PREVIEW-001 | file-preview / file-preview-panel | component/filePreviewStore.test.js、e2e/filePreview.test.cjs | ✅ |
| REQ-PREVIEW-002 | file-preview / file-preview-panel | component/filePreviewStore.test.js、e2e/filePreview.test.cjs | ✅ |
| REQ-PREVIEW-003 | file-preview / file-preview-panel | e2e/filePreview.test.cjs | ✅ |
| REQ-PREVIEW-004 | file-preview / file-preview-panel | component/filePreviewStore.test.js、api/filesApi.test.js、e2e/filePreview.test.cjs | ✅ |
| REQ-PREVIEW-005 | file-preview / file-preview-panel | component/filePreviewStore.test.js、e2e/filePreview.test.cjs | ✅ |
| REQ-PREVIEW-006 | file-preview / file-preview-panel | component/pathRecognition.test.js、e2e/filePreview.test.cjs | ✅ |
| REQ-PREVIEW-007 | file-preview / file-tree | file-tree/component/fileTreeStore.test.js、file-tree/e2e/fileTree.test.cjs | ✅ |
| REQ-PREVIEW-008 | file-preview / file-preview-panel | api/filesWatch.test.js | ✅ |
| REQ-PREVIEW-009 | file-preview / file-preview-panel | component/filePreviewStore.test.js、e2e/filePreview.test.cjs | ✅ |
| REQ-PREVIEW-010 | file-preview / file-preview-panel | api/filesApi.test.js | ✅ |

capability/entity 与 `business-capabilities.md` file-preview 条目一致（两实体、测试路径逐字对齐）。

### AI 全量自检结果

- [x] 每个 REQ-ID 至少一个自动化测试（10/10）。
- [x] 7 个测试文件头部五要素（REQ-TRACE / REQ-VERSION / CAPABILITY-TRACE / ENTITY-TRACE / EXPECTED-TRACE）+ ASSERTIONS-SIGNED 齐全，REQ-VERSION 与 requirements-v1.hash 逐字一致（脚本核验）。
- [x] 无 `// TODO: HUMAN ASSERTION` 占位；无快照断言（脚本核验）。
- [x] 边界/错误 case 覆盖：1MB 含本数双边界、符号链接逃逸、空目录、幂等重复调用、SSE 不匹配事件、非项目空间入口显隐、原子写 rename 归并。
- [x] 测试可执行性：component/api 4 文件已实际运行至 RED（seam 未就绪 / 404 契约未实现，失败信息可读）；E2E 待 BUILD 后由 /qa-runner 执行。

### expected 值交叉验证（抽样全量核对结论）

| 断言 expected | 测试落点 | PRD 锚点（已核对存在且值一致） |
|---|---|---|
| `# Title` → `<h1>Title</h1>`；源码视图字面量 `# Title` | e2e REQ-002 | §6.3 块1 row1 |
| `const x = 1;` → kind=code language=javascript | api REQ-010 | §10.4 接口2「正常 code」行 |
| `docs/guide.md` → kind=markdown content size=7 mtimeMs | api REQ-010 | §10.4 接口2「正常 md」行 |
| 1,048,576 B → 200；1,048,577 B → E-PREVIEW-TOO-LARGE 不含内容 | api REQ-010 | §6.3 块5 + §10.4 接口2「边界 1MB」行 |
| `../outside.txt` / symlink 逃逸 → E-PREVIEW-OUTSIDE-ROOT | api REQ-010、e2e REQ-006 | §6.3 块2 row2 + §10.4 接口2「异常越界」行 |
| spec.pdf / SVG → E-PREVIEW-UNSUPPORTED | api REQ-010 | §10.4 接口2「异常类型」行 + §6.2 SVG 行 |
| fixture 根噪音目录隐藏、目录在前 | api REQ-010、e2e REQ-007 | §6.3 块3 row1 + §10.4 接口1「正常」行（测试 fixture 为锚点超集，规则逐字一致，测试内已注明推导） |
| `dir="../"` → 400 E-PREVIEW-OUTSIDE-ROOT | api REQ-010 | §10.4 接口1「异常」行（400 锚定） |
| POST watch 同键幂等同 watchId；DELETE 重复 204；E2 不注册 | api REQ-008 | §10.4 接口3 三行样例逐条 |
| 200ms 内 3 次落盘 → 1 次 modified；删除 → deleted + 注销 | api REQ-008 | §10.4 接口5 样例行 |
| toast 文案「文件已被外部修改，已自动刷新」 | store/e2e REQ-009 | §10.3 流C 原文 |
| 围栏内路径不转链接 | e2e REQ-006 | §6.2 围栏行 + ADR-042 决策4 |
| 路径形态正反矩阵（含 `a b/c.txt`、`https://…`、`readme` 反例） | component REQ-006 | REQ-006 AC2（形态规则源自 §10.5 决策3，ADR-042 决策4） |
| `language:"plaintext"`（无扩展名 UTF-8） | api REQ-010 | §10.5 决策6（plaintext 兜底 → hljs 语言键）——推导链最弱的一条，已标注 |

### 升级点检查

- 初衷漂移：intention（看项目内 md/代码只有原始文本）↔ PRD §1 ↔ REQ 集合一致，无漂移。
- 跨模块契约歧义：5 个接口契约 golden values 齐备，无歧义。
- expected trace 失败：无。
- 安全边界：本 story 涉信任边界（文件读取根约束），威胁建模已在 tech-design 完成并经人确认（ADR-042 决策1/3、§10.7、访谈 R2-Q4/Q5）——本阶段无新增安全面，不重复升级。
- 范围决策：PRD §14 全 PASS、移动块清零，无悬空 GAP。

**结论：无升级项，AI 全量自检通过，签核锁定。BUILD 解锁。**
