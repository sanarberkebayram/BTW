/**
 * BTW - Inject Command
 * CLI command for injecting workflows into AI tools
 */

import { Command } from 'commander';
import { injectionEngine } from '../../core/injection/InjectionEngine.js';
import { workflowManager } from '../../core/workflow/WorkflowManager.js';
import { AITarget, Manifest } from '../../types/index.js';
import { output } from '../utils/output.js';
import { BTWError } from '../../types/errors.js';
import { runInteractiveSelector, ListItem } from '../utils/interactive.js';
import { fileSystem } from '../../infrastructure/fs/FileSystem.js';
import { pathResolver } from '../../infrastructure/fs/PathResolver.js';
import { manifestParser } from '../../core/manifest/ManifestParser.js';
import { MANIFEST_FILENAME } from '../../infrastructure/config/constants.js';
import path from 'path';

/**
 * Create the 'inject' command
 */
export function createInjectCommand(): Command {
  const command = new Command('inject')
    .description('Inject a workflow into AI tool configuration')
    .argument('[workflow-id]', 'Workflow ID to inject (optional with --interactive)')
    .option('-i, --interactive', 'Interactive mode - select from installed workflows')
    .option('-t, --target <target>', 'AI target (claude, cursor, windsurf, copilot)', 'claude')
    .option('-p, --project <path>', 'Project path (defaults to current directory)')
    .option('--no-backup', 'Skip creating backup of existing configuration')
    .option('-f, --force', 'Force injection even if config already exists')
    .option('--merge', 'Merge with existing configuration instead of replacing')
    .action(async (workflowId: string | undefined, options: InjectCommandOptions) => {
      if (options.interactive) {
        await executeInteractive(options);
      } else if (workflowId) {
        await executeInject(workflowId, options);
      } else {
        output.error('Please provide a workflow ID or use --interactive mode');
        output.log('Usage: btw inject <workflow-id> or btw inject --interactive');
        process.exitCode = 1;
      }
    });

  return command;
}

/**
 * Command options
 */
interface InjectCommandOptions {
  interactive?: boolean;
  target: string;
  project?: string;
  backup: boolean;
  force?: boolean;
  merge?: boolean;
}

/**
 * Get all installed workflows with their injection status
 */
async function getAllWorkflowsWithStatus(
  projectRoot: string,
  target: AITarget
): Promise<ListItem[]> {
  const items: ListItem[] = [];

  // Get workflows directory
  const workflowsDir = pathResolver.getWorkflowsDir();

  // Check if workflows directory exists
  const dirExists = await fileSystem.exists(workflowsDir);
  if (!dirExists) {
    return items;
  }

  // List all workflow directories
  const entries = await fileSystem.readdir(workflowsDir);

  for (const entry of entries) {
    // Skip non-directories
    if (!entry.isDirectory) {
      continue;
    }

    const workflowPath = entry.path;
    const manifestPath = path.join(workflowPath, MANIFEST_FILENAME);

    // Check if it's a valid workflow with manifest
    const manifestExists = await fileSystem.exists(manifestPath);
    if (!manifestExists) {
      continue;
    }

    try {
      // Parse manifest
      const parsed = await manifestParser.parseFile(manifestPath);
      const manifest = parsed.manifest;

      // Check if workflow supports the target
      if (!manifest.targets.includes(target)) {
        continue;
      }

      // Check injection status
      const status = await injectionEngine.getStatus(target, projectRoot);
      const isInjected = status.isInjected && status.workflowId === manifest.id;

      items.push({
        id: manifest.id,
        label: manifest.name,
        description: manifest.description,
        isActive: isInjected,
        meta: { manifest },
      });
    } catch {
      // Skip workflows with invalid manifests
    }
  }

  return items;
}

/**
 * Execute interactive mode
 */
async function executeInteractive(options: InjectCommandOptions): Promise<void> {
  const projectRoot = options.project || process.cwd();
  const target = options.target as AITarget;

  // Validate target
  const validTargets: AITarget[] = ['claude', 'cursor', 'windsurf', 'copilot'];
  if (!validTargets.includes(target)) {
    output.error(`Invalid target: ${options.target}`);
    output.log(`Valid targets: ${validTargets.join(', ')}`);
    process.exitCode = 1;
    return;
  }

  // Check if target is supported
  if (!injectionEngine.isTargetSupported(target)) {
    output.error(`Target '${target}' is not yet supported`);
    process.exitCode = 1;
    return;
  }

  // Run interactive selector
  await runInteractiveSelector(
    // Get items
    async () => getAllWorkflowsWithStatus(projectRoot, target),

    // Toggle callback
    async (workflowId: string, currentlyActive: boolean) => {
      if (currentlyActive) {
        // Eject the workflow
        const result = await injectionEngine.eject(target, {
          projectRoot,
          clean: false,
        });

        if (!result.success) {
          throw new Error(result.error || 'Failed to remove workflow');
        }
      } else {
        // Inject the workflow
        const workflowResult = await workflowManager.get(workflowId);
        if (!workflowResult.success || !workflowResult.data?.manifest) {
          throw new Error(workflowResult.error || `Workflow '${workflowId}' not found`);
        }

        const manifest = workflowResult.data.manifest;

        const result = await injectionEngine.inject(manifest, target, {
          projectRoot,
          backup: options.backup,
          force: true, // Always force in interactive mode since we're toggling
          merge: options.merge ?? false,
        });

        if (!result.success) {
          throw new Error(result.error || 'Failed to inject workflow');
        }
      }
    },

    // Options
    {
      title: `BTW Workflows (target: ${target})`,
      helpText: '[↑/↓/j/k] Navigate  [Enter] Toggle inject/remove  [Esc/q] Quit',
      emptyMessage: `No workflows found. Add one with: btw add <source>`,
      activeLabel: 'injected',
      inactiveLabel: 'available',
    }
  );
}

/**
 * Execute the inject command
 * @param workflowId - Workflow ID to inject
 * @param options - Command options
 */
async function executeInject(
  workflowId: string,
  options: InjectCommandOptions
): Promise<void> {
  const projectRoot = options.project || process.cwd();
  const target = options.target as AITarget;

  // Validate target
  const validTargets: AITarget[] = ['claude', 'cursor', 'windsurf', 'copilot'];
  if (!validTargets.includes(target)) {
    output.error(`Invalid target: ${options.target}`);
    output.log(`Valid targets: ${validTargets.join(', ')}`);
    process.exitCode = 1;
    return;
  }

  // Check if target is supported
  if (!injectionEngine.isTargetSupported(target)) {
    output.error(`Target '${target}' is not yet supported`);
    process.exitCode = 1;
    return;
  }

  output.info(`Injecting workflow '${workflowId}' into ${target}...`);
  output.keyValue('Project', projectRoot);

  try {
    // Get workflow details
    const workflowResult = await workflowManager.get(workflowId);
    if (!workflowResult.success || !workflowResult.data?.manifest) {
      output.error(workflowResult.error || `Workflow '${workflowId}' not found`);
      process.exitCode = 1;
      return;
    }

    const manifest = workflowResult.data.manifest;

    // Check if manifest supports target
    if (!injectionEngine.validateManifestForTarget(manifest, target)) {
      output.error(`Workflow '${workflowId}' does not support target '${target}'`);
      output.log(`Supported targets: ${manifest.targets.join(', ')}`);
      process.exitCode = 1;
      return;
    }

    // Perform injection
    const result = await injectionEngine.inject(manifest, target, {
      projectRoot,
      backup: options.backup,
      force: options.force ?? false,
      merge: options.merge ?? false,
    });

    if (result.success && result.data) {
      output.success(`Workflow injected successfully`);
      output.keyValue('Config Path', result.data.configPath);
      output.keyValue('Agents Injected', result.data.agentCount.toString());

      if (result.data.backupCreated && result.data.backupPath) {
        output.keyValue('Backup', result.data.backupPath);
      }
    } else {
      output.error(result.error || 'Failed to inject workflow');
      process.exitCode = 1;
    }
  } catch (error) {
    if (BTWError.isBTWError(error)) {
      output.formatError(error);
    } else {
      output.error(`Unexpected error: ${error}`);
    }
    process.exitCode = 1;
  }
}

export default createInjectCommand;
