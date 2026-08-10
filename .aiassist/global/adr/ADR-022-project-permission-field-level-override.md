# ADR-022: 项目级权限配置 = 字段级覆盖语义（最小覆盖集文件）

- **状态**: 已接受
- **日期**: 2026-08-10
- **相关 story**: 2026-08-10-pi-permission-config-ui
- **相关 REQ**: REQ-AGENT-041（权限出厂策略单一真源）语义延伸；本 ADR 定义**项目级配置面**的契约语义

## 背景

PI 权限策略有三层：全局出厂（`agent-policy/pi-permission-config.json`，代码规则表生成）、项目级（`<projectDir>/.pi/extensions/pi-permission-system/config.json`）、运行时确认卡（授权桥）。项目级配置此前只能手写 JSON，本 story 将其 UI 化——UI 化的前提是把「项目级配置的语义」显式契约化，否则实现者/用户会对"项目文件应该长什么样"产生分歧。

## 实证（gotgenes 源码，非假设）

`config-loader.ts mergeUnifiedConfigs` + `permission-merge.ts mergeFlatPermissions` 逐字段合并：

1. 布尔/数值/数组字段：`override[key] ?? base[key]`——**项目写了就覆盖，未定义继承全局**；
2. `permission` 面标量键（`permission.write`）：override 替换；
3. `permission` 面对象键（`permission.bash` pattern map）：**浅合并**——项目只覆盖写了的 pattern（如 `rm *`），其余 pattern 继承全局；
4. 合并优先级（低→高）：legacy 全局 < legacy 扩展 < 新全局 < legacy 项目 < 新项目；
5. 文件不存在 = 空配置（全部继承全局）；存在但解析失败 = `{invalid:true}` fail-closed。

## 决策

1. **项目级配置 = 字段级覆盖**：文件里写了什么字段就覆盖什么，未定义字段运行时回落全局——**项目文件是「最小覆盖集」，不是全局快照**。
2. **UI 保存语义 = 最小覆盖集生成**：面板/JSON 保存产生的文件只含覆盖项；未动的字段不写入。
3. **取消覆盖 = 从文件删除字段**：用户把覆盖项改回「跟随全局」= 该字段从项目文件移除（回落全局），不写入与全局相同的冗余值。
4. **首次保存生成最小文件**：无 `.pi` 文件的项目，首次保存才生成（目录递归创建），文件只含本次覆盖项。
5. **运行时真相 = 文件**：UI 不建独立 DB 状态；gotgenes 每次权限评估 stat 文件（mtime stamp 缓存，`permission-manager.ts resolvePermissions`），文件一变下次评估即用新配置——**保存即生效零自造热重载**。

## 后果

- 继承视图（全局基底 + 项目覆盖高亮）与文件形态自洽：文件里只有"项目已改"的条目，未改项天然继承。
- 全局策略升级自动跟随项目（无复制残留/伪差异冻结问题）。
- 取消覆盖的删除语义要求保存逻辑知道「项目文件当前字段 + 面板认识字段清单」（删除白名单），未知字段一律保留。
- UI 需向用户明示该语义（页面说明文案：「项目只覆盖你改的条目，未改的继承全局」）。

## 替代方案

- **B. 全局快照复制为底**（首次保存复制全量全局 JSON 再覆盖）：文件自包含但产生伪差异——全局升级后项目静默冻结在旧值，用户无法区分"故意改的"与"复制残留"。访谈 Q2 否掉。
- **C. 只读全局 + 全量项目文件**：表达不了"继承"语义，项目文件膨胀且全局演进不跟随。否。

## 相关文件

- 实证：`node_modules/@gotgenes/pi-permission-system/src/{config-loader,permission-merge,permission-manager,policy-loader}.ts`
- 决策来源：`2026-08-10-pi-permission-config-ui/interview-notes.md`（Q2/Q4/Q5）+ `tech-design.md`（T1-T3）
- 延伸：ADR-020（全局出厂真源）——本 ADR 定义项目级配置面，两不冲突：出厂真源=代码规则表，项目覆盖=文件字段
