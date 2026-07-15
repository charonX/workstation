// REQ-TRACE: codex-harness-desktop/REQ-FLOW-003, codex-harness-desktop/REQ-FLOW-016, codex-harness-desktop/REQ-FLOW-017, codex-harness-desktop/REQ-SCHEDULE-001, codex-harness-desktop/REQ-SCHEDULE-003
// REQ-VERSION: v1-hash:6d1ad5a74173976f1edf2c739c79f951e2e74e40c833a28e05922f6045f67690
// CAPABILITY-TRACE: flow-orchestration
// ENTITY-TRACE: flow
// TEST-AUTHOR: agent
// ASSERTIONS-SIGNED: false

/**
 * Shared data-testid and ARIA role constants for E2E tests.
 * Prefer semantic locators (getByRole/getByLabel/getByText) over testids;
 * use testids only when semantic locators are insufficient.
 */

module.exports = {
  // Navigation / Layout
  SIDEBAR: "[data-testid='sidebar']",
  SETTINGS_LINK: "[data-testid='nav-settings']",
  WORKSPACE_LINK: "[data-testid='nav-workspace']",
  FLOWS_LINK: "[data-testid='nav-flows']",
  EXECUTIONS_LINK: "[data-testid='nav-executions']",
  SKILLS_LINK: "[data-testid='nav-skills']",
  DASHBOARD_LINK: "[data-testid='nav-dashboard']",

  // TopBar
  TOPBAR: "[data-testid='topbar']",
  TOPBAR_LOGO: "[data-testid='topbar-logo']",
  TOPBAR_SEARCH_INPUT: "[data-testid='topbar-search-input']",
  TOPBAR_LANGUAGE_BUTTON: "[data-testid='topbar-language-button']",
  TOPBAR_THEME_BUTTON: "[data-testid='topbar-theme-button']",
  TOPBAR_NOTIFICATIONS_BUTTON: "[data-testid='topbar-notifications-button']",
  TOPBAR_SETTINGS_BUTTON: "[data-testid='topbar-settings-button']",

  // Settings
  SETTINGS_FORM: "[data-testid='settings-form']",
  WORKSPACE_ROOT_INPUT: "[data-testid='workspace-root-input']",
  WORKSPACE_ROOT_BROWSE_BUTTON: "[data-testid='workspace-root-input-browse']",
  SKILL_REPO_PATH_INPUT: "[data-testid='skill-repo-path-input']",
  SKILL_REPO_PATH_BROWSE_BUTTON: "[data-testid='skill-repo-path-input-browse']",
  THEME_SELECT: "[data-testid='theme-select']",
  LANGUAGE_SELECT: "[data-testid='language-select']",
  DENSITY_SELECT: "[data-testid='density-select']",
  SAVE_SETTINGS_BUTTON: "[data-testid='save-settings-button']",

  // Workspace / Projects
  ADD_PROJECT_BUTTON: "[data-testid='add-project-button']",
  PROJECT_FORM_MODAL: "[data-testid='project-form-modal']",
  PROJECT_NAME_INPUT: "[data-testid='project-name-input']",
  PROJECT_LOCAL_PATH_INPUT: "[data-testid='project-local-path-input']",
  PROJECT_LOCAL_PATH_BROWSE_BUTTON: "[data-testid='project-local-path-input-browse']",
  PROJECT_REPO_URL_INPUT: "[data-testid='project-repo-url-input']",
  PROJECT_BRANCH_INPUT: "[data-testid='project-branch-input']",
  SUBMIT_PROJECT_BUTTON: "[data-testid='submit-project-button']",
  PROJECT_CARD: "[data-testid='project-card']",
  PROJECT_DELETE_BUTTON: "[data-testid='project-delete-button']",
  CONFIGURE_SKILLS_BUTTON: "[data-testid='configure-skills-button']",
  PROJECT_DETAIL_MODAL: "[data-testid='project-detail-modal']",
  SKILL_LINK_CHECKBOX: "[data-testid='skill-link-checkbox']",

  // Flows
  NEW_FLOW_BUTTON: "[data-testid='new-flow-button']",
  FLOW_FORM_MODAL: "[data-testid='flow-form-modal']",
  FLOW_NAME_INPUT: "[data-testid='flow-name-input']",
  FLOW_PROJECT_SELECT: "[data-testid='flow-project-select']",
  SUBMIT_FLOW_BUTTON: "[data-testid='submit-flow-button']",
  FLOW_CARD: "[data-testid='flow-card']",
  FLOW_DELETE_BUTTON: "[data-testid='flow-delete-button']",

  // Flow Editor
  FLOW_EDITOR_PAGE: "[data-testid='flow-editor-page']",
  NODE_PALETTE: "[data-testid='node-palette']",
  FLOW_CANVAS: "[data-testid='flow-canvas']",
  FLOW_NODE: "[data-testid='flow-node']",
  NODE_DELETE_BUTTON: "[data-testid='node-delete-button']",
  PROPERTIES_PANEL: "[data-testid='properties-panel']",
  NODE_NAME_INPUT: "[data-testid='node-name-input']",
  NODE_OUTPUT_VARIABLE_INPUT: "[data-testid='node-output-variable-input']",
  AGENT_MODEL_SELECT: "[data-testid='agent-model-select']",
  AGENT_SYSTEM_PROMPT_TEXTAREA: "[data-testid='agent-system-prompt-textarea']",
  CONDITION_EXPRESSION_INPUT: "[data-testid='condition-expression-input']",
  FOREACH_ARRAY_INPUT: "[data-testid='foreach-array-input']",
  WHILE_EXPRESSION_INPUT: "[data-testid='while-expression-input']",
  OUTPUT_PATH_INPUT: "[data-testid='output-path-input']",
  RUN_FLOW_BUTTON: "[data-testid='run-flow-button']",
  PUBLISH_FLOW_BUTTON: "[data-testid='publish-flow-button']",
  FLOW_STATUS_BADGE: "[data-testid='flow-status-badge']",
  DEBUG_FLOW_BUTTON: "[data-testid='debug-flow-button']",
  DEBUG_MODAL: "[data-testid='debug-modal']",
  DEBUG_OUTPUT_PANEL: "[data-testid='debug-output-panel']",
  DEBUG_CLOSE_BUTTON: "[data-testid='debug-close-button']",
  ZOOM_IN_BUTTON: "[data-testid='zoom-in-button']",
  ZOOM_OUT_BUTTON: "[data-testid='zoom-out-button']",
  ZOOM_RESET_BUTTON: "[data-testid='zoom-reset-button']",

  // Executions
  EXECUTION_ROW: "[data-testid='execution-row']",
  EXECUTION_DETAIL_PANEL: "[data-testid='execution-detail-panel']",
  LOGS_TAB: "[data-testid='logs-tab']",
  VARIABLES_TAB: "[data-testid='variables-tab']",
  OUTPUT_TAB: "[data-testid='output-tab']",

  // Skills
  INSTALL_SKILL_BUTTON: "[data-testid='install-skill-button']",
  INSTALL_SKILL_MODAL: "[data-testid='install-skill-modal']",
  SKILL_SOURCE_SELECT: "[data-testid='skill-source-select']",
  SKILL_IDENTIFIER_INPUT: "[data-testid='skill-identifier-input']",
  SUBMIT_INSTALL_SKILL_BUTTON: "[data-testid='submit-install-skill-button']",
  SKILL_TABLE: "[data-testid='skill-table']",
  SKILL_ROW: "[data-testid='skill-row']",
  SKILL_DELETE_BUTTON: "[data-testid='skill-delete-button']",
  SKILL_DETAIL_MODAL: "[data-testid='skill-detail-modal']",
  SKILL_TAB_OVERVIEW: "[data-testid='skill-tab-overview']",
  SKILL_TAB_PARAMETERS: "[data-testid='skill-tab-parameters']",
  SKILL_TAB_EXAMPLES: "[data-testid='skill-tab-examples']",
  SKILL_TAB_README: "[data-testid='skill-tab-readme']",

  // Shared / Confirmation Dialog
  CONFIRM_DIALOG: "[data-testid='confirm-dialog']",
  CONFIRM_OK_BUTTON: "[data-testid='confirm-ok-button']",
  CONFIRM_CANCEL_BUTTON: "[data-testid='confirm-cancel-button']",

  // Dashboard
  DASHBOARD_PAGE: "[data-testid='dashboard-page']",
  PROJECT_COUNT_CARD: "[data-testid='project-count-card']",
  ACTIVE_SCHEDULE_COUNT_CARD: "[data-testid='active-schedule-count-card']",
  RECENT_RUN_COUNT_CARD: "[data-testid='recent-run-count-card']",
  SUCCESS_RATE_CARD: "[data-testid='success-rate-card']",
  RECENT_EXECUTIONS_LIST: "[data-testid='recent-executions-list']",
};
