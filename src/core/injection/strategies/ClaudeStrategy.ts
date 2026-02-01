/**
 * BTW - Claude Injection Strategy
 * Handles injection into Claude Code's configuration
 *
 * Creates:
 * - .claude/agents/{agent-id}.md - Individual agent files with YAML frontmatter
 * - CLAUDE.md - Project-level workflow information
 */

import { AITarget, Manifest, InjectionResult, AgentDefinition } from '../../../types/index.js';
import { BTWError, ErrorCode } from '../../../types/errors.js';
import {
  BaseInjectionStrategy,
  InjectOptions,
  EjectOptions,
  InjectionStatus,
} from './InjectionStrategy.js';
import { fileSystem } from '../../../infrastructure/fs/FileSystem.js';
import { pathResolver } from '../../../infrastructure/fs/PathResolver.js';
import path from 'path';

/**
 * BTW content markers for identifying injected content
 */
const BTW_START_MARKER = '<!-- BTW_START -->';
const BTW_END_MARKER = '<!-- BTW_END -->';
const BTW_VERSION = '1.0.0';

/**
 * Injection strategy for Claude Code
 * Creates .claude/agents/*.md files and CLAUDE.md
 */
export class ClaudeStrategy extends BaseInjectionStrategy {
  readonly target: AITarget = 'claude';

  /**
   * Inject workflow into Claude configuration
   * Creates individual agent files in .claude/agents/ directory
   * @param manifest - Workflow manifest
   * @param options - Injection options
   */
  async inject(manifest: Manifest, options: InjectOptions): Promise<InjectionResult> {
    const paths = pathResolver.resolveAiToolPaths(options.projectRoot, 'claude');
    const { instructionsPath, agentsPath } = paths;
    const claudeDir = path.join(options.projectRoot, '.claude');

    let backupCreated = false;
    let backupPath: string | undefined;
    const agentFilePaths: string[] = [];

    try {
      // 1. Create .claude and .claude/agents directories
      await fileSystem.mkdir(claudeDir);
      if (agentsPath) {
        await fileSystem.mkdir(agentsPath);
      }

      // 2. Check if this specific workflow is already injected (unless forcing)
      if (!options.force && agentsPath) {
        const isAlreadyInjected = await this.isWorkflowInjected(options.projectRoot, manifest.id);
        if (isAlreadyInjected) {
          throw new BTWError(
            ErrorCode.INJECTION_FAILED,
            `Workflow '${manifest.id}' is already injected. Use --force to re-inject.`,
            {
              context: {
                workflowId: manifest.id,
              },
            }
          );
        }
      }

      // 3. Create backup of existing agents for THIS workflow if requested
      if (options.backup && agentsPath) {
        const existingAgents = await this.findBtwAgentsForWorkflow(agentsPath, manifest.id);
        if (existingAgents.length > 0) {
          // Backup by creating .btw-backup copies
          for (const agentFile of existingAgents) {
            try {
              await fileSystem.backup(agentFile);
              backupCreated = true;
            } catch {
              // Continue if backup fails for individual files
            }
          }
        }
      }

      // 4. Remove existing agents for THIS workflow only if forcing
      if (options.force && agentsPath) {
        const existingAgents = await this.findBtwAgentsForWorkflow(agentsPath, manifest.id);
        for (const agentFile of existingAgents) {
          await fileSystem.remove(agentFile);
        }
      }

      // 5. Create agent files
      for (const agent of manifest.agents) {
        const agentContent = this.generateAgentFile(agent, manifest.id);
        const agentFilePath = path.join(agentsPath!, `${agent.id}.md`);
        await fileSystem.writeFile(agentFilePath, agentContent, { createDirs: true });
        agentFilePaths.push(agentFilePath);
      }

      // 6. Create or update CLAUDE.md with workflow info
      await this.updateClaudeMd(instructionsPath, manifest, options);

      // 7. Return injection result
      return {
        target: 'claude',
        configPath: instructionsPath,
        agentPaths: agentFilePaths,
        agentCount: manifest.agents.length,
        backupCreated,
        backupPath,
      };
    } catch (error) {
      if (error instanceof BTWError) {
        throw error;
      }
      throw new BTWError(
        ErrorCode.INJECTION_FAILED,
        `Failed to inject workflow into Claude configuration: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error instanceof Error ? error : undefined }
      );
    }
  }

  /**
   * Remove injected workflow from Claude configuration
   * @param options - Ejection options
   */
  async eject(options: EjectOptions): Promise<void> {
    const paths = pathResolver.resolveAiToolPaths(options.projectRoot, 'claude');
    const { instructionsPath, agentsPath } = paths;
    const claudeDir = path.join(options.projectRoot, '.claude');

    try {
      // 1. Remove BTW agent files (specific workflow or all)
      if (agentsPath) {
        const btwAgents = options.workflowId
          ? await this.findBtwAgentsForWorkflow(agentsPath, options.workflowId)
          : await this.findBtwAgents(agentsPath);

        for (const agentFile of btwAgents) {
          await fileSystem.remove(agentFile);
          // Also remove backup if exists
          const backupFile = `${agentFile}.btw-backup`;
          if (await fileSystem.exists(backupFile)) {
            await fileSystem.remove(backupFile);
          }
        }

        // Check if agents directory is empty and remove it
        try {
          const remainingFiles = await fileSystem.readdir(agentsPath);
          if (remainingFiles.length === 0) {
            await fileSystem.remove(agentsPath, true);
          }
        } catch {
          // Directory might not exist, that's ok
        }
      }

      // 2. Clean BTW content from CLAUDE.md (only if ejecting all or specific workflow marker found)
      if (await fileSystem.exists(instructionsPath)) {
        const content = await fileSystem.readFile(instructionsPath);

        // Only remove BTW content if ejecting all workflows or if the specific workflow is in CLAUDE.md
        const shouldCleanClaudeMd = !options.workflowId || content.includes(`BTW:${options.workflowId}:`);

        if (shouldCleanClaudeMd) {
          const cleanedContent = this.removeBtwContent(content);

          if (cleanedContent.trim()) {
            await fileSystem.writeFile(instructionsPath, cleanedContent.trim() + '\n');
          } else {
            await fileSystem.remove(instructionsPath);
          }
        }
      }

      // 3. Handle clean option - remove entire .claude directory if empty
      if (options.clean) {
        try {
          const claudeContents = await fileSystem.readdir(claudeDir);
          if (claudeContents.length === 0) {
            await fileSystem.remove(claudeDir, true);
          }
        } catch {
          // Directory might not exist, that's ok
        }
      }
    } catch (error) {
      if (error instanceof BTWError) {
        throw error;
      }
      throw new BTWError(
        ErrorCode.INJECTION_FAILED,
        `Failed to eject workflow from Claude configuration: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error instanceof Error ? error : undefined }
      );
    }
  }

  /**
   * Get current injection status for Claude
   * @param projectRoot - Project root directory
   */
  async getStatus(projectRoot: string): Promise<InjectionStatus> {
    const paths = pathResolver.resolveAiToolPaths(projectRoot, 'claude');
    const { agentsPath } = paths;

    try {
      if (!agentsPath) {
        return { isInjected: false, hasBackup: false };
      }

      // Check for BTW agent files
      const btwAgents = await this.findBtwAgents(agentsPath);

      if (btwAgents.length === 0) {
        return { isInjected: false, hasBackup: false };
      }

      // Get workflow ID from first agent
      const workflowId = await this.getWorkflowIdFromAgents(agentsPath);

      // Check for backups
      let hasBackup = false;
      for (const agentFile of btwAgents) {
        if (await fileSystem.exists(`${agentFile}.btw-backup`)) {
          hasBackup = true;
          break;
        }
      }

      return {
        isInjected: true,
        workflowId: workflowId || undefined,
        hasBackup,
      };
    } catch {
      return { isInjected: false, hasBackup: false };
    }
  }

  /**
   * Validate Claude configuration
   * @param projectRoot - Project root directory
   */
  async validate(projectRoot: string): Promise<boolean> {
    const paths = pathResolver.resolveAiToolPaths(projectRoot, 'claude');
    const { agentsPath, configPath } = paths;

    try {
      // Check agents directory if it exists
      if (agentsPath && await fileSystem.exists(agentsPath)) {
        const files = await fileSystem.readdir(agentsPath);
        for (const file of files) {
          if (file.name.endsWith('.md')) {
            try {
              await fileSystem.readFile(file.path);
            } catch {
              return false;
            }
          }
        }
      }

      // Check settings file if it exists
      if (await fileSystem.exists(configPath)) {
        try {
          const content = await fileSystem.readFile(configPath);
          JSON.parse(content);
        } catch {
          return false;
        }
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Generate Claude settings.json content
   * @param manifest - Workflow manifest
   */
  generateConfig(manifest: Manifest): string {
    const config: Record<string, unknown> = {};

    // Add BTW metadata
    config._btw = {
      workflowId: manifest.id,
      injectedAt: new Date().toISOString(),
      version: BTW_VERSION,
    };

    return JSON.stringify(config, null, 2);
  }

  /**
   * Generate a Claude agent file with YAML frontmatter
   * @param agent - Agent definition
   * @param workflowId - Parent workflow ID for tracking
   */
  generateAgentFile(agent: AgentDefinition, workflowId: string): string {
    const lines: string[] = [];

    // YAML frontmatter
    lines.push('---');
    lines.push(`name: ${agent.id}`);
    lines.push(`description: ${this.escapeYamlString(agent.description)}`);

    // Optional fields
    if (agent.model) {
      // Map model names to Claude's expected format
      const modelMap: Record<string, string> = {
        'claude-3-opus': 'opus',
        'claude-3-sonnet': 'sonnet',
        'claude-3-haiku': 'haiku',
        'claude-opus-4': 'opus',
        'claude-sonnet-4': 'sonnet',
      };
      const mappedModel = modelMap[agent.model] || agent.model;
      lines.push(`model: ${mappedModel}`);
    }

    // BTW metadata for tracking
    lines.push(`# BTW metadata`);
    lines.push(`# workflow: ${workflowId}`);
    lines.push(`# injected: ${new Date().toISOString()}`);
    lines.push('---');
    lines.push('');

    // Agent instructions (system prompt)
    lines.push(agent.systemPrompt);

    return lines.join('\n');
  }

  /**
   * Generate CLAUDE.md content with workflow metadata
   * @param manifest - Workflow manifest
   */
  generateInstructions(manifest: Manifest): string {
    const marker = this.createMarker(manifest.id);
    const lines: string[] = [];

    // Start marker
    lines.push(BTW_START_MARKER);
    lines.push(marker);
    lines.push('');

    // Header section
    lines.push(`# ${manifest.name}`);
    lines.push('');

    if (manifest.description) {
      lines.push(manifest.description);
      lines.push('');
    }

    // Workflow metadata
    lines.push('## Workflow Information');
    lines.push('');
    lines.push(`- **Workflow ID:** ${manifest.id}`);
    lines.push(`- **Version:** ${manifest.version}`);
    if (manifest.author) {
      lines.push(`- **Author:** ${manifest.author}`);
    }
    if (manifest.repository) {
      lines.push(`- **Repository:** ${manifest.repository}`);
    }
    lines.push('');

    // List available agents
    if (manifest.agents.length > 0) {
      lines.push('## Available Agents');
      lines.push('');
      lines.push('This workflow provides the following specialized agents:');
      lines.push('');

      for (const agent of manifest.agents) {
        lines.push(`- **${agent.name}** (\`${agent.id}\`): ${agent.description}`);
      }
      lines.push('');
    }

    // Footer
    lines.push('---');
    lines.push('');
    lines.push(`*Injected by BTW v${BTW_VERSION} at ${new Date().toISOString()}*`);
    lines.push('');
    lines.push(BTW_END_MARKER);

    return lines.join('\n');
  }

  /**
   * Update CLAUDE.md with workflow information
   */
  private async updateClaudeMd(
    claudeMdPath: string,
    manifest: Manifest,
    options: InjectOptions
  ): Promise<void> {
    const btwContent = this.generateInstructions(manifest);
    const exists = await fileSystem.exists(claudeMdPath);

    if (options.merge && exists) {
      const existingContent = await fileSystem.readFile(claudeMdPath);
      const cleanedContent = this.removeBtwContent(existingContent);
      const finalContent = cleanedContent.trim()
        ? `${cleanedContent.trim()}\n\n---\n\n${btwContent}`
        : btwContent;
      await fileSystem.writeFile(claudeMdPath, finalContent);
    } else if (exists && !options.force) {
      // Check if it already has BTW content
      const existingContent = await fileSystem.readFile(claudeMdPath);
      if (existingContent.includes(BTW_START_MARKER)) {
        // Replace existing BTW content
        const cleanedContent = this.removeBtwContent(existingContent);
        const finalContent = cleanedContent.trim()
          ? `${cleanedContent.trim()}\n\n---\n\n${btwContent}`
          : btwContent;
        await fileSystem.writeFile(claudeMdPath, finalContent);
      } else {
        // Append BTW content
        await fileSystem.writeFile(claudeMdPath, `${existingContent.trim()}\n\n---\n\n${btwContent}`);
      }
    } else {
      await fileSystem.writeFile(claudeMdPath, btwContent);
    }
  }

  /**
   * Find all BTW-injected agent files in agents directory
   */
  private async findBtwAgents(agentsPath: string): Promise<string[]> {
    const btwAgents: string[] = [];

    try {
      const files = await fileSystem.readdir(agentsPath);

      for (const file of files) {
        if (!file.name.endsWith('.md') || file.name.endsWith('.btw-backup')) {
          continue;
        }

        try {
          const content = await fileSystem.readFile(file.path);
          // Check if this agent was created by BTW
          if (content.includes('# BTW metadata') || content.includes('# workflow:')) {
            btwAgents.push(file.path);
          }
        } catch {
          // Skip files we can't read
        }
      }
    } catch {
      // Directory doesn't exist yet
    }

    return btwAgents;
  }

  /**
   * Find BTW-injected agent files for a specific workflow
   */
  private async findBtwAgentsForWorkflow(agentsPath: string, workflowId: string): Promise<string[]> {
    const btwAgents: string[] = [];

    try {
      const files = await fileSystem.readdir(agentsPath);

      for (const file of files) {
        if (!file.name.endsWith('.md') || file.name.endsWith('.btw-backup')) {
          continue;
        }

        try {
          const content = await fileSystem.readFile(file.path);
          // Check if this agent belongs to the specified workflow
          const match = content.match(/# workflow: (.+)/);
          if (match && match[1].trim() === workflowId) {
            btwAgents.push(file.path);
          }
        } catch {
          // Skip files we can't read
        }
      }
    } catch {
      // Directory doesn't exist yet
    }

    return btwAgents;
  }

  /**
   * Get workflow ID from existing BTW agents (returns first found)
   */
  private async getWorkflowIdFromAgents(agentsPath: string): Promise<string | null> {
    const ids = await this.getAllWorkflowIdsFromAgents(agentsPath);
    return ids.length > 0 ? ids[0] : null;
  }

  /**
   * Get all workflow IDs from existing BTW agents
   */
  async getAllWorkflowIdsFromAgents(agentsPath: string): Promise<string[]> {
    const workflowIds = new Set<string>();

    try {
      const files = await fileSystem.readdir(agentsPath);

      for (const file of files) {
        if (!file.name.endsWith('.md') || file.name.endsWith('.btw-backup')) {
          continue;
        }

        try {
          const content = await fileSystem.readFile(file.path);

          // Look for workflow comment in frontmatter
          const match = content.match(/# workflow: (.+)/);
          if (match) {
            workflowIds.add(match[1].trim());
          }
        } catch {
          // Skip files we can't read
        }
      }
    } catch {
      // Directory doesn't exist
    }

    return Array.from(workflowIds);
  }

  /**
   * Check if a specific workflow is injected
   */
  async isWorkflowInjected(projectRoot: string, workflowId: string): Promise<boolean> {
    const paths = pathResolver.resolveAiToolPaths(projectRoot, 'claude');
    const { agentsPath } = paths;

    if (!agentsPath) {
      return false;
    }

    const injectedIds = await this.getAllWorkflowIdsFromAgents(agentsPath);
    return injectedIds.includes(workflowId);
  }

  /**
   * Escape a string for use in YAML
   */
  private escapeYamlString(str: string): string {
    // If the string contains special characters, wrap in quotes
    if (str.includes(':') || str.includes('#') || str.includes('\n') ||
        str.startsWith(' ') || str.endsWith(' ')) {
      return `"${str.replace(/"/g, '\\"')}"`;
    }
    return str;
  }

  /**
   * Remove BTW content from existing CLAUDE.md
   */
  private removeBtwContent(content: string): string {
    const startIndex = content.indexOf(BTW_START_MARKER);
    const endIndex = content.indexOf(BTW_END_MARKER);

    if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
      const before = content.substring(0, startIndex);
      const after = content.substring(endIndex + BTW_END_MARKER.length);
      return (before + after).trim();
    }

    return content;
  }
}

/**
 * Singleton instance of ClaudeStrategy
 */
export const claudeStrategy = new ClaudeStrategy();
