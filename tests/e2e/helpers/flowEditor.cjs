// REQ-TRACE: REQ-FLOW-018, REQ-FLOW-019, REQ-FLOW-020, REQ-FLOW-021, REQ-FLOW-022, REQ-FLOW-026
// REQ-VERSION: v1-hash:faea1df8
// CAPABILITY-TRACE: flow-orchestration
// ENTITY-TRACE: flow
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

/**
 * Shared helpers for Flow Editor node-config E2E specs
 * (2026-07-16-flow-refinement, Slice S5a).
 *
 * Signoff decision 6: E2E specs sign behavior-level assertions only;
 * concrete URLs / locators / seeding are determined at BUILD time.
 * These helpers seed flows via the REST API (deterministic node ids)
 * and navigate through the real UI.
 */

const { expect } = require("@playwright/test");
const { createFlow } = require("./seed.cjs");
const locators = require("./locators.cjs");

const FLOW_SAVE_SUCCESS = "[data-testid='flow-save-success']";
const FLOW_SAVE_ERROR = "[data-testid='flow-save-error']";
const PICKER_DROPDOWN = "[data-testid='variable-picker-dropdown']";
const ADD_VARIABLE_BUTTON = "[data-testid='add-variable-button']";
const REMOVE_VARIABLE_BUTTON = "[data-testid='remove-variable-button']";

/**
 * Seed a flow via API and open it in the Flow Editor through the UI.
 */
async function openFlowInEditor(firstWindow, apiBaseUrl, { projectId, name, nodes = [], edges = [] }) {
  const flow = await createFlow(apiBaseUrl, { name, projectId, nodes, edges });
  await firstWindow.click(locators.FLOWS_LINK);
  await firstWindow
    .locator(locators.FLOW_CARD)
    .filter({ hasText: name })
    .click();
  await expect(firstWindow.locator(locators.FLOW_EDITOR_PAGE)).toBeVisible();
  await expect(firstWindow.locator(locators.FLOW_CANVAS)).toBeVisible();
  return flow;
}

/**
 * Add a node by clicking a palette button (category label or item).
 * Palette names: "Trigger" (category), "Condition" (item), "Agent" (item).
 */
async function addNodeFromPalette(firstWindow, buttonName) {
  await firstWindow
    .locator(locators.NODE_PALETTE)
    .getByRole("button", { name: buttonName })
    .click();
}

function nodeByIndex(firstWindow, index) {
  return firstWindow.locator(locators.FLOW_NODE).nth(index);
}

function nodeById(firstWindow, id) {
  return firstWindow.locator(`[data-node-id="${id}"]`);
}

async function clickSave(firstWindow) {
  await firstWindow.getByRole("button", { name: "Save", exact: true }).click();
}

/**
 * Click the flow-level Save button and expect the success feedback.
 */
async function saveFlow(firstWindow) {
  await clickSave(firstWindow);
  await expect(firstWindow.locator(FLOW_SAVE_SUCCESS)).toBeVisible();
}

function pickerDropdown(firstWindow) {
  return firstWindow.locator(PICKER_DROPDOWN);
}

async function openVariablePicker(firstWindow) {
  await firstWindow.getByRole("button", { name: /insert variable/i }).click();
  const dropdown = pickerDropdown(firstWindow);
  await expect(dropdown).toBeVisible();
  return dropdown;
}

module.exports = {
  FLOW_SAVE_SUCCESS,
  FLOW_SAVE_ERROR,
  PICKER_DROPDOWN,
  ADD_VARIABLE_BUTTON,
  REMOVE_VARIABLE_BUTTON,
  openFlowInEditor,
  addNodeFromPalette,
  nodeByIndex,
  nodeById,
  clickSave,
  saveFlow,
  pickerDropdown,
  openVariablePicker,
};
