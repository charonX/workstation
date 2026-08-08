# ADR-020: 权限出厂策略单一真源化——代码规则表为真源，部署 JSON 为生成产物

- **状态**: 已接受
- **日期**: 2026-08-08
- **相关 story**: 2026-08-07-pi-agent-consolidation
- **相关 REQ**: REQ-AGENT-041（单一真源 + 配平）；修订 ADR-017（2026-08-02-ui-copilot S8）

## 背景

ADR-017 决策了 gotgenes 权限扩展 + 授权桥，策略为全局/项目两级**文件**模型。出厂权限语义由此产生**双真源**：同一套语义既活在代码评估器（`permissionPolicy.js` 附录 A 内建 bash 破坏性模式清单 / pre-gate regex），又活在部署 JSON（`agent-policy/pi-permission-config.json`，gotgenes 启动部署面），靠注释手工镜像维持一致——已产出实际伤害：BUG-002 登记的待做未清、`echo hi > ../out.txt` 类命令一令双卡（gotgenes 热路径对重定向/管道 token 不可见 → 与代码 pre-gate 双确认）。

2026-08-07 访谈根 A 真源方向，用户拍板 **(b)：代码评估器为单一真源**；`agent-policy/pi-permission-config.json` 降级为**生成产物**。2026-08-08 人裁决：**独立成文 ADR-020**（非 ADR-017 补充节），注明对 ADR-017「策略文件=契约」表述的修订关系。

## 决策

1. **代码规则表为唯一真源**：出厂权限规则语义只声明在代码规则表（`src/services/policyRules.js` `BASH_RULES`，每条 `{ pattern, decision, hotPathVisible, family }`）；权限评估器与生成器**共同消费**该规则表——评估器不再硬编码 bash 模式清单。
2. **部署 JSON 为生成产物**：`node scripts/gen-agent-policy.mjs` 从规则表 + 静态模板字段产出 `agent-policy/pi-permission-config.json`（仅 `hotPathVisible:true` 热路径可见族；重定向/管道不可见族不出现）；产物 golden 检入仓库（PR diff 可审完整部署形态）；配平测试（`--check` 模式：一致 exit 0 / 漂移 exit 1 + diff 摘要）锁死「生成 == 部署」。
3. **不可见族只活在 pre-gate**：重定向/管道等 hotPathVisible:false 族只由评估器（pre-gate）消费，生成产物不再出现——消除「写了等于没写」的虚假安全感；双确认家族从此只有一个家（同一命令同一危险只出一张卡，ADR-017 契约不变）。
4. **修订关系（对 ADR-017 的显式修订）**：ADR-017「策略文件=契约」表述修订为「**代码规则表=真源，部署 JSON=生成产物**」。ADR-017 其余决策不变：gotgenes 权限引擎、授权桥接入确认挂起队列、ask 单卡语义、唯一执行者（worker 侧）、单一评估（桥在 gotgenes 前）。
5. **项目级覆盖 JSON 机制不变**：`<projectDir>/.pi/...` 用户自定义口子保留——属用户/项目自定义，不属于出厂默认双真源问题；加载、优先级（项目 > 全局 > 附录 A）、fail-closed 信任门语义保持。

## 后果

- **漂移从「靠人记得」变「构造上不可能」**：改规则只改 `policyRules` 一处，忘跑生成器 → 配平测试红，不进部署（F6 漂移分支）。
- **一令双卡角落根除**：不可见族从 gotgenes 部署面移除，双确认家族只剩 pre-gate 一个评估家。
- 代价：golden 需随规则变更重新生成检入（PR 可见完整部署形态，属安全边界收益）；gotgenes 上游 JSON schema 演进时生成器需跟进（第三方格式仍是部署界面）。
- 项目级覆盖 JSON 的优先级与容错语义不回退（E4 沿用现状）。

## 替代方案

- **A. 以 JSON 声明为真源（改配置不改代码）**：配置友好，但冷路径行为随配置漂移、代码须精确复刻 gotgenes glob 语义、且不可见族在 JSON 表达面无效（写进去 gotgenes 也不评估）——访谈用户拍板 (b) 代码为源（D6）。
- **B. 双真源手工镜像（维持现状）**：已被 BUG-002 登记待做与一令双卡实证伤害，本决策即为其根除。
- **形态备选：作 ADR-017 补充节（沿用 2026-08-07 BUG-001/002 补充节先例）**：保持 ADR-017 完整性 vs 独立 ADR 索引更清晰——2026-08-08 人裁决独立成文，修订关系由本决策第 4 条显式标注。

## 相关文件

- 决策来源：`.aiassist/stories/2026-08-07-pi-agent-consolidation/interview-notes.md`（D6）
- 方案：`.aiassist/stories/2026-08-07-pi-agent-consolidation/tech-design.md`（接口 4 生成器 CLI、接口 5 规则表、数据流 5/6）
- 被修订：ADR-017（「策略文件=契约」表述 → 本决策第 4 条）
- 实现：`src/services/policyRules.js`（规则表唯一真源）、`src/services/permissionPolicy.js`（评估器消费规则表）、`scripts/gen-agent-policy.mjs`（生成器 + --check）、`agent-policy/pi-permission-config.json`（golden 生成产物）
- 配平测试：`tests/capabilities/agent-dialogue/conversation-space/2026-08-07-pi-agent-consolidation/api/policyCodegen.test.js`
