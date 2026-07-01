// Codex Harness interactive prototype — Vanilla JS
// Uses design system tokens from tokens.css (dark/light themes)

// === State ===
const state = {
  activeScreen: "workspace",
  theme: "dark",
  projectFilter: "",
  workspaceRoot: "~/codex-harness-workspace",
  skills: [],
  selectedSkill: null,
  selectedNode: null,
  zoom: 1,
  running: false,
  selectedExecution: null,
  activeTab: "logs"
};

// === Mock Data ===
const mockData = {
  workspace: { name: "My Workspace" },
  projects: [
    { id: "p1", name: "热点新闻抓取", description: "定时抓取并总结热点新闻", updatedAt: "2h ago" },
    { id: "p2", name: "TikTok 红人筛选", description: "分析榜单异常值并筛选红人", updatedAt: "1d ago" },
    { id: "p3", name: "网站内容更新", description: "自动更新博客与文档站点", updatedAt: "3d ago" }
  ],
  skills: [
    { id: "s1", name: "news-fetcher", description: "抓取新闻源并提取正文", repoPath: "~/.codex-harness/skills/news-fetcher", linkedTo: ["p1"] },
    { id: "s2", name: "tiktok-analyzer", description: "分析 TikTok 公开数据", repoPath: "~/.codex-harness/skills/tiktok-analyzer", linkedTo: ["p2"] },
    { id: "s3", name: "markdown-writer", description: "根据结构化数据生成 Markdown", repoPath: "~/.codex-harness/skills/markdown-writer", linkedTo: ["p1", "p3"] },
    { id: "s4", name: "http-client", description: "通用 HTTP 请求封装", repoPath: "~/.codex-harness/skills/http-client", linkedTo: [] }
  ],
  flow: {
    name: "热点新闻抓取",
    projectId: "p1",
    nodes: [
      { id: "n1", type: "trigger", subtype: "schedule", title: "Schedule Trigger", summary: "Every day at 08:00", x: 80, y: 200 },
      { id: "n2", type: "data", subtype: "http", title: "HTTP Request", summary: "GET news.api/top", x: 320, y: 200 },
      { id: "n3", type: "data", subtype: "json", title: "JSON Parse", summary: "Extract articles[]", x: 560, y: 200 },
      { id: "n4", type: "agent", subtype: "codex", title: "Codex Agent", summary: "Summarize & grade", x: 800, y: 200 },
      { id: "n5", type: "logic", subtype: "condition", title: "Condition", summary: "score > 0.7", x: 1040, y: 200 },
      { id: "n6", type: "output", subtype: "save", title: "Save File", summary: "~/output/news.md", x: 1280, y: 200 }
    ],
    edges: [
      { from: "n1", to: "n2" },
      { from: "n2", to: "n3" },
      { from: "n3", to: "n4" },
      { from: "n4", to: "n5" },
      { from: "n5", to: "n6" }
    ]
  },
  nodePalette: [
    { category: "Trigger", items: ["Schedule", "Manual", "Webhook"] },
    { category: "Agent", items: ["Claude Code", "Codex"] },
    { category: "Data", items: ["HTTP Request", "JSON Parse", "File Read"] },
    { category: "Logic", items: ["Condition", "Loop", "Subflow"] },
    { category: "Output", items: ["Log", "Notification", "Save File"] }
  ],
  executions: [
    { id: "e1", flowName: "热点新闻抓取", projectName: "热点新闻抓取", startedAt: "2026-07-01 08:00:12", endedAt: "2026-07-01 08:00:45", status: "success", duration: "33s", nodesRun: 6 },
    { id: "e2", flowName: "热点新闻抓取", projectName: "热点新闻抓取", startedAt: "2026-06-30 08:00:05", endedAt: "2026-06-30 08:00:52", status: "success", duration: "47s", nodesRun: 6 },
    { id: "e3", flowName: "热点新闻抓取", projectName: "热点新闻抓取", startedAt: "2026-06-29 08:00:00", endedAt: "2026-06-29 08:00:18", status: "error", duration: "18s", nodesRun: 3 },
    { id: "e4", flowName: "TikTok 红人筛选", projectName: "TikTok 红人筛选", startedAt: "2026-06-28 20:15:00", endedAt: "2026-06-28 20:16:10", status: "success", duration: "70s", nodesRun: 8 }
  ],
  logs: [
    { time: "08:00:12", node: "Schedule Trigger", status: "success", message: "Cron matched, execution started" },
    { time: "08:00:13", node: "HTTP Request", status: "success", message: "GET news.api/top → 200 OK (12 KB)" },
    { time: "08:00:15", node: "JSON Parse", status: "success", message: "Extracted 8 articles" },
    { time: "08:00:18", node: "Codex Agent", status: "running", message: "Summarizing and grading articles..." },
    { time: "08:00:42", node: "Codex Agent", status: "success", message: "Output: agent_result (8 scored summaries)" },
    { time: "08:00:43", node: "Condition", status: "success", message: "5 articles passed score > 0.7" },
    { time: "08:00:45", node: "Save File", status: "success", message: "Wrote ~/output/news.md" }
  ]
};

state.skills = JSON.parse(JSON.stringify(mockData.skills));
state.selectedNode = mockData.flow.nodes[3];
state.selectedExecution = mockData.executions[0];

const helpers = {
  statusColor(status) {
    if (status === "success") return "var(--ch-success)";
    if (status === "error") return "var(--ch-error)";
    if (status === "running") return "var(--ch-warning)";
    return "var(--ch-text-tertiary)";
  },
  nodeTypeColor(subtype) {
    const map = { schedule: "var(--ch-trigger)", http: "var(--ch-info)", json: "var(--ch-info)", codex: "var(--ch-codex)", claude: "var(--ch-skill)", condition: "var(--ch-warning)", save: "var(--ch-output)" };
    return map[subtype] || "var(--ch-text-secondary)";
  },
  escape(str) {
    return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
};

// === Icons ===
const iconSvgs = {
  logo: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zm10 2-4.35-4.35',
  play: 'M8 5v14l11-7z',
  bell: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9m3 13a1.94 1.94 0 0 0 3.4 0',
  sun: 'M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z',
  moon: 'M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z',
  plus: 'M12 5v14M5 12h14',
  folder: 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z',
  git: 'M12 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM6 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm12 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM6 8v2a3 3 0 0 0 3 3h6a3 3 0 0 1 3 3v2',
  cube: 'M21 16-9 5-9-5V8l9-5 9 5v8zm-18-8 9 5 9-5M12 13V3',
  flow: 'M3 3h6v6H3zm12 0h6v6h-6zM3 15h6v6H3zm12 0h6v6h-6zM9 6h6M9 18h6M6 9v6m12-6v6',
  logs: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zm0 0v6h6M16 13H8m8 4H8m-6-8H8',
  link: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
  unlink: 'm18.84 12.25 1.72-1.71a5 5 0 0 0-7.07-7.07l-1.71 1.71M5.16 11.75l-1.72 1.71a5 5 0 0 0 7.07 7.07l1.71-1.71M14 3l7 7M3 14l7 7',
  trash: 'M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2',
  zoomIn: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zm10 2-4.35-4.35M11 8v6M8 11h6',
  zoomOut: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zm10 2-4.35-4.35M8 11h6',
  fit: 'M15 3h6v6M9 21H3v-6m18-6-7 7M3 15l7-7',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm7-3h.01M4.22 4.22l.01.01M4.22 19.78l.01-.01M19.78 4.22l-.01.01M19.78 19.78l-.01-.01M12 2v2m0 16v2M2 12h2m16 0h2'
};

function icon(name, size = 16) {
  const d = iconSvgs[name];
  if (!d) return "";
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${d}" /></svg>`;
}

// === UI Components ===
function statusDot(status, size = 8, extraStyle = "") {
  const pulse = status === "running" ? "animation:pulse 1.5s infinite" : "";
  return `<span style="display:inline-block;width:${size}px;height:${size}px;border-radius:50%;background:${helpers.statusColor(status)};${pulse};${extraStyle}"></span>`;
}

function badge(text, color = "var(--ch-text-secondary)", bg = "var(--ch-surface-high)") {
  return `<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:var(--ch-radius-full);font-size:var(--ch-text-xs);font-weight:600;color:${color};background:${bg}">${helpers.escape(text)}</span>`;
}

const styles = {
  pageHeader: "display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--ch-space-6)",
  pageTitle: "font-size:var(--ch-text-xl);font-weight:700",
  pageSubtitle: "color:var(--ch-text-secondary);font-size:var(--ch-text-base);margin-top:var(--ch-space-1)",
  grid2: "display:grid;grid-template-columns:repeat(auto-fill, minmax(320px, 1fr));gap:var(--ch-space-4)",
  table: "width:100%;border-collapse:collapse;font-size:var(--ch-text-base)",
  th: "text-align:left;padding:var(--ch-space-3) var(--ch-space-4);color:var(--ch-text-secondary);font-weight:600;border-bottom:1px solid var(--ch-border)",
  td: "padding:var(--ch-space-3) var(--ch-space-4);border-bottom:1px solid var(--ch-border);color:var(--ch-text)",
  input: "width:100%;background:var(--ch-surface-highest);border:1px solid var(--ch-border);border-radius:var(--ch-radius-md);padding:8px var(--ch-space-3);color:var(--ch-text);font-size:var(--ch-text-base);outline:none",
  textarea: "width:100%;min-height:120px;background:var(--ch-surface-highest);border:1px solid var(--ch-border);border-radius:var(--ch-radius-md);padding:var(--ch-space-3);color:var(--ch-text);font-size:var(--ch-text-base);font-family:var(--ch-font-mono);outline:none;resize:vertical",
  label: "display:block;font-size:var(--ch-text-sm);font-weight:600;color:var(--ch-text-secondary);margin-bottom:var(--ch-space-2)"
};

function btnPrimary(label, iconName = null, attrs = "") {
  return `<button ${attrs} style="background:var(--ch-accent);color:var(--ch-accent-text);border:none;border-radius:var(--ch-radius-md);padding:6px 14px;font-size:var(--ch-text-base);font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:6px">${iconName ? icon(iconName, 14) : ""}${helpers.escape(label)}</button>`;
}

function btnSecondary(label, iconName = null, attrs = "") {
  return `<button ${attrs} style="background:transparent;border:1px solid var(--ch-border);color:var(--ch-text);border-radius:var(--ch-radius-md);padding:6px 12px;font-size:var(--ch-text-base);cursor:pointer;display:inline-flex;align-items:center;gap:6px">${iconName ? icon(iconName, 14) : ""}${helpers.escape(label)}</button>`;
}

function btnIcon(iconName, attrs = "") {
  return `<button ${attrs} style="background:transparent;border:1px solid var(--ch-border);color:var(--ch-text-secondary);border-radius:var(--ch-radius-md);width:28px;height:28px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center">${icon(iconName, 14)}</button>`;
}

function btnGhost(iconName, attrs = "") {
  return `<button ${attrs} style="background:transparent;border:none;color:var(--ch-text-secondary);border-radius:var(--ch-radius-md);padding:6px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center">${icon(iconName, 14)}</button>`;
}

function card(content) {
  return `<div style="background:var(--ch-surface);border:1px solid var(--ch-border);border-radius:var(--ch-radius-lg);padding:var(--ch-space-4)">${content}</div>`;
}

// === Screens ===
function topbar() {
  const projectLabel = state.activeScreen === "flows" ? "热点新闻抓取" : "";
  const themeIcon = state.theme === "dark" ? "sun" : "moon";
  return `<div style="grid-column:1 / -1;height:var(--ch-topbar-height);background:var(--ch-surface);border-bottom:1px solid var(--ch-border);display:flex;align-items:center;justify-content:space-between;padding:0 var(--ch-space-4);flex-shrink:0">
    <div style="display:flex;align-items:center;gap:var(--ch-space-4)">
      <div style="font-weight:700;font-size:var(--ch-text-md);color:var(--ch-text);display:flex;align-items:center;gap:var(--ch-space-2)">${icon("logo", 20)} Codex Harness</div>
      ${projectLabel ? `<div style="color:var(--ch-text-secondary);font-size:var(--ch-text-base)">${projectLabel}</div>` : ""}
    </div>
    <div style="display:flex;align-items:center;gap:var(--ch-space-3)">
      <div style="display:flex;align-items:center;gap:var(--ch-space-2);background:var(--ch-surface-highest);border:1px solid var(--ch-border);border-radius:var(--ch-radius-md);padding:4px var(--ch-space-3);color:var(--ch-text-secondary);font-size:var(--ch-text-base)">${icon("search", 14)}<input style="background:transparent;border:none;outline:none;color:var(--ch-text);font-size:var(--ch-text-base);width:180px" placeholder="Search..." /></div>
      ${btnIcon(themeIcon, `onclick="actions.toggleTheme()" title="Toggle theme"`)}
      ${btnIcon("bell", "title=\"Notifications\"")}
    </div>
  </div>`;
}

function sidebar() {
  const items = [
    { id: "workspace", label: "Workspace", icon: "folder" },
    { id: "flows", label: "Flows", icon: "flow" },
    { id: "tasks", label: "Tasks", icon: "logs" },
    { id: "skills", label: "Skills", icon: "cube" },
    { id: "settings", label: "Settings", icon: "settings" }
  ];
  return `<div style="width:var(--ch-sidebar-width);background:var(--ch-surface);border-right:1px solid var(--ch-border);padding:var(--ch-space-4);display:flex;flex-direction:column;gap:var(--ch-space-2);overflow-y:auto">
    <div style="font-size:var(--ch-text-xs);font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--ch-text-secondary);margin-top:var(--ch-space-4);margin-bottom:var(--ch-space-2)">Workspace</div>
    ${items.map(item => {
      const active = state.activeScreen === item.id;
      return `<div onclick="actions.navigate('${item.id}')" style="display:flex;align-items:center;gap:var(--ch-space-3);padding:10px var(--ch-space-3);border-radius:var(--ch-radius-md);font-size:var(--ch-text-base);cursor:pointer;color:${active ? "var(--ch-text)" : "var(--ch-text-secondary)"};background:${active ? "var(--ch-surface-high)" : "transparent"}">${icon(item.icon, 18)} ${item.label}</div>`;
    }).join("")}
  </div>`;
}

function workspaceScreen() {
  const projects = mockData.projects.filter(p => p.name.toLowerCase().includes(state.projectFilter.toLowerCase()));
  const cards = projects.map(p => card(`
    <div>
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:var(--ch-space-3)">
        <div style="font-size:var(--ch-text-lg);font-weight:600">${helpers.escape(p.name)}</div>
      </div>
      <div style="color:var(--ch-text-secondary);font-size:var(--ch-text-base);margin-bottom:var(--ch-space-3)">${helpers.escape(p.description)}</div>
      <div style="color:var(--ch-text-tertiary);font-size:var(--ch-text-sm)">Updated ${p.updatedAt}</div>
    </div>
  `)).join("");

  return `<div>
    <div style="${styles.pageHeader}">
      <div>
        <div style="${styles.pageTitle}">Workspace</div>
        <div style="${styles.pageSubtitle}">${mockData.workspace.name} · ${helpers.escape(state.workspaceRoot)}</div>
      </div>
      ${btnPrimary("Add Project", "plus")}
    </div>
    <div style="display:flex;gap:var(--ch-space-4);margin-bottom:var(--ch-space-5)">
      <input style="${styles.input};width:300px" placeholder="Filter projects..." value="${helpers.escape(state.projectFilter)}" oninput="actions.setProjectFilter(this.value)" />
    </div>
    <div style="${styles.grid2}">${cards}</div>
  </div>`;
}

function skillsScreen() {
  const rows = state.skills.map(s => {
    const linkedProjects = s.linkedTo.map(id => mockData.projects.find(p => p.id === id)).filter(Boolean);
    const linkCount = linkedProjects.length;
    const linkLabel = linkCount === 0 ? "Not linked" : `${linkCount} project${linkCount > 1 ? "s" : ""}`;
    const linkNames = linkedProjects.map(p => helpers.escape(p.name)).join(", ") || "—";
    return `
      <tr onclick="actions.openSkillModal('${s.id}')" style="cursor:pointer">
        <td style="${styles.td}">
          <div style="font-weight:600">${helpers.escape(s.name)}</div>
          <div style="color:var(--ch-text-secondary);font-size:var(--ch-text-sm);margin-top:2px">${helpers.escape(s.description)}</div>
        </td>
        <td style="${styles.td};font-family:var(--ch-font-mono);color:var(--ch-text-secondary);font-size:var(--ch-text-sm)">${helpers.escape(s.repoPath)}</td>
        <td style="${styles.td}">
          <span title="${linkNames}" style="color:var(--ch-text-secondary);font-size:var(--ch-text-sm)">${linkLabel}</span>
        </td>
        <td style="${styles.td}">
          <div style="display:flex;gap:var(--ch-space-2)">
            ${btnSecondary("Details", null, `onclick="event.stopPropagation();actions.openSkillModal('${s.id}')"`)}
            ${btnGhost("trash", "onclick=\"event.stopPropagation()\"")}
          </div>
        </td>
      </tr>`;
  }).join("");

  return `<div>
    <div style="${styles.pageHeader}">
      <div>
        <div style="${styles.pageTitle}">Skills</div>
        <div style="${styles.pageSubtitle}">Manage skill repository and project links</div>
      </div>
      ${btnPrimary("Add Skill", "plus")}
    </div>
    <table style="${styles.table}">
      <thead><tr><th style="${styles.th}">Skill</th><th style="${styles.th}">Repository Path</th><th style="${styles.th}">Linked Projects</th><th style="${styles.th}"></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function skillModal() {
  const s = state.selectedSkill;
  if (!s) return "";
  const projectLinks = mockData.projects.map(p => {
    const linked = s.linkedTo.includes(p.id);
    return `
      <label style="display:flex;align-items:center;gap:var(--ch-space-2);padding:8px var(--ch-space-3);border-radius:var(--ch-radius-md);background:var(--ch-surface-high);border:1px solid ${linked ? "var(--ch-accent)" : "var(--ch-border)"};cursor:pointer;margin-bottom:var(--ch-space-2)">
        <input type="checkbox" ${linked ? "checked" : ""} onchange="actions.toggleSkillLink('${s.id}', '${p.id}')" style="cursor:pointer" />
        <span style="color:${linked ? "var(--ch-accent)" : "var(--ch-text)"};font-size:var(--ch-text-base)">${helpers.escape(p.name)}</span>
      </label>`;
  }).join("");

  return `
    <div onclick="actions.closeSkillModal()" style="position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:100;display:flex;align-items:center;justify-content:center;padding:var(--ch-space-6)">
      <div onclick="event.stopPropagation()" style="background:var(--ch-surface);border:1px solid var(--ch-border);border-radius:var(--ch-radius-xl);width:560px;max-width:100%;max-height:90vh;overflow:hidden;display:flex;flex-direction:column;box-shadow:var(--ch-shadow-lg)">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:var(--ch-space-4);border-bottom:1px solid var(--ch-border)">
          <div>
            <div style="font-size:var(--ch-text-xl);font-weight:700">${helpers.escape(s.name)}</div>
            <div style="color:var(--ch-text-secondary);font-size:var(--ch-text-sm);margin-top:2px">${helpers.escape(s.description)}</div>
          </div>
          <button onclick="actions.closeSkillModal()" style="background:transparent;border:none;color:var(--ch-text-secondary);cursor:pointer;padding:var(--ch-space-2);border-radius:var(--ch-radius-md);font-size:20px;line-height:1">&times;</button>
        </div>
        <div style="padding:var(--ch-space-4);overflow-y:auto;flex:1">
          <div style="margin-bottom:var(--ch-space-4)">
            <div style="${styles.label}">Repository Path</div>
            <div style="font-family:var(--ch-font-mono);font-size:var(--ch-text-sm);color:var(--ch-text-secondary);background:var(--ch-surface-high);border:1px solid var(--ch-border);border-radius:var(--ch-radius-md);padding:var(--ch-space-3)">${helpers.escape(s.repoPath)}</div>
          </div>
          <div style="margin-bottom:var(--ch-space-4)">
            <div style="${styles.label}">Version & Dependencies</div>
            <div style="display:flex;gap:var(--ch-space-4);color:var(--ch-text-secondary);font-size:var(--ch-text-sm)">
              <span>v1.2.0</span>
              <span>·</span>
              <span>Requires: http-client</span>
            </div>
          </div>
          <div style="margin-bottom:var(--ch-space-4)">
            <div style="${styles.label}">Linked Projects</div>
            <div style="max-height:220px;overflow-y:auto;padding-right:4px">${projectLinks}</div>
          </div>
          <div style="display:flex;gap:var(--ch-space-3);margin-top:var(--ch-space-2)">
            ${btnPrimary("Save", null, "onclick=\"actions.closeSkillModal()\"")}
            <button onclick="actions.closeSkillModal()" style="background:transparent;border:1px solid var(--ch-border);color:var(--ch-error);border-radius:var(--ch-radius-md);padding:6px 12px;font-size:var(--ch-text-base);cursor:pointer">Delete Skill</button>
          </div>
        </div>
      </div>
    </div>`;
}

function flowEditorScreen() {
  const nodeById = {};
  mockData.flow.nodes.forEach(n => nodeById[n.id] = n);
  const edgesSvg = mockData.flow.edges.map(e => {
    const from = nodeById[e.from];
    const to = nodeById[e.to];
    const color = state.running ? "var(--ch-accent)" : "var(--ch-border-strong)";
    const dash = state.running ? 'stroke-dasharray="6 4"' : "";
    return `<g>
      <line x1="${from.x + 140}" y1="${from.y + 28}" x2="${to.x}" y2="${to.y + 28}" stroke="${color}" stroke-width="2" ${dash} />
      <polygon points="${to.x - 8},${to.y + 24} ${to.x},${to.y + 28} ${to.x - 8},${to.y + 32}" fill="${color}" />
    </g>`;
  }).join("");

  const nodesHtml = mockData.flow.nodes.map(n => {
    const selected = state.selectedNode?.id === n.id;
    const border = selected ? "var(--ch-accent)" : "var(--ch-border)";
    const shadow = selected ? "box-shadow:0 0 0 2px var(--ch-accent-soft)" : "";
    return `<div onclick="actions.selectNode('${n.id}')" style="position:absolute;left:${n.x}px;top:${n.y}px;width:140px;background:var(--ch-surface);border:1px solid ${border};border-radius:var(--ch-radius-lg);cursor:pointer;transform:scale(${state.zoom});transform-origin:top left;${shadow}">
      <div style="height:4px;background:${helpers.nodeTypeColor(n.subtype)};border-radius:var(--ch-radius-lg) var(--ch-radius-lg) 0 0"></div>
      <div style="padding:10px var(--ch-space-3)">
        <div style="font-size:var(--ch-text-sm);font-weight:600;margin-bottom:2px">${helpers.escape(n.title)}</div>
        <div style="font-size:var(--ch-text-xs);color:var(--ch-text-secondary);font-family:var(--ch-font-mono)">${helpers.escape(n.summary)}</div>
      </div>
    </div>`;
  }).join("");

  const palette = mockData.nodePalette.map(cat => `
    <div style="margin-bottom:var(--ch-space-4)">
      <div style="font-size:var(--ch-text-sm);font-weight:600;color:var(--ch-text);margin-bottom:var(--ch-space-2)">${helpers.escape(cat.category)}</div>
      ${cat.items.map(item => `
        <div style="padding:8px var(--ch-space-3);border-radius:var(--ch-radius-md);background:var(--ch-surface-high);border:1px solid var(--ch-border);margin-bottom:var(--ch-space-2);font-size:var(--ch-text-base);cursor:grab;display:flex;align-items:center;gap:var(--ch-space-2)">
          <span style="width:8px;height:8px;border-radius:50%;background:var(--ch-accent)"></span>${helpers.escape(item)}
        </div>
      `).join("")}
    </div>
  `).join("");

  let properties = `<div style="color:var(--ch-text-secondary);font-size:var(--ch-text-base);text-align:center;margin-top:var(--ch-space-10)">Select a node to edit properties</div>`;
  if (state.selectedNode) {
    const agentOnly = state.selectedNode.type === "agent" ? `
      <div style="margin-bottom:var(--ch-space-4)">
        <label style="${styles.label}">Model</label>
        <select style="${styles.input}"><option>Codex Ultra 1 (Fast)</option><option>Claude Code (Agent SDK)</option><option>glm-5.2</option></select>
      </div>
      <div style="margin-bottom:var(--ch-space-4)">
        <label style="${styles.label}">System Prompt</label>
        <textarea style="${styles.textarea}">You are a news curator. Summarize the following JSON payload into a bulleted list of 5 hot points, assign a relevance score from 0-1 based on AI technology focus.</textarea>
      </div>
    ` : "";
    properties = `
      <div>
        <div style="font-size:var(--ch-text-md);font-weight:700;margin-bottom:var(--ch-space-1)">Node Properties</div>
        <div style="color:var(--ch-text-secondary);font-size:var(--ch-text-sm);margin-bottom:var(--ch-space-4);font-family:var(--ch-font-mono)">${state.selectedNode.id} · ${state.selectedNode.type}</div>
        <div style="margin-bottom:var(--ch-space-4)">
          <label style="${styles.label}">Node Name</label>
          <input style="${styles.input}" value="${helpers.escape(state.selectedNode.title)}" />
        </div>
        ${agentOnly}
        <div style="margin-bottom:var(--ch-space-4)">
          <label style="${styles.label}">Output Variable</label>
          <input style="${styles.input}" value="agent_result" />
        </div>
        <div style="display:flex;gap:var(--ch-space-3);margin-top:var(--ch-space-6)">
          ${btnPrimary("Save", null, "style='flex:1'")}
          <button style="background:transparent;border:1px solid var(--ch-border);color:var(--ch-error);border-radius:var(--ch-radius-md);padding:6px 12px;font-size:var(--ch-text-base);cursor:pointer">Delete</button>
        </div>
      </div>`;
  }

  return `<div style="display:flex;flex-direction:column;height:100%">
    <div style="${styles.pageHeader};margin-bottom:var(--ch-space-4);padding-right:var(--ch-space-6)">
      <div>
        <div style="${styles.pageTitle}">${mockData.flow.name}</div>
        <div style="${styles.pageSubtitle}">Drag nodes to build your automation flow</div>
      </div>
      <div style="display:flex;gap:var(--ch-space-3);align-items:center">
        <div style="display:flex;align-items:center;gap:var(--ch-space-2);color:var(--ch-text-secondary);font-size:var(--ch-text-sm)">
          <div onclick="actions.toggleSchedule()" style="width:32px;height:18px;border-radius:9px;background:${state.running ? "var(--ch-accent-soft)" : "var(--ch-surface-high)"};position:relative;cursor:pointer">
            <div style="width:14px;height:14px;border-radius:50%;background:${state.running ? "var(--ch-accent)" : "var(--ch-text-tertiary)"};position:absolute;top:2px;left:${state.running ? 16 : 2}px;transition:left 0.2s"></div>
          </div>
          Schedule
        </div>
        ${btnSecondary(state.running ? "Running..." : "Run", "play", 'onclick="actions.runFlow()" style="color:' + (state.running ? "var(--ch-warning)" : "var(--ch-text)") + '"')}
      </div>
    </div>

    <div style="display:flex;flex:1;overflow:hidden;gap:var(--ch-space-4)">
      <div style="width:var(--ch-sidebar-width);background:var(--ch-surface);border:1px solid var(--ch-border);border-radius:var(--ch-radius-lg);padding:var(--ch-space-4);overflow-y:auto">
        <div style="font-size:var(--ch-text-xs);font-weight:700;text-transform:uppercase;color:var(--ch-text-secondary);margin-bottom:var(--ch-space-3)">Node Palette</div>
        ${palette}
      </div>

      <div id="flow-canvas" style="flex:1;background:var(--ch-bg);border:1px solid var(--ch-border);border-radius:var(--ch-radius-lg);overflow:auto">
        <div id="flow-canvas-inner" style="position:relative;min-width:1600px;min-height:600px;height:100%;background-image:radial-gradient(circle, var(--ch-border) 1px, transparent 1px);background-size:20px 20px;transform:scale(${state.zoom});transform-origin:top left">
          <svg style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none">${edgesSvg}</svg>
          ${nodesHtml}
          <div style="position:absolute;bottom:16px;right:16px;display:flex;gap:var(--ch-space-2);background:var(--ch-surface);border:1px solid var(--ch-border);border-radius:var(--ch-radius-md);padding:4px">
            ${btnIcon("zoomOut", "onclick=\"actions.setZoom(-0.1)\"")}
            <button style="background:transparent;border:none;color:var(--ch-text-secondary);border-radius:var(--ch-radius-md);padding:6px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center" onclick="actions.setZoom(0)">${Math.round(state.zoom * 100)}%</button>
            ${btnIcon("zoomIn", "onclick=\"actions.setZoom(0.1)\"")}
          </div>
        </div>
      </div>

      <div style="width:var(--ch-right-panel-width);background:var(--ch-surface);border:1px solid var(--ch-border);border-radius:var(--ch-radius-lg);padding:var(--ch-space-4);overflow-y:auto">
        ${properties}
      </div>
    </div>
  </div>`;
}

function tasksScreen() {
  const history = mockData.executions.map(e => `
    <div onclick="actions.selectExecution('${e.id}')" style="padding:var(--ch-space-3) var(--ch-space-4);border-bottom:1px solid var(--ch-border);cursor:pointer;background:${state.selectedExecution?.id === e.id ? "var(--ch-surface-high)" : "transparent"}">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <div style="font-weight:600;font-size:var(--ch-text-base)">${helpers.escape(e.flowName)}</div>
        ${statusDot(e.status, 8)}
      </div>
      <div style="color:var(--ch-text-secondary);font-size:var(--ch-text-xs)">${helpers.escape(e.projectName)} · ${e.startedAt} · ${e.duration} · ${e.nodesRun} nodes</div>
    </div>
  `).join("");

  let content = "";
  if (state.activeTab === "logs") {
    content = `<div style="display:flex;flex-direction:column;gap:var(--ch-space-3)">
      ${mockData.logs.map(log => `
        <div style="display:flex;gap:var(--ch-space-3);font-size:var(--ch-text-sm);font-family:var(--ch-font-mono)">
          <span style="color:var(--ch-text-tertiary);width:70px;flex-shrink:0">${log.time}</span>
          <span style="color:var(--ch-text-secondary);width:140px;flex-shrink:0">${helpers.escape(log.node)}</span>
          ${statusDot(log.status, 8, "margin-top:5px")}
          <span style="color:var(--ch-text)">${helpers.escape(log.message)}</span>
        </div>
      `).join("")}
    </div>`;
  } else if (state.activeTab === "variables") {
    content = `
      <table style="${styles.table}"><tbody>
        <tr><td style="${styles.td}">agent_result</td><td style="${styles.td};font-family:var(--ch-font-mono);color:var(--ch-text-secondary)">object (8 items)</td></tr>
        <tr><td style="${styles.td}">articles</td><td style="${styles.td};font-family:var(--ch-font-mono);color:var(--ch-text-secondary)">array[8]</td></tr>
        <tr><td style="${styles.td}">score_threshold</td><td style="${styles.td};font-family:var(--ch-font-mono);color:var(--ch-text-secondary)">0.7</td></tr>
      </tbody></table>`;
  } else {
    content = `
      <pre style="background:var(--ch-bg);border:1px solid var(--ch-border);border-radius:var(--ch-radius-md);padding:var(--ch-space-4);font-family:var(--ch-font-mono);font-size:var(--ch-text-sm);color:var(--ch-text);overflow:auto">{
  "date": "2026-07-01",
  "articles": [
    { "title": "OpenAI releases Codex CLI", "score": 0.92 },
    { "title": "Claude Code desktop enters beta", "score": 0.88 },
    { "title": "New React Flow performance update", "score": 0.74 }
  ],
  "output_path": "~/output/news.md"
}</pre>`;
  }

  const tabs = ["logs", "variables", "output"].map(tab => {
    const active = state.activeTab === tab;
    return `<button onclick="actions.setTab('${tab}')" style="padding:var(--ch-space-3) var(--ch-space-4);background:transparent;border:none;border-bottom:2px solid ${active ? "var(--ch-accent)" : "transparent"};color:${active ? "var(--ch-text)" : "var(--ch-text-secondary)"};font-size:var(--ch-text-base);font-weight:${active ? 600 : 400};cursor:pointer;text-transform:capitalize">${tab}</button>`;
  }).join("");

  return `<div style="display:flex;flex-direction:column;height:100%">
    <div style="${styles.pageHeader}">
      <div>
        <div style="${styles.pageTitle}">Tasks</div>
        <div style="${styles.pageSubtitle}">Runs of a flow inside a project</div>
      </div>
    </div>
    <div style="display:flex;flex:1;gap:var(--ch-space-4);overflow:hidden">
      <div style="width:380px;background:var(--ch-surface);border:1px solid var(--ch-border);border-radius:var(--ch-radius-lg);overflow:hidden;display:flex;flex-direction:column">
        <div style="padding:var(--ch-space-3) var(--ch-space-4);border-bottom:1px solid var(--ch-border);font-weight:600;font-size:var(--ch-text-md)">Run History</div>
        <div style="overflow-y:auto;flex:1">${history}</div>
      </div>
      <div style="flex:1;background:var(--ch-surface);border:1px solid var(--ch-border);border-radius:var(--ch-radius-lg);overflow:hidden;display:flex;flex-direction:column">
        <div style="display:flex;border-bottom:1px solid var(--ch-border)">${tabs}</div>
        <div style="flex:1;overflow:auto;padding:var(--ch-space-4)">${content}</div>
      </div>
    </div>
  </div>`;
}

function settingsScreen() {
  return `<div>
    <div style="${styles.pageHeader}">
      <div>
        <div style="${styles.pageTitle}">Settings</div>
        <div style="${styles.pageSubtitle}">Workspace and preferences</div>
      </div>
    </div>
    <div style="max-width:560px">
      ${card(`
        <div style="margin-bottom:var(--ch-space-4)">
          <label style="${styles.label}">Workspace Root Directory</label>
          <input style="${styles.input}" value="${helpers.escape(state.workspaceRoot)}" oninput="actions.setWorkspaceRoot(this.value)" />
          <div style="color:var(--ch-text-secondary);font-size:var(--ch-text-sm);margin-top:var(--ch-space-2)">All projects are loaded from this directory.</div>
        </div>
        <div style="display:flex;gap:var(--ch-space-3)">
          ${btnPrimary("Save", null, "onclick=\"actions.saveSettings()\"")}
        </div>
      `)}
    </div>
  </div>`;
}

// === Actions ===
const actions = {
  navigate(screen) {
    state.activeScreen = screen;
    renderApp();
  },
  toggleTheme() {
    state.theme = state.theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", state.theme);
  },
  setProjectFilter(value) {
    state.projectFilter = value;
    renderApp();
  },
  setWorkspaceRoot(value) {
    state.workspaceRoot = value;
    renderApp();
  },
  saveSettings() {
    renderApp();
  },
  toggleSkillLink(skillId, projectId) {
    const skill = state.skills.find(s => s.id === skillId);
    if (!skill) return;
    const idx = skill.linkedTo.indexOf(projectId);
    if (idx >= 0) skill.linkedTo.splice(idx, 1);
    else skill.linkedTo.push(projectId);
    renderApp();
  },
  openSkillModal(skillId) {
    state.selectedSkill = state.skills.find(s => s.id === skillId);
    renderApp();
  },
  closeSkillModal() {
    state.selectedSkill = null;
    renderApp();
  },
  selectNode(nodeId) {
    state.selectedNode = mockData.flow.nodes.find(n => n.id === nodeId);
    renderApp();
  },
  setZoom(delta) {
    if (delta === 0) state.zoom = 1;
    else state.zoom = Math.max(0.5, Math.min(1.5, state.zoom + delta));
    renderApp();
  },
  runFlow() {
    state.running = true;
    renderApp();
    setTimeout(() => { state.running = false; renderApp(); }, 2000);
  },
  toggleSchedule() {
    // Toggle visual only
    renderApp();
  },
  selectExecution(id) {
    state.selectedExecution = mockData.executions.find(e => e.id === id);
    renderApp();
  },
  setTab(tab) {
    state.activeTab = tab;
    renderApp();
  }
};
window.actions = actions;

// === Render ===
function screenContent() {
  switch (state.activeScreen) {
    case "workspace": return workspaceScreen();
    case "skills": return skillsScreen();
    case "flows": return flowEditorScreen();
    case "tasks": return tasksScreen();
    case "settings": return settingsScreen();
    default: return workspaceScreen();
  }
}

function renderApp() {
  const root = document.getElementById("root");
  const mainPadding = state.activeScreen === "flows"
    ? "padding:var(--ch-space-6) 0 var(--ch-space-6) var(--ch-space-6)"
    : "padding:var(--ch-space-6)";
  root.innerHTML = `
    <div style="font-family:var(--ch-font-sans);background:var(--ch-bg);color:var(--ch-text);height:100vh;display:flex;flex-direction:column;overflow:hidden">
      ${topbar()}
      <div style="display:flex;flex:1;overflow:hidden">
        ${sidebar()}
        <div style="flex:1;overflow:auto;${mainPadding}">${screenContent()}</div>
      </div>
    </div>
    ${skillModal()}`;
}

renderApp();
