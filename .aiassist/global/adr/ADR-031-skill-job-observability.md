# ADR-031：技能 job 可观测性——无前端硬超时 + 流式进度 log

- 状态：已接受
- 日期：2026-08-18
- 相关 REQ：REQ-SKILL-023（story 2026-08-18-skill-update-diagnostics，BUG-001）

## 上下文

用户 git 地址安装技能报 "Timed out waiting for skill job to finish"：`waitForJob`
硬编码 30s 超时，而真实 git clone（大仓库/慢网络）耗时可超 30s。复现确认后端
`settleJobWhen` 与前端超时解耦——前端放弃时 job 继续并在稍后成功。用户感知为安装失败，
实际成功。且安装全程无进度可见（`execFileAsync` 缓冲 git 输出到进程退出）。

## 决策

1. **作业轮询默认无超时**：`waitForJob` 默认 `timeoutMs=0`（`deadline=null`），轮询至真实
   终态；`timeoutMs>0` 的显式超时语义保留（SKILL_JOB_TIMEOUT），但不得用失败文案表达"仍在跑"。
   install 与 update 同享（同款假失败风险）。
2. **进度流式可见**：长作业用 `child_process.spawn` 逐块追加 stdout/stderr 到 `job.log`
   （运行中 getJob 即返回非空 log）；git clone 加 `--progress` 强制进度上管道。
   install job 运行中 log 非空即返回；update job 保持 REQ-021「终态才有值」契约不变
   （两通道）。
3. **真卡死兜底**：无超时 + 可见进度 + 用户手动关闭；后端 job 由既有生命周期管理。

## 后果

- 用户安装/更新慢时不再收到假失败，弹层实时显示 git 输出（进度可判）。
- 卡死场景无自动超时——代价由「可见进度 + 手动关闭」兜底（用户接受，人拍板）。
- getJob 契约分 install（运行中 log 可见）/ update（终态才有值）两通道，各走各的。

## 替代方案

- **只拉长超时（如 180s）**：简单但大仓库/卡死仍可能假失败，且无进度；否决。
- **超时后仍报"失败"但 job 继续**：误导性最强；否决。
- **进度仅终态展示**：用户安装中仍无反馈（原症状）；否决。

## 相关文件

- `src/services/skillService.js`（runGitInstallJob spawn 流式）
- `src/renderer/api/skills.js`（waitForJob timeoutMs=0 + onLog）
- `src/renderer/components/skill/InstallSkillModal.jsx`（实时进度面板）
- PRD：`.aiassist/stories/2026-08-18-skill-update-diagnostics/prd.md` §10.4/§10.5 D5
- 关联：ADR-011（技能 API 形态）
