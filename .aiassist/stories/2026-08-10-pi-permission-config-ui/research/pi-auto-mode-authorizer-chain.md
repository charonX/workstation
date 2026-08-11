# Research: pi 生态的 auto mode 实现（authorizerChain 模型判断）

> 调研日期：2026-08-11
> 主题：pi/gotgenes 生态是否支持 Claude Code 式 auto mode（模型分类器自动批准），实现方式与可借鉴点
> 目的：为新 story「agent mode（auto + edit）」提供事实基础

## 结论速览

- **gotgenes 原生支持 authorizerChain（活体权威链）**——每个 link 审 `ask` → `allow`/`deny`（带教学原因）/`defer`；**官方第一方参考实现 `@gotgenes/pi-permission-model-judge` 就是模型判断 link**。
- **社区已有更接近 Claude Code auto 的包**：`@mzwing/pi-permission-auto-review`（通用模型审查 + 熔断）、`@erichll/pi-auto-review`（模型审查 + 一次性过期授权）、`pi-permission-suite` fork（四模式 Act/Auto/Ask/Plan）。
- **我们已装全部依赖**（gotgenes + pi-ai），接入是现成的；当前链 `["opc-bridge"]`（确认卡），**加一个 link 即 auto 入口**，无需改 gotgenes。
- **bounded-delegation 内建**：chain owner 把 link 对 `external_directory`/`path` 的 allow 降级为 defer——**模型 link 永不能自动放行项目外访问**（与我们 external_directory 从严一致）。

## 一、Claude Code auto mode 机制（对照基准）

- 后台「安全分类器」**模型**在工具调用前审查每个动作，判断「与请求意图对齐」；不对齐 → 拦截 + `/permissions` 记录
- 默认拦截清单（内建，非配置）：`git reset --hard`/`checkout -- .`/`clean -fd`/`stash drop`、`curl|bash` 下载执行、密钥推公开仓库、生产部署/迁移、云存储批量删、IAM/授权、共享基建修改、`rm -rf /`、推默认分支
- 信任边界：工作目录 + 会话开始时配置的 remote
- 对话边界：对话中说「别 push」→ block 信号
- 熔断：连续拦 3 次或累计 20 次 → 暂停回人工
- 显式 ask 规则永远优先（规则层在分类器前）
- 来源：https://code.claude.com/docs/en/permission-modes

## 二、gotgenes 原生机制（本地源码实证）

### yoloMode（最粗粒度 auto）
- `permission-manager.ts` `check()`：`isYoloEnabled() ? rewriteAsksToYolo(composedWithSession)`——**ask→allow 全局重写**（#526），仅解析路径生效、缓存/展示面保持 yolo-free
- 即「全放行」开关，非细粒度判断

### authorizerChain（细粒度 auto 的入口）
- `config-schema.ts`：`authorizerChain: string[]`——「有序的已注册活体权威链 link，在终审（人工）之前咨询」；配置顺序即链序；未注册名 fail-safe 跳过（更多提示，不会更少）；**opt-in**（安装扩展不授权，命名才激活）
- link 契约：审 `ask` → `allow`/`deny`（教学原因）/`defer`
- **bounded-delegation**：chain owner 把 link 对 `external_directory`/`path` 的 allow **降级为 defer**——link 不能超过策略
- 我们当前链 `["opc-bridge"]`（授权桥 → 确认卡，ADR-017）

## 三、官方参考实现 `@gotgenes/pi-permission-model-judge`（方案 A）

- 注册 `"model-judge"` link，**只审 `external_directory`**；匹配 `typoPatterns` 的路径 → 调轻量模型 → 确认笔误 → `deny`（teaching reason）；不确定 → `defer`
- **deny-first 设计（最可借鉴的安全姿势）**：只移除手动拒绝、**永不放行**（不发出 allow）——模型判错最坏情况 = 回人工确认，不是放行危险操作
- **fail-safe by construction**：模型缺失/超时/回复不可解析/不确定 → 全 defer
- **短路**：不匹配 typoPatterns 不调模型（省钱）
- **可观测**：每条决策写 `model_judge.decision`（requestId/path/matchedPattern/modelCalled/modelId/latencyMs/verdict/deferReason）——「静默全 defer」可见
- 配置：`authorizerChain: ["model-judge"]` + 包 config.json（provider/model/instructions/typoPatterns/timeoutMs 默认 5000）
- 模型经 pi 注册表解析（provider+model），**可接任意 provider（含本地）**
- 安装：`pi install npm:@gotgenes/pi-permission-model-judge`；源码 https://github.com/gotgenes/pi-packages `packages/pi-permission-model-judge`

## 四、社区实现（参考）

| 包 | 机制 | 与我们的相关性 |
|---|---|---|
| `@mzwing/pi-permission-auto-review` | 注册 `auto-review` link，接 OpenAI `codex-auto-review` 通用审查；失败 defer；**连续 3 deny 或 50 内 10 deny 熔断** | 熔断机制对应 Claude Code 3/20 暂停；但依赖 OpenAI 凭据 |
| `@erichll/pi-auto-review` | 模型审查 + **一次性过期授权**（external_directory 模型 allow 自动确认 TUI 卡，10s 过期/单次/fail-closed）+ `/approve` 人工重试 | 授权粒度设计可借鉴；同样 OpenAI 依赖 |
| `pi-permission-suite`（fork） | 四模式 Act/Auto/Ask/Plan + 命令/路径规则引擎 + 子代理自动批准 | 形态最接近 Claude Code 模式化，但 fork 非官方 |

- 社区反馈（LINUX DO）：authorizerChain 是新特性，子代理集成不完美；部分用户因延迟偏好全权限模式而非 LLM 判断
- 来源：https://www.npmjs.com/package/@mzwing/pi-permission-auto-review、https://www.npmjs.com/package/@erichll/pi-auto-review、https://www.npmjs.com/package/pi-permission-suite、https://linux.do/t/topic/2614424

## 五、我们的可借鉴路径

- **方案 A（推荐先做）**：装官方 `model-judge`——范围极窄（外部路径 typo 自动拒绝）、deny-first 零放行风险，先跑通 authorizerChain 链路
- **方案 C（后续）**：自实现 link 接 deepseek（本地运行时已有），按 deny-first + 熔断 + 短路设计，做「通用危险判断」——完全掌控模型与提示词
- **方案 B（暂不）**：社区 auto-review 包——OpenAI codex-auto-review 外部模型依赖，不适合本地 deepseek 环境

## 六、对新 story 的输入

「agent mode」story 的形态（用户已初步拍板）：
- **auto mode**：模型判断自动批准（走 authorizerChain link——先 model-judge 验证链路，后自实现通用判断）
- **edit mode**：文件编辑类操作自动批准，bash 走既有配置（对齐 Claude Code acceptEdits）
- edit mode 的「文件编辑自动批准」需要检查我们 worker 侧 edit/write 工具的评估路径（当前 write 族 ask）——edit mode 需在项目级配置或运行时开关表达
