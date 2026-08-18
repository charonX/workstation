// src/services/confirmationService.js
// 确认服务兼容包装器（向后兼容，ADR-032 委派至 createPermissionAdjudicator）。

import { createPermissionAdjudicator } from "./permissionAdjudicator.js";

export function createConfirmationService(options = {}) {
  return createPermissionAdjudicator(options);
}
