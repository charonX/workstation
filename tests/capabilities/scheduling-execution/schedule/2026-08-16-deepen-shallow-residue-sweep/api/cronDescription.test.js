// REQ-TRACE: REQ-SCHEDULE-011
// REQ-VERSION: v1-hash:f255c1918d40e06767b8129157cdcde68091d02015b0b577fa7c03b449fa5d8f
// CAPABILITY-TRACE: scheduling-execution
// ENTITY-TRACE: schedule
// EXPECTED-TRACE: prd.md §6.3 锚点（合法 cron 描述与非法字段数报错）+ §10.2 schedulerService 导出
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as schedulerService from "../../../../../../src/services/schedulerService.js";
import * as taskService from "../../../../../../src/services/taskService.js";

describe("REQ-SCHEDULE-011 Cron 描述助手归位至 schedulerService", () => {
  it("AC1: schedulerService.getCronDescription 正确解析常见合法表达式", () => {
    // EXPECTED-TRACE: prd.md §6.3 锚点
    assert.equal(typeof schedulerService.getCronDescription, "function", "schedulerService 必须导出 getCronDescription");

    // 每分钟
    assert.equal(schedulerService.getCronDescription("* * * * *"), "Every minute");
    // 每天固定时间
    assert.equal(schedulerService.getCronDescription("0 8 * * *"), "At 08:00");
    assert.equal(schedulerService.getCronDescription("30 14 * * *"), "At 14:30");
    // 6 字段（含秒数）同样支持
    assert.equal(schedulerService.getCronDescription("0 0 8 * * *"), "At 08:00");
  });

  it("AC2: schedulerService.getCronDescription 对非法字段数的表达式抛错", () => {
    // EXPECTED-TRACE: prd.md §6.3 锚点 / §6.2 异常分支
    assert.throws(
      () => schedulerService.getCronDescription("0 8 *"),
      /Invalid cron expression: expected 5 or 6 fields/
    );
    assert.throws(
      () => schedulerService.getCronDescription("1 2 3 4 5 6 7"),
      /Invalid cron expression: expected 5 or 6 fields/
    );
  });

  it("AC3: schedules 路由直接导入 schedulerService 并生成 cronDescription", () => {
    // EXPECTED-TRACE: prd.md §10.2
    const schedulesRoutePath = path.resolve(process.cwd(), "src/http/routes/schedules.js");
    const content = fs.readFileSync(schedulesRoutePath, "utf8");
    assert.ok(
      content.includes("schedulerService.getCronDescription") ||
      (content.includes("getCronDescription") && content.includes("schedulerService")),
      "schedules 路由必须从 schedulerService 导入并调用 getCronDescription"
    );
  });

  it("AC4: taskService.getCronDescription 单行转发至 schedulerService", () => {
    // EXPECTED-TRACE: prd.md §10.2 兼容过渡
    assert.equal(typeof taskService.getCronDescription, "function", "taskService 保持转发导出");
    assert.equal(taskService.getCronDescription("0 8 * * *"), "At 08:00");
  });
});
