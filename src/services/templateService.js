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
      {
        id: "trigger",
        type: "trigger",
        config: {
          outputVariables: [
            { name: "topic", type: "string", defaultValue: "" }
          ]
        }
      },
      {
        id: "agent",
        type: "agent",
        config: {
          provider: "anthropic",
          options: {
            systemPrompt:
              "You are a collection agent. When triggered with a topic, call the `topic-daily-digest` skill to generate a structured daily digest. Use the injected `topic` variable to drive the collection.",
            maxTurns: 10
          }
        }
      }
    ],
    edges: [{ id: "e1", sourceNodeId: "trigger", targetNodeId: "agent" }],
    skills: ["topic-daily-digest"]
  },
  {
    id: "link-capture",
    name: "链接速存",
    description: "抓取 IM 消息中的链接正文并转为 markdown 存入素材库",
    nodeList: [
      {
        id: "trigger",
        type: "trigger",
        config: {
          outputVariables: [
            { name: "url", type: "string", defaultValue: "" }
          ]
        }
      },
      {
        id: "agent",
        type: "agent",
        config: {
          provider: "anthropic",
          options: {
            systemPrompt:
              "You are a collection agent. When triggered with a URL, call the `fetch-to-markdown` skill to fetch the page and save it as markdown in the project material library.",
            maxTurns: 10
          }
        }
      }
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

  const nodeList = applyOverrides(cloneDeep(template.nodeList), overrides);
  const flow = flowService.createFlow({
    name: template.name,
    projectId,
    description: template.description,
    nodeList,
    edges: cloneDeep(template.edges)
  });

  // Link required collection skills to the project (recursively resolves dependencies).
  for (const skillName of template.skills) {
    const skillId = findSkillIdByName(skillName);
    if (!skillId) {
      throw createError(
        `Required collection skill not available: ${skillName}`,
        "E-TPL-SKILL-MISSING",
        500
      );
    }
    skillService.linkSkill(skillId, projectId);
  }

  let binding = null;
  if (template.createChannelBinding) {
    binding = channelBindingService.createBinding({
      channelType: "feishu",
      flowId: flow.id,
      projectId,
      force
    });
  }

  return {
    flowId: flow.id,
    flow,
    binding
  };
}
