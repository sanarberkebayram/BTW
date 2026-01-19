import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import {
  AgentItem,
  AgentSummary,
  RepoSummary,
  SkillItem,
  SkillSummary,
  TemplateItem,
  TemplateSummary,
} from "./indexer.js";
import {
  validateAgentYaml,
  validateExtendsJson,
  validateRepoJson,
  validateSkillJson,
  validateTemplateJson,
} from "./schemas.js";

export interface RepoScanResult {
  repo: RepoSummary;
  skills: Array<{ summary: SkillSummary; item: SkillItem }>;
  agents: Array<{ summary: AgentSummary; item: AgentItem }>;
  templates: Array<{ summary: TemplateSummary; item: TemplateItem }>;
  errors: string[];
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

async function readTextFile(filePath: string): Promise<string> {
  return fs.readFile(filePath, "utf8");
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function listDirectories(dirPath: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

function normalizeArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item) => typeof item === "string") as string[];
}

export async function scanRepo(
  repoId: string,
  repoPath: string,
  overlay: boolean
): Promise<RepoScanResult> {
  const errors: string[] = [];
  let repoSummary: RepoSummary = {
    id: repoId,
    name: overlay ? "Overlay" : repoId,
    description: overlay ? "Overlay templates" : undefined,
    categories: [],
  };

  const repoJsonPath = path.join(repoPath, "repo.json");
  if (!overlay && (await exists(repoJsonPath))) {
    try {
      const repoJson = await readJsonFile<Record<string, unknown>>(repoJsonPath);
      const repoErrors = validateRepoJson(repoJson);
      if (repoErrors.length > 0) {
        errors.push(
          `repo.json invalid for ${repoId}: ${repoErrors.join("; ")}`
        );
      } else {
      const repoJsonId = String(repoJson.id ?? repoId);
      if (repoJsonId !== repoId) {
        errors.push(
          `repo id mismatch: registry ${repoId} vs repo.json ${repoJsonId}`
        );
      }
        repoSummary = {
          id: repoId,
          name: String(repoJson.name ?? repoId),
          description:
            typeof repoJson.description === "string"
              ? repoJson.description
              : undefined,
          categories: normalizeArray(repoJson.categories),
        };
      }
    } catch (err) {
      errors.push(`failed to read repo.json for ${repoId}: ${String(err)}`);
    }
  }

  const skills: Array<{ summary: SkillSummary; item: SkillItem }> = [];
  const agents: Array<{ summary: AgentSummary; item: AgentItem }> = [];
  const templates: Array<{ summary: TemplateSummary; item: TemplateItem }> = [];

  const skillsDir = path.join(repoPath, "skills");
  for (const skillId of await listDirectories(skillsDir)) {
    const skillPath = path.join(skillsDir, skillId);
    try {
      const skillJson = await readJsonFile<Record<string, unknown>>(
        path.join(skillPath, "skill.json")
      );
      const validationErrors = validateSkillJson(skillJson);
      if (validationErrors.length > 0) {
        errors.push(
          `skill.json invalid for ${repoId}/${skillId}: ${validationErrors.join(
            "; "
          )}`
        );
        continue;
      }
      const skillMd = await readTextFile(path.join(skillPath, "SKILL.md"));
      const summary: SkillSummary = {
        id: String(skillJson.id ?? skillId),
        repo_id: repoId,
        name: String(skillJson.name ?? skillId),
        description:
          typeof skillJson.description === "string"
            ? skillJson.description
            : undefined,
        categories: normalizeArray(skillJson.categories),
        tags: normalizeArray(skillJson.tags),
        language:
          typeof skillJson.language === "string" ? skillJson.language : undefined,
        tool: typeof skillJson.tool === "string" ? skillJson.tool : undefined,
      };
      const item: SkillItem = {
        id: summary.id,
        repo_id: repoId,
        metadata: skillJson,
        body: { skill_md: skillMd },
        assetsPath: path.join(skillPath, "assets"),
      };
      skills.push({ summary, item });
    } catch (err) {
      errors.push(`failed to scan skill ${repoId}/${skillId}: ${String(err)}`);
    }
  }

  const agentsDir = path.join(repoPath, "agents");
  for (const agentId of await listDirectories(agentsDir)) {
    const agentPath = path.join(agentsDir, agentId);
    try {
      const agentRaw = await readTextFile(path.join(agentPath, "agent.yaml"));
      const agentJson = (yaml.load(agentRaw) ?? {}) as Record<string, unknown>;
      const validationErrors = validateAgentYaml(agentJson);
      if (validationErrors.length > 0) {
        errors.push(
          `agent.yaml invalid for ${repoId}/${agentId}: ${validationErrors.join(
            "; "
          )}`
        );
        continue;
      }
      const promptMd = await readTextFile(path.join(agentPath, "prompt.md"));
      const summary: AgentSummary = {
        id: String(agentJson.id ?? agentId),
        repo_id: repoId,
        name: String(agentJson.name ?? agentId),
        description:
          typeof agentJson.description === "string"
            ? agentJson.description
            : undefined,
        categories: [],
        tags: [],
      };
      const item: AgentItem = {
        id: summary.id,
        repo_id: repoId,
        metadata: agentJson,
        body: { prompt_md: promptMd },
      };
      agents.push({ summary, item });
    } catch (err) {
      errors.push(`failed to scan agent ${repoId}/${agentId}: ${String(err)}`);
    }
  }

  const templatesDir = path.join(repoPath, "templates");
  for (const templateId of await listDirectories(templatesDir)) {
    const templatePath = path.join(templatesDir, templateId);
    try {
      const templateJson = await readJsonFile<Record<string, unknown>>(
        path.join(templatePath, "template.json")
      );
      const validationErrors = validateTemplateJson(templateJson);
      if (validationErrors.length > 0) {
        errors.push(
          `template.json invalid for ${repoId}/${templateId}: ${validationErrors.join(
            "; "
          )}`
        );
        continue;
      }
      const templateMd = await readTextFile(
        path.join(templatePath, "template.md")
      );
      let extendsRef: TemplateItem["extends"];
      const extendsPath = path.join(templatePath, "extends.json");
      if (await exists(extendsPath)) {
        const extendsJson = await readJsonFile<Record<string, unknown>>(
          extendsPath
        );
        const extendsErrors = validateExtendsJson(extendsJson);
        if (extendsErrors.length > 0) {
          errors.push(
            `extends.json invalid for ${repoId}/${templateId}: ${extendsErrors.join(
              "; "
            )}`
          );
          continue;
        }
        if (typeof extendsJson.extends === "string") {
          extendsRef = {
            template_id: extendsJson.extends,
            repo_id:
              typeof extendsJson.repo === "string" ? extendsJson.repo : undefined,
          };
        }
      }
      const summary: TemplateSummary = {
        id: String(templateJson.id ?? templateId),
        repo_id: repoId,
        name: String(templateJson.name ?? templateId),
        description:
          typeof templateJson.description === "string"
            ? templateJson.description
            : undefined,
        categories: normalizeArray(templateJson.categories),
        tags: normalizeArray(templateJson.tags),
        language:
          typeof templateJson.language === "string"
            ? templateJson.language
            : undefined,
        tool:
          typeof templateJson.tool === "string" ? templateJson.tool : undefined,
      };
      const item: TemplateItem = {
        id: summary.id,
        repo_id: repoId,
        metadata: templateJson,
        body: { template_md: templateMd },
        extends: extendsRef,
      };
      templates.push({ summary, item });
    } catch (err) {
      errors.push(
        `failed to scan template ${repoId}/${templateId}: ${String(err)}`
      );
    }
  }

  return { repo: repoSummary, skills, agents, templates, errors };
}
