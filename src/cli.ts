#!/usr/bin/env node

import { loadConfig, Config } from "./config.js";
import { loadRegistry, saveRegistry, Registry, RepoEntry } from "./registry.js";
import { syncRepos } from "./sync.js";
import { buildIndex } from "./index_builder.js";
import { SqliteIndex } from "./sqlite_index.js";
import { scanRepo } from "./repo_scan.js";
import fs from "node:fs/promises";
import path from "node:path";

interface CLIOptions {
  noUi: boolean;
  ui: boolean;
  json: boolean;
  quiet: boolean;
  verbose: boolean;
  configPath?: string;
}

interface CLIOutput {
  status: "ok" | "error";
  command: string;
  data?: unknown;
  warnings?: string[];
  errors?: string[];
}

function parseArgs(args: string[]): { options: CLIOptions; command: string[]; flags: Record<string, string | boolean> } {
  const options: CLIOptions = {
    noUi: process.env.BTW_NO_UI === "1" || false,
    ui: false,
    json: false,
    quiet: false,
    verbose: false,
  };

  const command: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--no-ui") {
      options.noUi = true;
    } else if (arg === "--ui") {
      options.ui = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--quiet") {
      options.quiet = true;
    } else if (arg === "--verbose") {
      options.verbose = true;
    } else if (arg === "--config" && i + 1 < args.length) {
      options.configPath = args[++i];
    } else if (arg === "--help" || arg === "-h") {
      flags.help = true;
    } else if (arg === "--version" || arg === "-v") {
      flags.version = true;
    } else if (arg.startsWith("--")) {
      const key = arg.slice(2);
      if (i + 1 < args.length && !args[i + 1].startsWith("--")) {
        flags[key] = args[++i];
      } else {
        flags[key] = true;
      }
    } else {
      command.push(arg);
    }
  }

  return { options, command, flags };
}

let globalOptions: CLIOptions = {
  noUi: false,
  ui: false,
  json: false,
  quiet: false,
  verbose: false,
};

function setGlobalOptions(options: CLIOptions): void {
  globalOptions = options;
}

function outputJSON(output: CLIOutput): void {
  console.log(JSON.stringify(output, null, 2));
}

function outputText(message: string): void {
  if (!globalOptions.quiet) {
    console.log(message);
  }
}

function outputError(message: string): void {
  console.error(message);
}

function outputVerbose(message: string): void {
  if (globalOptions.verbose) {
    console.error(`[VERBOSE] ${message}`);
  }
}

function outputDebug(message: string): void {
  if (globalOptions.verbose) {
    console.error(`[DEBUG] ${message}`);
  }
}

async function cmdRepoList(config: Config, options: CLIOptions): Promise<number> {
  try {
    const registry = await loadRegistry(config);

    if (options.json) {
      outputJSON({
        status: "ok",
        command: "btw repo list",
        data: {
          active_repo_id: registry.active_repo_id,
          repos: registry.repos,
        },
      });
    } else {
      outputText(`Active repo: ${registry.active_repo_id || "(none)"}\n`);
      outputText("Registered repos:");
      for (const repo of registry.repos) {
        const active = repo.id === registry.active_repo_id ? " (active)" : "";
        outputText(`  ${repo.id}${active}`);
        outputText(`    URL: ${repo.url}`);
        outputText(`    Branch: ${repo.branch}`);
        outputText(`    Path: ${repo.localPath}`);
        outputText(`    Categories: ${repo.categories.join(", ")}`);
      }
    }
    return 0;
  } catch (err) {
    if (options.json) {
      outputJSON({
        status: "error",
        command: "btw repo list",
        errors: [String(err)],
      });
    } else {
      outputError(`Error: ${String(err)}`);
    }
    return 40;
  }
}

async function cmdRepoAdd(
  config: Config,
  options: CLIOptions,
  url: string,
  flags: Record<string, string | boolean>
): Promise<number> {
  try {
    const branch = (flags.branch as string) || process.env.BTW_BRANCH || "main";
    const repoId = flags.id as string | undefined;

    outputVerbose(`Adding repo: ${url}`);
    outputVerbose(`Branch: ${branch}`);
    if (repoId) {
      outputVerbose(`Repo ID: ${repoId}`);
    }

    const registry = await loadRegistry(config);

    // Extract repo ID from URL if not provided
    let finalRepoId = repoId;
    if (!finalRepoId) {
      const match = url.match(/\/([^/]+?)(?:\.git)?$/);
      if (!match) {
        throw new Error("Could not extract repo ID from URL. Use --id flag.");
      }
      finalRepoId = match[1].toLowerCase().replace(/[^a-z0-9-]/g, "-");
    }

    // Check if repo already exists
    if (registry.repos.find((r) => r.id === finalRepoId)) {
      throw new Error(`Repo ${finalRepoId} already exists`);
    }

    const localPath = path.join(config.reposRoot, finalRepoId);

    // Clone the repo
    const { syncRepos } = await import("./sync.js");
    const tempEntry: RepoEntry = {
      id: finalRepoId,
      url,
      branch,
      localPath,
      categories: [],
    };

    registry.repos.push(tempEntry);

    // Try to sync
    const syncResult = await syncRepos(config, registry, finalRepoId);

    if (syncResult.errors.length > 0) {
      // Remove failed repo
      registry.repos = registry.repos.filter((r) => r.id !== finalRepoId);
      await saveRegistry(config, registry);
      throw new Error(`Failed to clone repo: ${syncResult.errors.join("; ")}`);
    }

    // Validate repo structure
    const scanResult = await scanRepo(finalRepoId, localPath, false);
    if (scanResult.errors.length > 0 && !flags.force) {
      registry.repos = registry.repos.filter((r) => r.id !== finalRepoId);
      await saveRegistry(config, registry);
      throw new Error(`Repo validation failed: ${scanResult.errors.join("; ")}`);
    }

    // Update categories from repo.json if available
    tempEntry.categories = scanResult.repo.categories || [];

    await saveRegistry(config, registry);

    if (options.json) {
      outputJSON({
        status: "ok",
        command: "btw repo add",
        data: { repo_id: finalRepoId, url, branch },
        warnings: scanResult.errors,
      });
    } else {
      outputText(`✓ Added repo: ${finalRepoId}`);
      if (scanResult.errors.length > 0) {
        outputText(`  Warnings: ${scanResult.errors.length} validation issues`);
      }
    }
    return 0;
  } catch (err) {
    if (options.json) {
      outputJSON({
        status: "error",
        command: "btw repo add",
        errors: [String(err)],
      });
    } else {
      outputError(`Error: ${String(err)}`);
    }
    return 40;
  }
}

async function cmdRepoUse(
  config: Config,
  options: CLIOptions,
  repoId: string
): Promise<number> {
  try {
    const registry = await loadRegistry(config);

    if (!registry.repos.find((r) => r.id === repoId)) {
      throw new Error(`Repo ${repoId} not found. Run: btw repo list`);
    }

    registry.active_repo_id = repoId;
    await saveRegistry(config, registry);

    // Rebuild index
    const index = new SqliteIndex(config.indexPath);
    await buildIndex(config, registry, index);

    if (options.json) {
      outputJSON({
        status: "ok",
        command: "btw repo use",
        data: { active_repo_id: repoId },
      });
    } else {
      outputText(`✓ Active repo set to: ${repoId}`);
    }
    return 0;
  } catch (err) {
    if (options.json) {
      outputJSON({
        status: "error",
        command: "btw repo use",
        errors: [String(err)],
      });
    } else {
      outputError(`Error: ${String(err)}`);
    }
    return 40;
  }
}

async function cmdRepoValidate(
  config: Config,
  options: CLIOptions,
  repoId: string
): Promise<number> {
  try {
    const registry = await loadRegistry(config);
    const repo = registry.repos.find((r) => r.id === repoId);

    if (!repo) {
      throw new Error(`Repo ${repoId} not found`);
    }

    const scanResult = await scanRepo(repoId, repo.localPath, false);

    if (options.json) {
      outputJSON({
        status: scanResult.errors.length === 0 ? "ok" : "error",
        command: "btw repo validate",
        data: {
          repo_id: repoId,
          skills_count: scanResult.skills.length,
          agents_count: scanResult.agents.length,
          templates_count: scanResult.templates.length,
        },
        errors: scanResult.errors,
      });
    } else {
      if (scanResult.errors.length === 0) {
        outputText(`✓ Repo ${repoId} is valid`);
        outputText(`  Skills: ${scanResult.skills.length}`);
        outputText(`  Agents: ${scanResult.agents.length}`);
        outputText(`  Templates: ${scanResult.templates.length}`);
      } else {
        outputText(`✗ Repo ${repoId} has validation errors:`);
        for (const error of scanResult.errors) {
          outputText(`  - ${error}`);
        }
      }
    }
    return scanResult.errors.length === 0 ? 0 : 10;
  } catch (err) {
    if (options.json) {
      outputJSON({
        status: "error",
        command: "btw repo validate",
        errors: [String(err)],
      });
    } else {
      outputError(`Error: ${String(err)}`);
    }
    return 40;
  }
}

async function cmdSync(
  config: Config,
  options: CLIOptions,
  flags: Record<string, string | boolean>
): Promise<number> {
  try {
    const registry = await loadRegistry(config);
    const repoId = flags.repo as string | undefined;

    outputVerbose(`Syncing repos${repoId ? ` (repo: ${repoId})` : ""}`);
    outputVerbose(`Total registered repos: ${registry.repos.length}`);

    const syncResult = await syncRepos(config, registry, repoId);

    const index = new SqliteIndex(config.indexPath);
    const buildResult = await buildIndex(config, registry, index);

    const allErrors = [...syncResult.errors, ...buildResult.errors];

    if (options.json) {
      outputJSON({
        status: allErrors.length === 0 ? "ok" : "error",
        command: "btw sync",
        data: {
          updated_repos: syncResult.updatedRepos,
        },
        errors: allErrors,
      });
    } else {
      if (syncResult.updatedRepos.length > 0) {
        outputText(`✓ Synced repos: ${syncResult.updatedRepos.join(", ")}`);
      } else {
        outputText("No repos to sync");
      }
      if (allErrors.length > 0) {
        outputText("\nErrors:");
        for (const error of allErrors) {
          outputText(`  - ${error}`);
        }
      }
    }
    return allErrors.length === 0 ? 0 : 20;
  } catch (err) {
    if (options.json) {
      outputJSON({
        status: "error",
        command: "btw sync",
        errors: [String(err)],
      });
    } else {
      outputError(`Error: ${String(err)}`);
    }
    return 40;
  }
}

async function cmdTemplateList(
  config: Config,
  options: CLIOptions,
  flags: Record<string, string | boolean>
): Promise<number> {
  try {
    const registry = await loadRegistry(config);
    const index = new SqliteIndex(config.indexPath);

    const filters: Record<string, unknown> = {};
    if (flags.repo) filters.repo = String(flags.repo);
    if (flags.category) filters.category = String(flags.category);
    if (flags.tag) filters.tag = String(flags.tag);
    if (flags.q) filters.q = String(flags.q);

    const result = index.listTemplates(filters);

    if (options.json) {
      outputJSON({
        status: "ok",
        command: "btw template list",
        data: {
          total: result.total,
          templates: result.items,
        },
      });
    } else {
      outputText(`Found ${result.total} template(s):\n`);
      for (const template of result.items) {
        outputText(`  ${template.id} (${template.repo_id})`);
        outputText(`    Name: ${template.name}`);
        if (template.description) {
          outputText(`    Description: ${template.description}`);
        }
        if (template.categories.length > 0) {
          outputText(`    Categories: ${template.categories.join(", ")}`);
        }
        if (template.tags.length > 0) {
          outputText(`    Tags: ${template.tags.join(", ")}`);
        }
        outputText("");
      }
    }
    return 0;
  } catch (err) {
    if (options.json) {
      outputJSON({
        status: "error",
        command: "btw template list",
        errors: [String(err)],
      });
    } else {
      outputError(`Error: ${String(err)}`);
    }
    return 40;
  }
}

async function cmdTemplateInit(
  config: Config,
  options: CLIOptions,
  templateId: string
): Promise<number> {
  try {
    // Templates are created in overlay repo
    const overlayPath = path.join(config.reposRoot, "overlay");
    const templatePath = path.join(overlayPath, "templates", templateId);

    // Check if template already exists
    try {
      await fs.access(templatePath);
      throw new Error(`Template ${templateId} already exists in overlay`);
    } catch (err: unknown) {
      // Template doesn't exist, which is what we want
      if (err && typeof err === "object" && "code" in err && err.code !== "ENOENT") {
        throw err;
      }
    }

    // Create template directory
    await fs.mkdir(templatePath, { recursive: true });

    // Create template.json
    const templateJson = {
      id: templateId,
      name: templateId,
      description: "New template created with btw",
      categories: [],
      tags: [],
      variables: {},
    };

    await fs.writeFile(
      path.join(templatePath, "template.json"),
      JSON.stringify(templateJson, null, 2)
    );

    // Create template.md
    const templateMd = `# ${templateId}

{{description}}

## Variables

{{#variables}}
- **{{name}}**: {{description}}
{{/variables}}
`;

    await fs.writeFile(path.join(templatePath, "template.md"), templateMd);

    if (options.json) {
      outputJSON({
        status: "ok",
        command: "btw template init",
        data: {
          template_id: templateId,
          path: templatePath,
        },
      });
    } else {
      outputText(`✓ Created template: ${templateId}`);
      outputText(`  Path: ${templatePath}`);
    }
    return 0;
  } catch (err) {
    if (options.json) {
      outputJSON({
        status: "error",
        command: "btw template init",
        errors: [String(err)],
      });
    } else {
      outputError(`Error: ${String(err)}`);
    }
    return 40;
  }
}

async function cmdTemplateEdit(
  config: Config,
  options: CLIOptions,
  templateId: string
): Promise<number> {
  try {
    const registry = await loadRegistry(config);
    const index = new SqliteIndex(config.indexPath);

    // Find template in overlay first
    const overlayPath = path.join(config.reposRoot, "overlay");
    const overlayTemplatePath = path.join(overlayPath, "templates", templateId);

    let templatePath = overlayTemplatePath;

    try {
      await fs.access(overlayTemplatePath);
    } catch {
      // Template not in overlay, find in repos
      const template = index.getTemplate("overlay", templateId);
      if (!template) {
        // Search in other repos
        for (const repo of registry.repos) {
          const t = index.getTemplate(repo.id, templateId);
          if (t) {
            throw new Error(
              `Template ${templateId} exists in repo ${t.repo_id} but not in overlay. Use 'btw template fetch ${templateId}' first.`
            );
          }
        }
        throw new Error(`Template ${templateId} not found`);
      }
    }

    const editor = process.env.EDITOR || process.env.VISUAL;
    if (!editor) {
      throw new Error(
        "No editor configured. Set $EDITOR or $VISUAL environment variable."
      );
    }

    const { execFileSync } = await import("node:child_process");
    const templateMdPath = path.join(templatePath, "template.md");

    execFileSync(editor, [templateMdPath], { stdio: "inherit" });

    if (options.json) {
      outputJSON({
        status: "ok",
        command: "btw template edit",
        data: {
          template_id: templateId,
          path: templatePath,
        },
      });
    } else {
      outputText(`✓ Edited template: ${templateId}`);
    }
    return 0;
  } catch (err) {
    if (options.json) {
      outputJSON({
        status: "error",
        command: "btw template edit",
        errors: [String(err)],
      });
    } else {
      outputError(`Error: ${String(err)}`);
    }
    return 40;
  }
}

async function cmdTemplateFetch(
  config: Config,
  options: CLIOptions,
  templateId: string,
  flags: Record<string, string | boolean>
): Promise<number> {
  try {
    const registry = await loadRegistry(config);
    const index = new SqliteIndex(config.indexPath);

    const repoId = flags.repo as string | undefined;

    // Find template
    let templateItem = null;
    let sourceRepoId = "";

    if (repoId) {
      templateItem = index.getTemplate(repoId, templateId);
      sourceRepoId = repoId;
    } else {
      // Search in all repos
      for (const repo of registry.repos) {
        templateItem = index.getTemplate(repo.id, templateId);
        if (templateItem) {
          sourceRepoId = repo.id;
          break;
        }
      }
    }

    if (!templateItem) {
      throw new Error(
        `Template ${templateId} not found${repoId ? ` in repo ${repoId}` : ""}`
      );
    }

    // Copy to overlay
    const overlayPath = path.join(config.reposRoot, "overlay");
    const sourceRepo = registry.repos.find((r) => r.id === sourceRepoId);
    if (!sourceRepo) {
      throw new Error(`Source repo ${sourceRepoId} not found in registry`);
    }

    const sourcePath = path.join(sourceRepo.localPath, "templates", templateId);
    const targetPath = path.join(overlayPath, "templates", templateId);

    // Copy template directory
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.cp(sourcePath, targetPath, { recursive: true });

    // Rebuild index to include the fetched template
    await buildIndex(config, registry, index);

    if (options.json) {
      outputJSON({
        status: "ok",
        command: "btw template fetch",
        data: {
          template_id: templateId,
          source_repo: sourceRepoId,
          target_path: targetPath,
        },
      });
    } else {
      outputText(`✓ Fetched template: ${templateId}`);
      outputText(`  From: ${sourceRepoId}`);
      outputText(`  To: ${targetPath}`);
    }
    return 0;
  } catch (err) {
    if (options.json) {
      outputJSON({
        status: "error",
        command: "btw template fetch",
        errors: [String(err)],
      });
    } else {
      outputError(`Error: ${String(err)}`);
    }
    return 40;
  }
}

async function cmdTemplateValidate(
  config: Config,
  options: CLIOptions,
  templateId: string,
  flags: Record<string, string | boolean>
): Promise<number> {
  try {
    const registry = await loadRegistry(config);
    const index = new SqliteIndex(config.indexPath);

    const repoId = flags.repo as string | undefined;

    // Find template
    let templateItem = null;
    let foundRepoId = "";

    if (repoId) {
      templateItem = index.getTemplate(repoId, templateId);
      foundRepoId = repoId;
    } else {
      // Check overlay first
      templateItem = index.getTemplate("overlay", templateId);
      foundRepoId = "overlay";

      if (!templateItem && registry.active_repo_id) {
        templateItem = index.getTemplate(registry.active_repo_id, templateId);
        foundRepoId = registry.active_repo_id;
      }

      if (!templateItem) {
        for (const repo of registry.repos) {
          templateItem = index.getTemplate(repo.id, templateId);
          if (templateItem) {
            foundRepoId = repo.id;
            break;
          }
        }
      }
    }

    if (!templateItem) {
      throw new Error(
        `Template ${templateId} not found${repoId ? ` in repo ${repoId}` : ""}`
      );
    }

    // Validate using existing validation logic
    const { validateTemplateJson } = await import("./schemas.js");
    const errors: string[] = [];

    const validationErrors = validateTemplateJson(templateItem.metadata);
    errors.push(...validationErrors);

    // Additional validation: check if template.md exists
    if (!templateItem.body.template_md) {
      errors.push("template.md is missing or empty");
    }

    if (options.json) {
      outputJSON({
        status: errors.length === 0 ? "ok" : "error",
        command: "btw template validate",
        data: {
          template_id: templateId,
          repo_id: foundRepoId,
        },
        errors,
      });
    } else {
      if (errors.length === 0) {
        outputText(`✓ Template ${templateId} is valid`);
      } else {
        outputText(`✗ Template ${templateId} validation failed:`);
        for (const error of errors) {
          outputText(`  - ${error}`);
        }
      }
    }
    return errors.length === 0 ? 0 : 10;
  } catch (err) {
    if (options.json) {
      outputJSON({
        status: "error",
        command: "btw template validate",
        errors: [String(err)],
      });
    } else {
      outputError(`Error: ${String(err)}`);
    }
    return 40;
  }
}

async function cmdInjectCodex(
  config: Config,
  options: CLIOptions,
  flags: Record<string, string | boolean>
): Promise<number> {
  try {
    const dryRun = !!flags["dry-run"];
    const yes = !!flags.yes;
    const configPathOverride = flags.path as string | undefined;

    // Detect Codex config path
    const home = process.env.HOME || process.env.USERPROFILE || "";
    const defaultCodexPaths = [
      path.join(home, ".codex", "config.json"),
      path.join(home, ".config", "codex", "config.json"),
    ];

    let codexConfigPath = configPathOverride;
    if (!codexConfigPath) {
      for (const p of defaultCodexPaths) {
        try {
          await fs.access(p);
          codexConfigPath = p;
          break;
        } catch {
          // Try next path
        }
      }
    }

    if (!codexConfigPath) {
      throw new Error(
        "Codex config not found. Use --path to specify config location."
      );
    }

    // Read existing config
    let codexConfig: Record<string, unknown> = {};
    try {
      const content = await fs.readFile(codexConfigPath, "utf-8");
      codexConfig = JSON.parse(content);
    } catch (err) {
      throw new Error(`Failed to read Codex config: ${String(err)}`);
    }

    // Prepare BTW MCP server config
    const mcpServers = (codexConfig.mcpServers as Record<string, unknown>) || {};
    const btwConfig = {
      command: "node",
      args: [path.join(config.reposRoot, "..", "dist", "index.js")],
      env: {},
    };

    // Check if already configured
    if (mcpServers.btw) {
      if (options.json) {
        outputJSON({
          status: "ok",
          command: "btw inject codex",
          data: {
            message: "BTW MCP server already configured in Codex",
            config_path: codexConfigPath,
          },
        });
      } else {
        outputText("✓ BTW MCP server already configured in Codex");
        outputText(`  Config: ${codexConfigPath}`);
      }
      return 0;
    }

    // Show preview
    if (!options.json && !yes) {
      outputText("Preview of changes to Codex config:");
      outputText(`  Path: ${codexConfigPath}\n`);
      outputText("  Adding MCP server configuration:");
      outputText(JSON.stringify({ mcpServers: { btw: btwConfig } }, null, 2));
      outputText("\nProceed? (use --yes to skip this prompt)");

      if (options.noUi) {
        throw new Error("Cannot prompt in non-interactive mode. Use --yes flag.");
      }

      // In interactive mode, we would prompt here
      // For now, require --yes flag
      throw new Error("Interactive mode not yet implemented. Use --yes flag.");
    }

    if (dryRun) {
      if (options.json) {
        outputJSON({
          status: "ok",
          command: "btw inject codex",
          data: {
            dry_run: true,
            config_path: codexConfigPath,
            changes: { btw: btwConfig },
          },
        });
      } else {
        outputText("✓ Dry run - no changes made");
        outputText(`  Would modify: ${codexConfigPath}`);
      }
      return 0;
    }

    // Backup original config
    const backupPath = `${codexConfigPath}.backup.${Date.now()}`;
    await fs.copyFile(codexConfigPath, backupPath);

    // Apply changes
    mcpServers.btw = btwConfig;
    codexConfig.mcpServers = mcpServers;

    await fs.writeFile(codexConfigPath, JSON.stringify(codexConfig, null, 2));

    if (options.json) {
      outputJSON({
        status: "ok",
        command: "btw inject codex",
        data: {
          config_path: codexConfigPath,
          backup_path: backupPath,
        },
      });
    } else {
      outputText("✓ BTW MCP server configured in Codex");
      outputText(`  Config: ${codexConfigPath}`);
      outputText(`  Backup: ${backupPath}`);
      outputText("\nTo revert: cp " + backupPath + " " + codexConfigPath);
    }
    return 0;
  } catch (err) {
    if (options.json) {
      outputJSON({
        status: "error",
        command: "btw inject codex",
        errors: [String(err)],
      });
    } else {
      outputError(`Error: ${String(err)}`);
    }
    return 30;
  }
}

async function cmdInjectClaude(
  config: Config,
  options: CLIOptions,
  flags: Record<string, string | boolean>
): Promise<number> {
  try {
    const dryRun = !!flags["dry-run"];
    const yes = !!flags.yes;
    const configPathOverride = flags.path as string | undefined;

    // Detect Claude config path
    const home = process.env.HOME || process.env.USERPROFILE || "";
    const defaultClaudePaths = [
      path.join(home, ".config", "claude", "config.json"),
      path.join(home, "Library", "Application Support", "Claude", "config.json"),
    ];

    let claudeConfigPath = configPathOverride;
    if (!claudeConfigPath) {
      for (const p of defaultClaudePaths) {
        try {
          await fs.access(p);
          claudeConfigPath = p;
          break;
        } catch {
          // Try next path
        }
      }
    }

    if (!claudeConfigPath) {
      throw new Error(
        "Claude config not found. Use --path to specify config location."
      );
    }

    // Read existing config
    let claudeConfig: Record<string, unknown> = {};
    try {
      const content = await fs.readFile(claudeConfigPath, "utf-8");
      claudeConfig = JSON.parse(content);
    } catch (err) {
      throw new Error(`Failed to read Claude config: ${String(err)}`);
    }

    // Prepare BTW MCP server config
    const mcpServers = (claudeConfig.mcpServers as Record<string, unknown>) || {};
    const btwConfig = {
      command: "node",
      args: [path.join(config.reposRoot, "..", "dist", "index.js")],
      env: {},
    };

    // Check if already configured
    if (mcpServers.btw) {
      if (options.json) {
        outputJSON({
          status: "ok",
          command: "btw inject claude",
          data: {
            message: "BTW MCP server already configured in Claude",
            config_path: claudeConfigPath,
          },
        });
      } else {
        outputText("✓ BTW MCP server already configured in Claude");
        outputText(`  Config: ${claudeConfigPath}`);
      }
      return 0;
    }

    // Show preview
    if (!options.json && !yes) {
      outputText("Preview of changes to Claude config:");
      outputText(`  Path: ${claudeConfigPath}\n`);
      outputText("  Adding MCP server configuration:");
      outputText(JSON.stringify({ mcpServers: { btw: btwConfig } }, null, 2));
      outputText("\nProceed? (use --yes to skip this prompt)");

      if (options.noUi) {
        throw new Error("Cannot prompt in non-interactive mode. Use --yes flag.");
      }

      // In interactive mode, we would prompt here
      // For now, require --yes flag
      throw new Error("Interactive mode not yet implemented. Use --yes flag.");
    }

    if (dryRun) {
      if (options.json) {
        outputJSON({
          status: "ok",
          command: "btw inject claude",
          data: {
            dry_run: true,
            config_path: claudeConfigPath,
            changes: { btw: btwConfig },
          },
        });
      } else {
        outputText("✓ Dry run - no changes made");
        outputText(`  Would modify: ${claudeConfigPath}`);
      }
      return 0;
    }

    // Backup original config
    const backupPath = `${claudeConfigPath}.backup.${Date.now()}`;
    await fs.copyFile(claudeConfigPath, backupPath);

    // Apply changes
    mcpServers.btw = btwConfig;
    claudeConfig.mcpServers = mcpServers;

    await fs.writeFile(claudeConfigPath, JSON.stringify(claudeConfig, null, 2));

    if (options.json) {
      outputJSON({
        status: "ok",
        command: "btw inject claude",
        data: {
          config_path: claudeConfigPath,
          backup_path: backupPath,
        },
      });
    } else {
      outputText("✓ BTW MCP server configured in Claude");
      outputText(`  Config: ${claudeConfigPath}`);
      outputText(`  Backup: ${backupPath}`);
      outputText("\nTo revert: cp " + backupPath + " " + claudeConfigPath);
    }
    return 0;
  } catch (err) {
    if (options.json) {
      outputJSON({
        status: "error",
        command: "btw inject claude",
        errors: [String(err)],
      });
    } else {
      outputError(`Error: ${String(err)}`);
    }
    return 30;
  }
}

async function cmdDoctor(
  config: Config,
  options: CLIOptions
): Promise<number> {
  try {
    const issues: string[] = [];
    const warnings: string[] = [];

    // Check 1: Config file exists
    try {
      await fs.access(config.configPath);
    } catch {
      issues.push(`Config file not found: ${config.configPath}`);
    }

    // Check 2: Load registry
    let registry;
    try {
      registry = await loadRegistry(config);
    } catch (err) {
      issues.push(`Failed to load registry: ${String(err)}`);
      if (options.json) {
        outputJSON({
          status: "error",
          command: "btw doctor",
          errors: issues,
        });
      } else {
        outputText("✗ Health check failed\n");
        for (const issue of issues) {
          outputText(`  - ${issue}`);
        }
      }
      return 10;
    }

    // Check 3: Repos root exists
    try {
      await fs.access(config.reposRoot);
    } catch {
      issues.push(`Repos root not found: ${config.reposRoot}`);
    }

    // Check 4: Overlay repo exists
    const overlayPath = path.join(config.reposRoot, "overlay");
    try {
      await fs.access(overlayPath);
    } catch {
      warnings.push(`Overlay repo not found: ${overlayPath}`);
    }

    // Check 5: Index exists
    try {
      await fs.access(config.indexPath);
    } catch {
      warnings.push(`Index not found: ${config.indexPath} (run 'btw sync' to rebuild)`);
    }

    // Check 6: Validate each registered repo
    for (const repo of registry.repos) {
      try {
        await fs.access(repo.localPath);
      } catch {
        issues.push(`Repo ${repo.id} path not found: ${repo.localPath}`);
        continue;
      }

      // Validate repo structure
      const scanResult = await scanRepo(repo.id, repo.localPath, false);
      if (scanResult.errors.length > 0) {
        issues.push(`Repo ${repo.id} validation failed:`);
        for (const error of scanResult.errors) {
          issues.push(`    ${error}`);
        }
      }
    }

    // Check 7: Active repo is valid
    if (registry.active_repo_id) {
      const activeRepo = registry.repos.find((r) => r.id === registry.active_repo_id);
      if (!activeRepo) {
        issues.push(`Active repo ${registry.active_repo_id} not found in registry`);
      }
    }

    // Check 8: Index integrity
    if (issues.length === 0) {
      try {
        const index = new SqliteIndex(config.indexPath);
        const counts = index.counts();
        if (counts.total === 0 && registry.repos.length > 0) {
          warnings.push("Index is empty but repos are registered (run 'btw sync')");
        }
      } catch (err) {
        warnings.push(`Index integrity check failed: ${String(err)}`);
      }
    }

    if (options.json) {
      outputJSON({
        status: issues.length === 0 ? "ok" : "error",
        command: "btw doctor",
        data: {
          issues_count: issues.length,
          warnings_count: warnings.length,
        },
        warnings,
        errors: issues,
      });
    } else {
      if (issues.length === 0 && warnings.length === 0) {
        outputText("✓ All health checks passed\n");
        outputText(`  Repos: ${registry.repos.length}`);
        outputText(`  Active repo: ${registry.active_repo_id || "(none)"}`);
      } else {
        if (issues.length > 0) {
          outputText("✗ Health check found issues:\n");
          for (const issue of issues) {
            outputText(`  - ${issue}`);
          }
        }
        if (warnings.length > 0) {
          outputText("\n⚠ Warnings:\n");
          for (const warning of warnings) {
            outputText(`  - ${warning}`);
          }
        }
        outputText("\nRecommended actions:");
        if (warnings.some((w) => w.includes("run 'btw sync'"))) {
          outputText("  - Run 'btw sync' to rebuild index");
        }
        if (issues.some((i) => i.includes("path not found"))) {
          outputText("  - Remove invalid repos or re-clone them");
        }
      }
    }

    return issues.length === 0 ? 0 : 10;
  } catch (err) {
    if (options.json) {
      outputJSON({
        status: "error",
        command: "btw doctor",
        errors: [String(err)],
      });
    } else {
      outputError(`Error: ${String(err)}`);
    }
    return 40;
  }
}

function showHelp(): void {
  console.log(`BTW - Bring The Workers
CLI for managing skills, agents, and templates

Usage:
  btw <command> [options]

Commands:
  repo list                             List registered repos
  repo add <url> [--branch <b>]         Add a GitHub repo
  repo use <repo-id>                    Set active repo
  repo validate <repo-id>               Validate repo structure
  sync [--repo <repo-id>]               Sync repos and rebuild index

  template list [--repo <id>]           List templates
                [--category <c>]
                [--tag <t>] [--q <term>]
  template init <template-id>           Create new template
  template edit <template-id>           Edit template in $EDITOR
  template fetch <template-id>          Fetch template to overlay
                 [--repo <repo-id>]
  template validate <template-id>       Validate template schema
                    [--repo <repo-id>]

  doctor                                Run health checks
  inject codex [--yes] [--dry-run]      Inject BTW into Codex config
  inject claude [--yes] [--dry-run]     Inject BTW into Claude config

Global Options:
  --no-ui         Disable TUI and prompts
  --json          Output JSON
  --quiet         Only errors to stderr
  --verbose       Verbose logs
  --config <path> Override config path
  --help, -h      Show help
  --version, -v   Show version
`);
}

function showVersion(): void {
  console.log("btw version 0.1.0");
}

function isTTY(): boolean {
  return !!(process.stdout.isTTY && process.stdin.isTTY);
}

function shouldUseTUI(options: CLIOptions, command: string[]): boolean {
  // Force TUI if --ui is set
  if (options.ui) {
    return true;
  }

  // Never use TUI if --no-ui is set
  if (options.noUi) {
    return false;
  }

  // Never use TUI in JSON mode
  if (options.json) {
    return false;
  }

  // Never use TUI if a command is provided (non-interactive)
  if (command.length > 0) {
    return false;
  }

  // Use TUI if running in a TTY and no command provided
  return isTTY();
}

async function runTUI(config: Config): Promise<number> {
  const { BTW_TUI } = await import("./tui.js");
  const tui = new BTW_TUI(config);
  await tui.run();
  return 0;
}

async function main() {
  const args = process.argv.slice(2);
  const { options, command, flags } = parseArgs(args);

  // Set global options for logging
  setGlobalOptions(options);

  if (flags.help) {
    showHelp();
    process.exit(0);
  }

  if (flags.version) {
    showVersion();
    process.exit(0);
  }

  // Load config early (needed for both TUI and CLI modes)
  const config = loadConfig();
  if (options.configPath) {
    config.configPath = options.configPath;
  }

  // Check if we should run TUI mode
  if (shouldUseTUI(options, command)) {
    process.exit(await runTUI(config));
  }

  if (command.length === 0) {
    showHelp();
    process.exit(2);
  }

  outputVerbose(`Config loaded from ${config.configPath}`);
  outputVerbose(`Repos root: ${config.reposRoot}`);
  outputVerbose(`Index path: ${config.indexPath}`);

  const [cmd, subcmd, ...rest] = command;

  try {
    if (cmd === "repo") {
      if (subcmd === "list") {
        process.exit(await cmdRepoList(config, options));
      } else if (subcmd === "add" && rest.length > 0) {
        process.exit(await cmdRepoAdd(config, options, rest[0], flags));
      } else if (subcmd === "use" && rest.length > 0) {
        process.exit(await cmdRepoUse(config, options, rest[0]));
      } else if (subcmd === "validate" && rest.length > 0) {
        process.exit(await cmdRepoValidate(config, options, rest[0]));
      } else {
        outputError("Invalid repo command. Run: btw --help");
        process.exit(2);
      }
    } else if (cmd === "template") {
      if (subcmd === "list") {
        process.exit(await cmdTemplateList(config, options, flags));
      } else if (subcmd === "init" && rest.length > 0) {
        process.exit(await cmdTemplateInit(config, options, rest[0]));
      } else if (subcmd === "edit" && rest.length > 0) {
        process.exit(await cmdTemplateEdit(config, options, rest[0]));
      } else if (subcmd === "fetch" && rest.length > 0) {
        process.exit(await cmdTemplateFetch(config, options, rest[0], flags));
      } else if (subcmd === "validate" && rest.length > 0) {
        process.exit(await cmdTemplateValidate(config, options, rest[0], flags));
      } else {
        outputError("Invalid template command. Run: btw --help");
        process.exit(2);
      }
    } else if (cmd === "sync") {
      process.exit(await cmdSync(config, options, flags));
    } else if (cmd === "doctor") {
      process.exit(await cmdDoctor(config, options));
    } else if (cmd === "inject") {
      if (subcmd === "codex") {
        process.exit(await cmdInjectCodex(config, options, flags));
      } else if (subcmd === "claude") {
        process.exit(await cmdInjectClaude(config, options, flags));
      } else {
        outputError("Invalid inject command. Run: btw --help");
        process.exit(2);
      }
    } else {
      outputError(`Unknown command: ${cmd}. Run: btw --help`);
      process.exit(2);
    }
  } catch (err) {
    outputError(`Unexpected error: ${String(err)}`);
    process.exit(40);
  }
}

main();
