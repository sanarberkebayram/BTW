import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "node:fs/promises";
import path from "node:path";
import { IndexStore, ListFilters } from "./indexer.js";
import { buildIndex } from "./index_builder.js";
import { Registry, saveRegistry } from "./registry.js";
import { Config } from "./config.js";
import { syncRepos } from "./sync.js";
import { resolveTemplateComposed, getResolutionOrder } from "./resolve.js";
import { renderTemplateText } from "./template_render.js";
import {
  validateAgentYaml,
  validateSkillJson,
  validateTemplateJson,
} from "./schemas.js";

const RESOURCE_URIS = [
  { uri: "btw://repos", name: "Repositories", mimeType: "application/json" },
  { uri: "btw://skills", name: "Skills", mimeType: "application/json" },
  { uri: "btw://agents", name: "Agents", mimeType: "application/json" },
  { uri: "btw://templates", name: "Templates", mimeType: "application/json" },
];

function parseBtwUri(uri: string): {
  kind: string;
  segments: string[];
  params: URLSearchParams;
} {
  const url = new URL(uri);
  const segments = [url.hostname, ...url.pathname.split("/").filter(Boolean)];
  return { kind: url.hostname, segments, params: url.searchParams };
}

function readFilters(params: URLSearchParams): ListFilters {
  return {
    q: params.get("q") ?? undefined,
    repo: params.get("repo") ?? undefined,
    category: params.get("category") ?? undefined,
    tag: params.get("tag") ?? undefined,
    language: params.get("language") ?? undefined,
    tool: params.get("tool") ?? undefined,
    cursor: params.get("cursor") ?? undefined,
    limit: params.get("limit") ? Number(params.get("limit")) : undefined,
  };
}

function jsonContent(uri: string, data: unknown) {
  return {
    contents: [
      {
        uri,
        mimeType: "application/json",
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

async function copyAgentToDirectory(
  agentId: string,
  repoId: string | undefined,
  targetPath: string,
  config: Config,
  registry: Registry,
  index: IndexStore,
  createSubdirectory: boolean = false
): Promise<{
  success: boolean;
  agent_id: string;
  repo_id?: string;
  target_path?: string;
  copied_files?: string[];
  error?: string;
}> {
  try {
    const order = getResolutionOrder(index, registry);
    const searchOrder = repoId ? [repoId] : order;

    let agentItem = null;
    let foundRepoId = "";
    for (const repo of searchOrder) {
      const item = index.getAgent(repo, agentId);
      if (item) {
        agentItem = item;
        foundRepoId = repo;
        break;
      }
    }

    if (!agentItem) {
      const ref = repoId ? `${repoId}/${agentId}` : agentId;
      return {
        success: false,
        agent_id: agentId,
        error: `agent not found: ${ref}`,
      };
    }

    const repoEntry = registry.repos.find((r) => r.id === foundRepoId);
    if (!repoEntry && foundRepoId !== "overlay") {
      return {
        success: false,
        agent_id: agentId,
        error: `repo not found: ${foundRepoId}`,
      };
    }

    const agentSourcePath =
      foundRepoId === "overlay"
        ? path.join(config.overlayPath, "agents", agentId)
        : path.join(repoEntry!.localPath, "agents", agentId);

    try {
      await fs.stat(agentSourcePath);
    } catch {
      return {
        success: false,
        agent_id: agentId,
        error: `agent source path not found: ${agentSourcePath}`,
      };
    }

    const targetDir = createSubdirectory
      ? path.resolve(targetPath, agentId)
      : path.resolve(targetPath);
    await fs.mkdir(targetDir, { recursive: true });

    const filesToCopy = ["agent.yaml", "prompt.md"];
    const copiedFiles: string[] = [];

    for (const file of filesToCopy) {
      const srcFile = path.join(agentSourcePath, file);
      const destFile = path.join(targetDir, file);
      try {
        await fs.copyFile(srcFile, destFile);
        copiedFiles.push(file);
      } catch (err) {
        // File might not exist (optional files), continue
      }
    }

    return {
      success: true,
      agent_id: agentId,
      repo_id: foundRepoId,
      target_path: targetDir,
      copied_files: copiedFiles,
    };
  } catch (err) {
    return {
      success: false,
      agent_id: agentId,
      error: String(err),
    };
  }
}

async function copySkillToDirectory(
  skillId: string,
  repoId: string | undefined,
  targetPath: string,
  config: Config,
  registry: Registry,
  index: IndexStore,
  createSubdirectory: boolean = false
): Promise<{
  success: boolean;
  skill_id: string;
  repo_id?: string;
  target_path?: string;
  copied_files?: string[];
  copied_dirs?: string[];
  error?: string;
}> {
  try {
    const order = getResolutionOrder(index, registry);
    const searchOrder = repoId ? [repoId] : order;

    let skillItem = null;
    let foundRepoId = "";
    for (const repo of searchOrder) {
      const item = index.getSkill(repo, skillId);
      if (item) {
        skillItem = item;
        foundRepoId = repo;
        break;
      }
    }

    if (!skillItem) {
      const ref = repoId ? `${repoId}/${skillId}` : skillId;
      return {
        success: false,
        skill_id: skillId,
        error: `skill not found: ${ref}`,
      };
    }

    const repoEntry = registry.repos.find((r) => r.id === foundRepoId);
    if (!repoEntry && foundRepoId !== "overlay") {
      return {
        success: false,
        skill_id: skillId,
        error: `repo not found: ${foundRepoId}`,
      };
    }

    const skillSourcePath =
      foundRepoId === "overlay"
        ? path.join(config.overlayPath, "skills", skillId)
        : path.join(repoEntry!.localPath, "skills", skillId);

    try {
      await fs.stat(skillSourcePath);
    } catch {
      return {
        success: false,
        skill_id: skillId,
        error: `skill source path not found: ${skillSourcePath}`,
      };
    }

    const targetDir = createSubdirectory
      ? path.resolve(targetPath, skillId)
      : path.resolve(targetPath);
    await fs.mkdir(targetDir, { recursive: true });

    const filesToCopy = ["SKILL.md", "skill.json"];
    const dirsToCopy = ["assets", "scripts", "references"];

    const copiedFiles: string[] = [];
    const copiedDirs: string[] = [];

    for (const file of filesToCopy) {
      const srcFile = path.join(skillSourcePath, file);
      const destFile = path.join(targetDir, file);
      try {
        await fs.copyFile(srcFile, destFile);
        copiedFiles.push(file);
      } catch (err) {
        // File might not exist (e.g., optional files), continue
      }
    }

    for (const dir of dirsToCopy) {
      const srcDir = path.join(skillSourcePath, dir);
      const destDir = path.join(targetDir, dir);
      try {
        await fs.stat(srcDir);
        await fs.cp(srcDir, destDir, { recursive: true });
        copiedDirs.push(dir);
      } catch (err) {
        // Directory might not exist (optional), continue
      }
    }

    return {
      success: true,
      skill_id: skillId,
      repo_id: foundRepoId,
      target_path: targetDir,
      copied_files: copiedFiles,
      copied_dirs: copiedDirs,
    };
  } catch (err) {
    return {
      success: false,
      skill_id: skillId,
      error: String(err),
    };
  }
}

export async function startServer(
  config: Config,
  registry: Registry,
  index: IndexStore
): Promise<void> {
  const server = new Server(
    { name: "btw-mcp", version: "0.1.0" },
    { capabilities: { resources: {}, tools: {} } }
  );

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return { resources: RESOURCE_URIS };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;
    const { kind, segments, params } = parseBtwUri(uri);

    if (kind === "repos" && segments.length === 1) {
      const filters = readFilters(params);
      return jsonContent(uri, index.listRepos(filters));
    }
    if (kind === "skills" && segments.length === 1) {
      const filters = readFilters(params);
      return jsonContent(uri, index.listSkills(filters));
    }
    if (kind === "agents" && segments.length === 1) {
      const filters = readFilters(params);
      return jsonContent(uri, index.listAgents(filters));
    }
    if (kind === "templates" && segments.length === 1) {
      const filters = readFilters(params);
      return jsonContent(uri, index.listTemplates(filters));
    }
    if (kind === "skills" && segments.length === 3) {
      const repoId = segments[1];
      const skillId = segments[2];
      const item = index.getSkill(repoId, skillId);
      if (!item) {
        throw new Error(`skill not found: ${repoId}/${skillId}`);
      }
      return jsonContent(uri, item);
    }
    if (kind === "agents" && segments.length === 3) {
      const repoId = segments[1];
      const agentId = segments[2];
      const item = index.getAgent(repoId, agentId);
      if (!item) {
        throw new Error(`agent not found: ${repoId}/${agentId}`);
      }
      return jsonContent(uri, item);
    }
    if (kind === "templates" && segments.length === 3) {
      const repoId = segments[1];
      const templateId = segments[2];
      const item = index.getTemplate(repoId, templateId);
      if (!item) {
        throw new Error(`template not found: ${repoId}/${templateId}`);
      }
      return jsonContent(uri, item);
    }
    if (
      kind === "skills" &&
      segments.length >= 5 &&
      segments[3] === "assets"
    ) {
      const repoId = segments[1];
      const skillId = segments[2];
      const item = index.getSkill(repoId, skillId);
      if (!item || !item.assetsPath) {
        throw new Error(`skill assets not found: ${repoId}/${skillId}`);
      }
      const assetPath = path.join(item.assetsPath, ...segments.slice(4));
      const content = await fs.readFile(assetPath, "utf8");
      return {
        contents: [
          {
            uri,
            mimeType: "application/octet-stream",
            text: content,
          },
        ],
      };
    }
    if (kind === "repos" && segments.length === 2) {
      const repoId = segments[1];
      const item = index.getRepo(repoId);
      if (!item) {
        throw new Error(`repo not found: ${repoId}`);
      }
      return jsonContent(uri, item);
    }

    throw new Error(`unsupported resource uri: ${uri}`);
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "sync_repo",
          description: "Pull repo updates and rebuild the index",
          inputSchema: {
            type: "object",
            properties: {
              repo_id: { type: "string" },
              force: { type: "boolean" },
            },
          },
        },
        {
          name: "set_active_repo",
          description: "Set the active repo for resource lookups",
          inputSchema: {
            type: "object",
            properties: {
              repo_id: { type: "string" },
            },
            required: ["repo_id"],
          },
        },
        {
          name: "render_template",
          description: "Render a template with variables",
          inputSchema: {
            type: "object",
            properties: {
              repo_id: { type: "string" },
              template_id: { type: "string" },
              variables: { type: "object" },
            },
            required: ["template_id"],
          },
        },
        {
          name: "validate_template",
          description: "Validate template schema and bundle references",
          inputSchema: {
            type: "object",
            properties: {
              repo_id: { type: "string" },
              template_id: { type: "string" },
            },
            required: ["template_id"],
          },
        },
        {
          name: "copy_skills",
          description: "Copy skills from the repository to a target directory",
          inputSchema: {
            type: "object",
            properties: {
              skill_ids: {
                type: "array",
                items: { type: "string" },
              },
              repo_id: { type: "string" },
              target_path: { type: "string" },
            },
            required: ["skill_ids", "target_path"],
          },
        },
        {
          name: "copy_agents",
          description: "Copy agents from the repository to a target directory",
          inputSchema: {
            type: "object",
            properties: {
              agent_ids: {
                type: "array",
                items: { type: "string" },
              },
              repo_id: { type: "string" },
              target_path: { type: "string" },
            },
            required: ["agent_ids", "target_path"],
          },
        },
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name === "sync_repo") {
      const repoId = args?.repo_id ? String(args.repo_id) : undefined;
      const before = index.counts();
      const sync = await syncRepos(config, registry, repoId);
      const rebuild = await buildIndex(config, registry, index);
      const after = index.counts();
      const added = Math.max(after.total - before.total, 0);
      const removed = Math.max(before.total - after.total, 0);
      const syncErrors = sync.errors;
      const validationErrors = rebuild.errors;
      const response = {
        status:
          syncErrors.length === 0 && validationErrors.length === 0
            ? "ok"
            : "partial",
        updated_repos: sync.updatedRepos,
        added,
        updated: 0,
        removed,
        sync_errors: syncErrors,
        validation_errors: validationErrors,
        errors: [...syncErrors, ...validationErrors],
      };
      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
      };
    }

    if (name === "set_active_repo") {
      const repoId = String(args?.repo_id ?? "");
      if (!registry.repos.find((repo) => repo.id === repoId)) {
        throw new Error(`unknown repo: ${repoId}`);
      }
      registry.active_repo_id = repoId;
      await saveRegistry(config, registry);
      const response = { status: "ok", active_repo_id: repoId };
      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
      };
    }

    if (name === "render_template") {
      const templateId = String(args?.template_id ?? "");
      const repoId = args?.repo_id ? String(args.repo_id) : undefined;
      const resolved = resolveTemplateComposed(
        index,
        registry,
        templateId,
        repoId
      );
      if (!resolved.item || resolved.errors.length > 0) {
        throw new Error(
          resolved.errors.join("; ") || `template not found: ${templateId}`
        );
      }
      const template = resolved.item;
      const variables =
        typeof args?.variables === "object" && args?.variables
          ? (args.variables as Record<string, unknown>)
          : {};
      const inputs = Array.isArray(template.metadata.inputs)
        ? template.metadata.inputs
        : [];
      const missingRequired = inputs
        .filter(
          (input) =>
            input &&
            typeof input.name === "string" &&
            input.required === true &&
            variables[input.name] === undefined
        )
        .map((input) => input.name);
      if (missingRequired.length > 0) {
        throw new Error(`missing required inputs: ${missingRequired.join(", ")}`);
      }
      const rendered = renderTemplateText(
        template.body.template_md,
        variables
      );
      const response = {
        rendered_text: rendered.text,
        agents: Array.isArray(template.metadata.agents)
          ? template.metadata.agents
          : [],
        skills: Array.isArray(template.metadata.skills)
          ? template.metadata.skills
          : [],
        metadata: { id: template.id, repo_id: template.repo_id },
        warnings: rendered.missing.length > 0 ? [ "missing variables: " + rendered.missing.join(", ") ] : [],
      };
      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
      };
    }

    if (name === "validate_template") {
      const templateId = String(args?.template_id ?? "");
      const repoId = args?.repo_id ? String(args.repo_id) : undefined;
      const resolved = resolveTemplateComposed(
        index,
        registry,
        templateId,
        repoId
      );
      const errors: string[] = [];
      const warnings: string[] = [];
      if (!resolved.item) {
        errors.push(`missing template ${templateId}`);
      } else if (resolved.errors.length > 0) {
        errors.push(...resolved.errors);
      } else {
        const template = resolved.item;
        const schemaErrors = validateTemplateJson(template.metadata);
        if (schemaErrors.length > 0) {
          errors.push(...schemaErrors);
        }
        const agents = Array.isArray(template.metadata.agents)
          ? template.metadata.agents
          : [];
        const skills = Array.isArray(template.metadata.skills)
          ? template.metadata.skills
          : [];
        const order = getResolutionOrder(index, registry);
        const dependencyOrder = [
          template.repo_id,
          ...order.filter((repo) => repo !== template.repo_id),
        ];
        for (const agentId of agents) {
          if (typeof agentId !== "string") {
            continue;
          }
          const agentRepo = dependencyOrder.find((repo) =>
            index.hasAgent(repo, agentId)
          );
          if (!agentRepo) {
            errors.push(`missing agent ${agentId}`);
            continue;
          }
          const agentItem = index.getAgent(agentRepo, agentId);
          if (agentItem) {
            const agentErrors = validateAgentYaml(agentItem.metadata);
            if (agentErrors.length > 0) {
              errors.push(
                `agent ${agentRepo}/${agentId} invalid: ${agentErrors.join(
                  "; "
                )}`
              );
            }
          }
        }
        for (const skillId of skills) {
          if (typeof skillId !== "string") {
            continue;
          }
          const skillRepo = dependencyOrder.find((repo) =>
            index.hasSkill(repo, skillId)
          );
          if (!skillRepo) {
            errors.push(`missing skill ${skillId}`);
            continue;
          }
          const skillItem = index.getSkill(skillRepo, skillId);
          if (skillItem) {
            const skillErrors = validateSkillJson(skillItem.metadata);
            if (skillErrors.length > 0) {
              errors.push(
                `skill ${skillRepo}/${skillId} invalid: ${skillErrors.join(
                  "; "
                )}`
              );
            }
          }
        }
      }
      const response = {
        valid: errors.length === 0,
        errors,
        warnings,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
      };
    }

    if (name === "copy_skills") {
      const skillIds = Array.isArray(args?.skill_ids)
        ? args.skill_ids.map((id) => String(id))
        : [];
      const repoId = args?.repo_id ? String(args.repo_id) : undefined;
      const targetPath = String(args?.target_path ?? "");

      if (skillIds.length === 0) {
        throw new Error("skill_ids array is required and must not be empty");
      }
      if (!targetPath) {
        throw new Error("target_path is required");
      }

      const results = await Promise.all(
        skillIds.map((skillId) =>
          copySkillToDirectory(
            skillId,
            repoId,
            targetPath,
            config,
            registry,
            index,
            true
          )
        )
      );

      const successful = results.filter((r) => r.success);
      const failed = results.filter((r) => !r.success);

      const response = {
        status: failed.length === 0 ? "ok" : "partial",
        total: results.length,
        successful: successful.length,
        failed: failed.length,
        target_path: path.resolve(targetPath),
        results: results,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
      };
    }

    if (name === "copy_agents") {
      const agentIds = Array.isArray(args?.agent_ids)
        ? args.agent_ids.map((id) => String(id))
        : [];
      const repoId = args?.repo_id ? String(args.repo_id) : undefined;
      const targetPath = String(args?.target_path ?? "");

      if (agentIds.length === 0) {
        throw new Error("agent_ids array is required and must not be empty");
      }
      if (!targetPath) {
        throw new Error("target_path is required");
      }

      const results = await Promise.all(
        agentIds.map((agentId) =>
          copyAgentToDirectory(
            agentId,
            repoId,
            targetPath,
            config,
            registry,
            index,
            true
          )
        )
      );

      const successful = results.filter((r) => r.success);
      const failed = results.filter((r) => !r.success);

      const response = {
        status: failed.length === 0 ? "ok" : "partial",
        total: results.length,
        successful: successful.length,
        failed: failed.length,
        target_path: path.resolve(targetPath),
        results: results,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
      };
    }

    throw new Error(`unsupported tool: ${name}`);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
