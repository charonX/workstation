/**
 * OPC Workstation UX Prototype Interactions
 * Shared vanilla JS for modal, tabs, radio groups, toggles, theme switching, i18n.
 */

(function () {
  'use strict';

  const I18N = {
    en: {
      dashboard: 'Dashboard',
      projects: 'Projects',
      flows: 'Flows',
      executions: 'Executions',
      skills: 'Skills',
      settings: 'Settings',
      newTask: 'New Task',
      newFlow: 'New Flow',
      addProject: 'Add Project',
      addSkill: 'Add Skill',
      searchPlaceholder: 'Search projects, flows, executions…',
      recentExecutions: 'Recent Executions',
      activeSchedules: 'Active Schedules',
      quickProjects: 'Quick Projects',
      all: 'All',
      recent: 'Recent',
      viewAll: 'View all',
      lastRun: 'Last run',
      duration: 'Duration',
      projectsCount: 'Projects',
      schedulesCount: 'Active Schedules',
      recentRuns: 'Recent Runs',
      successRate: 'Success Rate',
      taskName: 'Task Name',
      project: 'Project',
      flow: 'Flow',
      trigger: 'Trigger',
      cronExpression: 'Cron Expression',
      inputVariables: 'Input Variables (JSON)',
      manual: 'Manual',
      scheduled: 'Scheduled',
      cancel: 'Cancel',
      createTask: 'Create Task',
      saveChanges: 'Save Changes',
      workspaceRoot: 'Workspace Root Directory',
      skillRepoPath: 'Skill Repository Path',
      theme: 'Theme',
      density: 'Density',
      light: 'Light',
      dark: 'Dark',
      system: 'System',
      compact: 'Compact',
      comfortable: 'Comfortable',
      browse: 'Browse',
      saveLinks: 'Save Links',
      manage: 'Manage',
      installSource: 'Install Source',
      packagePluginPath: 'Package / Plugin / Path',
      installLocation: 'Install Location',
      projectSyncMode: 'Project Sync Mode',
      manualLink: 'Manual Link',
      autoLinkAll: 'Auto-link All',
      selectedProjects: 'Selected Projects',
      installSkill: 'Install Skill',
      source: 'Source',
      localDirectory: 'Local Directory',
      gitRepository: 'Git Repository',
      repositoryURL: 'Repository URL',
      branch: 'Branch',
      projectName: 'Project Name',
      localPath: 'Local Path',
      linkedProjects: 'Linked Projects',
      syncMode: 'Sync Mode',
      execution: 'Execution',
      logs: 'Logs',
      variables: 'Variables',
      output: 'Output',
      rerun: 'Rerun',
      edit: 'Edit',
      run: 'Run',
      nodes: 'nodes',
      runs: 'runs',
      updated: 'updated',
      flowsCount: 'flows',
      refreshRepo: 'Refresh Repo',
      resetAllData: 'Reset All Data',
      openLogDirectory: 'Open Log Directory',
      about: 'About',
      version: 'Version',
      dataDirectory: 'Data Directory',
      dangerZone: 'Danger Zone',
      appearance: 'Appearance',
      view: 'View',
      category: 'Category',
      overview: 'Overview',
      parameters: 'Parameters',
      examples: 'Examples',
      readme: 'README',
      author: 'Author',
      tags: 'Tags',
      description: 'Description',
      configureSkills: 'Configure Skills',
      projectSkills: 'Project Skills',
      availableSkills: 'Available Skills',
      noDescription: 'No description provided.'
    },
    zh: {
      dashboard: '总览',
      projects: '项目',
      flows: '流程',
      executions: '执行历史',
      skills: '技能',
      settings: '设置',
      newTask: '新建任务',
      newFlow: '新建流程',
      addProject: '添加项目',
      addSkill: '添加技能',
      searchPlaceholder: '搜索项目、流程、执行历史…',
      recentExecutions: '最近执行',
      activeSchedules: '活跃调度',
      quickProjects: '快捷项目',
      all: '全部',
      recent: '最近',
      viewAll: '查看全部',
      lastRun: '上次运行',
      duration: '耗时',
      projectsCount: '项目数',
      schedulesCount: '活跃调度',
      recentRuns: '最近运行',
      successRate: '成功率',
      taskName: '任务名称',
      project: '项目',
      flow: '流程',
      trigger: '触发方式',
      cronExpression: 'Cron 表达式',
      inputVariables: '输入变量（JSON）',
      manual: '手动',
      scheduled: '定时',
      cancel: '取消',
      createTask: '创建任务',
      saveChanges: '保存更改',
      workspaceRoot: 'Workspace 根目录',
      skillRepoPath: 'Skill 仓库路径',
      theme: '主题',
      density: '密度',
      light: '浅色',
      dark: '深色',
      system: '跟随系统',
      compact: '紧凑',
      comfortable: '舒适',
      browse: '浏览',
      saveLinks: '保存链接',
      manage: '管理',
      installSource: '安装来源',
      packagePluginPath: '包 / 插件 / 路径',
      installLocation: '安装位置',
      projectSyncMode: '项目同步模式',
      manualLink: '手动链接',
      autoLinkAll: '自动链接全部',
      selectedProjects: '选定项目',
      installSkill: '安装技能',
      source: '来源',
      localDirectory: '本地目录',
      gitRepository: 'Git 仓库',
      repositoryURL: '仓库地址',
      branch: '分支',
      projectName: '项目名称',
      localPath: '本地路径',
      linkedProjects: '已链接项目',
      syncMode: '同步模式',
      execution: '执行',
      logs: '日志',
      variables: '变量',
      output: '输出',
      rerun: '重新运行',
      edit: '编辑',
      run: '运行',
      nodes: '个节点',
      runs: '次运行',
      updated: '更新于',
      flowsCount: '个流程',
      refreshRepo: '刷新仓库',
      resetAllData: '重置所有数据',
      openLogDirectory: '打开日志目录',
      about: '关于',
      version: '版本',
      dataDirectory: '数据目录',
      dangerZone: '危险区域',
      appearance: '外观',
      view: '查看',
      category: '分类',
      overview: '概览',
      parameters: '参数',
      examples: '示例',
      readme: 'README',
      author: '作者',
      tags: '标签',
      description: '描述',
      configureSkills: '配置技能',
      projectSkills: '项目技能',
      availableSkills: '可用技能',
      noDescription: '暂无描述。'
    }
  };

  let currentLang = 'en';

  /* === I18n === */
  function applyI18n(lang) {
    currentLang = lang;
    document.documentElement.setAttribute('lang', lang);

    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      const text = I18N[lang][key];
      if (text !== undefined) {
        // For inputs/textareas, update placeholder if data-i18n-target is placeholder
        if (el.getAttribute('data-i18n-target') === 'placeholder') {
          el.setAttribute('placeholder', text);
        } else {
          el.textContent = text;
        }
      }
    });

    document.querySelectorAll('[data-lang-toggle]').forEach((btn) => {
      btn.textContent = lang === 'en' ? '中' : 'EN';
    });
  }

  function initLangToggles() {
    document.querySelectorAll('[data-lang-toggle]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const next = currentLang === 'en' ? 'zh' : 'en';
        applyI18n(next);
        try { localStorage.setItem('opc-lang', next); } catch (e) {}
      });
    });

    // Restore saved language
    try {
      const saved = localStorage.getItem('opc-lang');
      if (saved && I18N[saved]) {
        applyI18n(saved);
        return;
      }
    } catch (e) {}

    applyI18n(currentLang);
  }

  /* === Theme Toggle === */
  function initThemeToggles() {
    document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const html = document.documentElement;
        const current = html.getAttribute('data-theme') || 'light';
        const next = current === 'light' ? 'dark' : 'light';
        html.setAttribute('data-theme', next);
        try { localStorage.setItem('opc-theme', next); } catch (e) {}
      });
    });

    try {
      const saved = localStorage.getItem('opc-theme');
      if (saved) document.documentElement.setAttribute('data-theme', saved);
    } catch (e) {}
  }

  /* === Modals === */
  function initModals() {
    const modals = document.querySelectorAll('[data-modal]');

    // Open buttons
    document.querySelectorAll('[data-open-modal]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-open-modal');
        const modal = document.querySelector(`[data-modal="${id}"]`);
        if (modal) {
          modal.style.display = 'flex';
          document.body.style.overflow = 'hidden';
        }
      });
    });

    // Close buttons
    document.querySelectorAll('[data-modal] .icon-btn, [data-close-modal]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const modal = btn.closest('[data-modal]');
        if (modal) {
          modal.style.display = 'none';
          document.body.style.overflow = '';
        }
      });
    });

    // Click overlay to close
    modals.forEach((modal) => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          modal.style.display = 'none';
          document.body.style.overflow = '';
        }
      });
    });

    // Escape to close
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        modals.forEach((modal) => {
          if (modal.style.display === 'flex') {
            modal.style.display = 'none';
            document.body.style.overflow = '';
          }
        });
      }
    });

    // Hide all modals on load
    modals.forEach((modal) => {
      modal.style.display = 'none';
    });
  }

  /* === Tabs === */
  function initTabs() {
    const groups = {};

    document.querySelectorAll('[data-tab]').forEach((tab) => {
      const groupName = tab.closest('[data-tab-group]')?.getAttribute('data-tab-group');
      if (!groupName) return;
      if (!groups[groupName]) groups[groupName] = [];
      groups[groupName].push(tab);

      tab.addEventListener('click', () => {
        const panelId = tab.getAttribute('data-tab');

        // Update tab active states
        groups[groupName].forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');

        // Update panels within the same container
        const container = tab.closest('[data-tab-group]');
        if (container) {
          container.querySelectorAll('[data-tab-panel]').forEach((panel) => {
            panel.style.display = panel.getAttribute('data-tab-panel') === panelId ? 'block' : 'none';
          });
        }
      });
    });

    // Initialize first tab of each group if no active tab
    Object.values(groups).forEach((tabs) => {
      const container = tabs[0].closest('[data-tab-group]');
      const hasActive = tabs.some((t) => t.classList.contains('active'));
      if (!hasActive && container) {
        tabs[0].classList.add('active');
        const firstPanelId = tabs[0].getAttribute('data-tab');
        container.querySelectorAll('[data-tab-panel]').forEach((panel) => {
          panel.style.display = panel.getAttribute('data-tab-panel') === firstPanelId ? 'block' : 'none';
        });
      }
    });
  }

  /* === Radio Groups === */
  function initRadioGroups() {
    document.querySelectorAll('[data-radio-group]').forEach((group) => {
      const options = group.querySelectorAll('[data-radio-option]');
      options.forEach((option) => {
        option.addEventListener('click', () => {
          options.forEach((o) => o.classList.remove('active'));
          option.classList.add('active');
        });
      });
    });
  }

  /* === Toggles === */
  function initToggles() {
    document.querySelectorAll('[data-toggle]').forEach((toggle) => {
      toggle.addEventListener('click', () => {
        toggle.classList.toggle('off');
      });
    });
  }

  /* === Initialize === */
  function init() {
    initThemeToggles();
    initLangToggles();
    initModals();
    initTabs();
    initRadioGroups();
    initToggles();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
