// src/renderer/modelCatalog.js
// 模型 catalog 客户端（REQ-AGENT-100/101/102，v0.6）：renderer 侧 provider/模型/能力
// 数据源 = GET /api/settings/agent/catalog（服务端 pi-ai 静态目录单一真源——根治
// 镜像漂移 GAP-3；原 modelCapabilities.js 手写镜像表移除，REQ-102 标准 4）。
//
// - ensureCatalog()：加载 + 内存缓存（in-flight 去重，App/会话区/Settings 加载时
//   各页共享一次 GET）；**加载失败 → 缓存保持 null**（不静默放行底线：
//   isVisionModel 返回 false——附加被拒，宁阻不丢图）。
// - isVisionModel(provider, model)：catalog 查找——catalog 未加载/未知 provider/
//   未知模型 → false（保守拒绝，PRD §10.7 v0.5「renderer 主防线」语义不变）。

import { fetchCatalog } from "./api/agent.js";

let catalogCache = null; // { providers: [...] } | null（null = 未加载/加载失败）
let catalogInflight = null;

/** 加载 catalog 并缓存（失败 → null 缓存 + 抛错；调用方按「保守拒绝」处理）。 */
export async function ensureCatalog() {
  if (catalogCache) return catalogCache;
  if (!catalogInflight) {
    catalogInflight = fetchCatalog()
      .then((body) => {
        catalogCache = body ?? null;
        return catalogCache;
      })
      .catch((err) => {
        catalogCache = null; // 加载失败 → 保守拒绝（不静默放行）
        throw err;
      })
      .finally(() => {
        catalogInflight = null;
      });
  }
  return catalogInflight;
}

/** 同步读取缓存（null = 未加载/加载失败——调用方须按保守语义处理）。 */
export function getCatalog() {
  return catalogCache;
}

/** provider 条目查找（catalog 未加载/无该 provider → null）。 */
export function catalogEntry(provider) {
  if (!catalogCache || !Array.isArray(catalogCache.providers)) return null;
  return catalogCache.providers.find((p) => p.provider === provider) ?? null;
}

/** provider 的模型列表 [{model, vision, reasoning}]（未加载/无此 provider → null）。 */
export function catalogModels(provider) {
  return catalogEntry(provider)?.models ?? null;
}

/**
 * 模型是否视觉能力（附加时判定 + 发送复核数据源 = catalog，REQ-102）。
 * 保守拒绝：catalog 未加载 / provider 未知 / 模型未知 → false（宁阻不静默丢图）。
 * @param {string|null|undefined} provider
 * @param {string|null|undefined} model
 * @returns {boolean}
 */
export function isVisionModel(provider, model) {
  if (typeof provider !== "string" || provider === "") return false;
  const entry = catalogEntry(provider);
  if (!entry) return false;
  const m = (entry.models ?? []).find((mm) => mm.model === model);
  return m ? m.vision === true : false;
}
