import { getDb } from "../db.js";
import * as flowService from "./flowService.js";
import * as projectService from "./projectService.js";
import * as skillService from "./skillService.js";
import * as channelBindingService from "./channelBindingService.js";

const BUILTIN_TEMPLATES = [
  {
    id: "daily-digest",
    name: "定时日报",
    description: "按主题从内容源收集条目并合成日报",
    nodeList: [
      buildTriggerNode("topic"),
      buildAgentNode(
        "topic-daily-digest",
        "You are a collection agent. When triggered with a topic, call the `topic-daily-digest` skill to generate a structured daily digest. Use the injected `topic` variable to drive the collection."
      )
    ],
    edges: [{ id: "e1", sourceNodeId: "trigger", targetNodeId: "agent" }],
    skills: ["topic-daily-digest"]
  },
  {
    id: "link-capture",
    name: "链接速存",
    description: "抓取 IM 消息中的链接正文并转为 markdown 存入素材库",
    nodeList: [
      buildTriggerNode("url"),
      buildAgentNode(
        "fetch-to-markdown",
        "You are a collection agent. When triggered with a URL, call the `fetch-to-markdown` skill to fetch the page and save it as markdown in the project material library."
      )
    ],
    edges: [{ id: "e1", sourceNodeId: "trigger", targetNodeId: "agent" }],
    skills: ["fetch-to-markdown"],
    createChannelBinding: true
  }
];

function createError(message, code, status) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
}

function getTemplate(templateId) {
  return BUILTIN_TEMPLATES.find((t) => t.id === templateId);
}

function cloneDeep(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildTriggerNode(outputVariableName) {
  return {
    id: "trigger",
    type: "trigger",
    config: {
      outputVariables: [
        { name: outputVariableName, type: "string", defaultValue: "" }
      ]
    }
  };
}

function buildAgentNode(skillName, prompt) {
  return {
    id: "agent",
    type: "agent",
    config: {
      provider: "anthropic",
      options: {
        systemPrompt: prompt,
        maxTurns: 10
      }
    }
  };
}

function applyOverrides(nodeList, overrides) {
  if (!overrides || typeof overrides !== "object") return nodeList;
  for (const node of nodeList) {
    if (node.type !== "trigger" || !Array.isArray(node.config?.outputVariables)) {
      continue;
    }
    for (const variable of node.config.outputVariables) {
      if (variable.name in overrides) {
        variable.defaultValue = overrides[variable.name];
      }
    }
  }
  return nodeList;
}

function findSkillIdByName(name) {
  const skills = skillService.listLinkableSkills();
  const skill = skills.find((s) => s.name === name);
  return skill?.id;
}

function resolveRequiredSkillIds(template) {
  const skillIds = [];
  for (const skillName of template.skills) {
    const skillId = findSkillIdByName(skillName);
    if (!skillId) {
      throw createError(
        `Required collection skill not available: ${skillName}`,
        "E-TPL-SKILL-MISSING",
        500
      );
    }
    skillIds.push(skillId);
  }
  return skillIds;
}

export function listTemplates() {
  return BUILTIN_TEMPLATES.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description
  }));
}

export function instantiateTemplate({ templateId, projectId, overrides, force = false }) {
  if (!templateId) {
    throw createError("templateId is required", "E-TPL-NOT-FOUND", 404);
  }
  const template = getTemplate(templateId);
  if (!template) {
    throw createError(`Template not found: ${templateId}`, "E-TPL-NOT-FOUND", 404);
  }

  if (!projectId) {
    throw createError("projectId is required", "E-TPL-PROJECT-INVALID", 400);
  }
  const project = projectService.getProjectDetail(projectId);
  if (!project) {
    throw createError(`Invalid project: ${projectId}`, "E-TPL-PROJECT-INVALID", 400);
  }

  const db = getDb();
  const nodeList = applyOverrides(cloneDeep(template.nodeList), overrides);

  // Resolve required collection skills before the transaction so missing skills fail early.
  const skillIds = resolveRequiredSkillIds(template);

  let flow;
  let binding = null;

  const instantiate = db.transaction(() => {
    flow = flowService.createFlow({
      name: template.name,
      projectId,
      description: template.description,
      nodeList,
      edges: cloneDeep(template.edges)
    });

    const linkedSkillIds = new Set();
    for (const skillId of skillIds) {
      for (const id of skillService.linkSkillRaw(db, skillId, projectId)) {
        linkedSkillIds.add(id);
      }
    }

    if (template.createChannelBinding) {
      binding = channelBindingService.createBindingRaw(db, {
        channelType: "feishu",
        flowId: flow.id,
        projectId,
        force
      });
    }

    return linkedSkillIds;
  });

  const linkedSkillIds = instantiate();

  // Skill symlink 是文件系统副作用，不可回滚；在事务提交后执行，失败仅记录日志。
  for (const skillId of linkedSkillIds) {
    try {
      const skill = skillService.getSkillDetail(skillId);
      if (skill && project) {
        skillService.createSkillSymlink(skill, project);
      }
    } catch (err) {
      console.warn(`Failed to create skill symlink for ${skillId}:`, err.message);
    }
  }

  return {
    flowId: flow.id,
    flow,
    binding
  };
}
