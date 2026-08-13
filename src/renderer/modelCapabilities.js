// src/renderer/modelCapabilities.js
// 模型能力判定（renderer 侧静态表）——「不静默丢图」renderer 主防线的能力数据源
// （PRD §10.7 v0.5 人拍板：UI 是唯一合法附加入口，视觉复核 = renderer 主防线）。
//
// 数据来源 = pi-ai 静态目录事实（@earendil-works/pi-ai providers/all
// builtinModels().input.includes("image")；2026-08-13 目录核对）：
// - deepseek 全系 text-only（deepseek-v4-flash / deepseek-v4-pro）；
// - kimi 系混合：k2 时代 preview（kimi-k2-0711-preview / k2-0905-preview /
//   k2-thinking / k2-thinking-turbo / k2-turbo-preview）text-only；k2.5 起
//   （k2.5 / k2.6 / k2.7-code / k2.7-code-highspeed / k3）text+image。
// 服务端 GET /api/settings/agent 不回传能力数据（签核契约无该字段），故 renderer
// 以本静态表判定；拉取路径（添加条目表单）能力数据来自 fetchModels 实时结果。
//
// 未知模型回退 = 保守拒绝（vision:false）——阻止附加提示引导，宁可不加也不
// 「静默丢图」（故事初衷：pi-ai 对非视觉模型传图静默忽略必须堵住）。

// provider → 视觉模型集合（镜像 pi-ai 目录 input.includes("image")）。
const VISION_MODELS = {
  deepseek: new Set([]),
  moonshotai: new Set([
    "kimi-k2.5",
    "kimi-k2.6",
    "kimi-k2.7-code",
    "kimi-k2.7-code-highspeed",
    "kimi-k3",
  ]),
  "moonshotai-cn": new Set([
    "kimi-k2.5",
    "kimi-k2.6",
    "kimi-k2.7-code",
    "kimi-k2.7-code-highspeed",
    "kimi-k3",
  ]),
};

/**
 * 模型是否视觉能力（会话当前模型判定；Settings 条目 chip 能力点共用）。
 * @param {string|null|undefined} provider
 * @param {string|null|undefined} model
 * @returns {boolean}
 */
export function isVisionModel(provider, model) {
  if (typeof provider !== "string" || provider === "") return true; // 未定会话不阻止
  const set = VISION_MODELS[provider];
  if (!set) return true; // 未知 provider（faux 等测试 seam）→ 不阻止
  return set.has(typeof model === "string" ? model : "");
}
