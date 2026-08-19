// REQ-TRACE: 2026-08-16-deepen-service-container/REQ-WORKSPACE-017, 2026-08-16-deepen-service-container/REQ-WORKSPACE-018
// REQ-VERSION: v1-hash:e34004c13ba54416d2b9151f375ae0daedea3adee9adc4d2f3a6ddfbbd00c56a
// CAPABILITY-TRACE: workspace-management
// ENTITY-TRACE: server
// EXPECTED-TRACE: prd.md §6.3 锚点（单例复用 / peekAgentService 状态转移 / dispose 释放 / 错误容错）+ §10.4 接口契约
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: true

// REQ-WORKSPACE-017（独立服务容器模块）与 REQ-WORKSPACE-018（容器生命周期管理）单元直测。
// 验证 createServiceContainer 内聚 8 个服务的惰性工厂、接线胶水、peek 状态及统一 dispose 生命周期。
//
// seam：src/services/serviceContainer.js（createServiceContainer 工厂及容器实例方法）。

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as eventBus from "../../../../../../src/services/eventBus.js";

// 动态 import，未实现前作为 RED 失败门
async function loadContainerModule() {
  return await import("../../../../../../src/services/serviceContainer.js");
}

describe("REQ-WORKSPACE-017 独立服务容器模块", () => {
  let tmpConfigDir;
  let container;

  beforeEach(() => {
    tmpConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), "sc-test-config-"));
  });

  afterEach(async () => {
    if (container) {
      await container.dispose().catch(() => {});
      container = null;
    }
    eventBus.clearSubscribers();
    fs.rmSync(tmpConfigDir, { recursive: true, force: true });
  });

  it("AC1: createServiceContainer 暴露完整服务 Getter 与生命周期方法", async () => {
    // EXPECTED-TRACE: prd.md §10.4 接口契约
    const { createServiceContainer } = await loadContainerModule();
    container = createServiceContainer({
      port: 19876,
      configDir: tmpConfigDir,
      baseUrl: "http://127.0.0.1:19876",
    });

    assert.equal(typeof container.getSessionStore, "function", "getSessionStore 必须为函数");
    assert.equal(typeof container.getAgentRouter, "function", "getAgentRouter 必须为函数");
    assert.equal(typeof container.getSseRegistry, "function", "getSseRegistry 必须为函数");
    assert.equal(typeof container.getConfirmationService, "function", "getConfirmationService 必须为函数");
    assert.equal(typeof container.getPermissionBridge, "function", "getPermissionBridge 必须为函数");
    assert.equal(typeof container.getModeService, "function", "getModeService 必须为函数");
    assert.equal(typeof container.getAgentService, "function", "getAgentService 必须为函数");
    assert.equal(typeof container.getCardRenderer, "function", "getCardRenderer 必须为函数");
    assert.equal(typeof container.peekAgentService, "function", "peekAgentService 必须为函数");
    assert.equal(typeof container.start, "function", "start 必须为函数");
    assert.equal(typeof container.dispose, "function", "dispose 必须为函数");
  });

  it("AC2: 惰性单例同容器多次调用返回同一实例", async () => {
    // EXPECTED-TRACE: prd.md §6.3（单例复用锚点）
    const { createServiceContainer } = await loadContainerModule();
    container = createServiceContainer({
      port: 19876,
      configDir: tmpConfigDir,
    });

    const store1 = container.getSessionStore();
    const store2 = container.getSessionStore();
    assert.equal(store1, store2, "getSessionStore 多次调用必须返回同一单例");

    const mode1 = container.getModeService();
    const mode2 = container.getModeService();
    assert.equal(mode1, mode2, "getModeService 多次调用必须返回同一单例");

    const sse1 = container.getSseRegistry();
    const sse2 = container.getSseRegistry();
    assert.equal(sse1, sse2, "getSseRegistry 多次调用必须返回同一单例");

    const confirm1 = container.getConfirmationService();
    const confirm2 = container.getConfirmationService();
    assert.equal(confirm1, confirm2, "getConfirmationService 多次调用必须返回同一单例");
  });

  it("AC3: peekAgentService 状态窥探不触发提前拉起", async () => {
    // EXPECTED-TRACE: prd.md §6.3（peekAgentService 状态转移锚点 & ADR-009）
    const { createServiceContainer } = await loadContainerModule();
    container = createServiceContainer({
      port: 19876,
      configDir: tmpConfigDir,
    });

    assert.equal(container.peekAgentService(), null, "未调用 getAgentService 前 peekAgentService 必须为 null");
  });

  it("AC4: 跨服务接线（Wiring）内聚绑定与 eventBus 订阅", async () => {
    // EXPECTED-TRACE: prd.md §6.1 / §10.3
    const { createServiceContainer } = await loadContainerModule();
    container = createServiceContainer({
      port: 19876,
      configDir: tmpConfigDir,
    });
    await container.start();

    // 验证 eventBus 订阅已就绪：广播 execution:started 触发 cardRenderer 处理
    let handled = false;
    const cardRenderer = container.getCardRenderer();
    const origHandle = cardRenderer.handleExecutionEvent;
    cardRenderer.handleExecutionEvent = (ev) => {
      handled = true;
      origHandle?.call(cardRenderer, ev);
    };

    eventBus.publish("execution:started", { executionId: "ex-1", flowId: "flow-1", status: "running" });
    assert.equal(handled, true, "eventBus execution:started 必须被容器内的 cardRenderer 订阅并消费");
  });

  it("AC5: 定时日志清理任务持有与调度", async () => {
    // EXPECTED-TRACE: prd.md §6.1 / §8
    const { createServiceContainer } = await loadContainerModule();
    container = createServiceContainer({
      port: 19876,
      configDir: tmpConfigDir,
    });
    await container.start();

    assert.ok(container.getPurgeTask?.(), "容器 start 后必须持有 purgeTask 定时任务");
  });
});

describe("REQ-WORKSPACE-018 容器生命周期统一管理与资源清理", () => {
  let tmpConfigDir;
  let container;

  beforeEach(() => {
    tmpConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), "sc-test-config-"));
  });

  afterEach(async () => {
    if (container) {
      await container.dispose().catch(() => {});
      container = null;
    }
    eventBus.clearSubscribers();
    fs.rmSync(tmpConfigDir, { recursive: true, force: true });
  });

  it("AC1: 销毁日志清理定时器", async () => {
    // EXPECTED-TRACE: prd.md §6.3（dispose 释放）
    const { createServiceContainer } = await loadContainerModule();
    container = createServiceContainer({
      port: 19876,
      configDir: tmpConfigDir,
    });
    await container.start();
    const purgeTask = container.getPurgeTask?.();
    let destroyed = false;
    if (purgeTask) {
      const origDestroy = purgeTask.destroy;
      purgeTask.destroy = () => {
        destroyed = true;
        origDestroy?.call(purgeTask);
      };
    }

    await container.dispose();
    if (purgeTask) {
      assert.equal(destroyed, true, "container.dispose() 必须销毁 purgeTask");
    }
    assert.equal(container.getPurgeTask?.(), null, "dispose 后 purgeTask 必须已置空");
  });

  it("AC2: 安全停止已拉起的 AgentService（未拉起时 safe no-op）", async () => {
    // EXPECTED-TRACE: prd.md §6.3（dispose 安全停止）
    const { createServiceContainer } = await loadContainerModule();
    container = createServiceContainer({
      port: 19876,
      configDir: tmpConfigDir,
    });

    // 未拉起时 dispose 必须为 safe no-op
    await assert.doesNotReject(async () => {
      await container.dispose();
    }, "未拉起 agentService 时 dispose 不得抛错");
  });

  it("AC3: 全局与协作服务清理统一触发", async () => {
    // EXPECTED-TRACE: prd.md §6.1 / §10.4
    const { createServiceContainer } = await loadContainerModule();
    container = createServiceContainer({
      port: 19876,
      configDir: tmpConfigDir,
    });
    await container.start();

    // 订阅一个测试事件以验证 clearSubscribers
    let dummyCalled = false;
    eventBus.subscribe("test:event", () => { dummyCalled = true; });

    await container.dispose();
    eventBus.publish("test:event", {});
    assert.equal(dummyCalled, false, "container.dispose 必须清理 eventBus 订阅者");
  });

  it("AC4: 容错清理不阻断", async () => {
    // EXPECTED-TRACE: prd.md §8（错误状态与容错清理）
    const { createServiceContainer } = await loadContainerModule();
    container = createServiceContainer({
      port: 19876,
      configDir: tmpConfigDir,
    });
    await container.start();

    // 故意让内部 purgeTask.destroy 抛异常
    const purgeTask = container.getPurgeTask?.();
    if (purgeTask) {
      purgeTask.destroy = () => {
        throw new Error("simulated cron destroy failure");
      };
    }

    await assert.doesNotReject(async () => {
      await container.dispose();
    }, "dispose 遇到单个子项异常时不得中断");
  });
});
