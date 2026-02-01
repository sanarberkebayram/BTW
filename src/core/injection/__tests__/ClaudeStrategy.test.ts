/**
 * BTW - ClaudeStrategy Unit Tests
 * Tests for Claude Code injection strategy with .claude/agents/ folder structure
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ClaudeStrategy } from '../strategies/ClaudeStrategy.js';
import { Manifest, AITarget } from '../../../types/index.js';
import { BTWError, ErrorCode } from '../../../types/errors.js';
import { InjectOptions, EjectOptions } from '../strategies/InjectionStrategy.js';

// Mock the file system
vi.mock('../../../infrastructure/fs/FileSystem.js', () => ({
  fileSystem: {
    exists: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    remove: vi.fn(),
    backup: vi.fn(),
    restore: vi.fn(),
    readdir: vi.fn(),
  },
}));

// Mock the path resolver
vi.mock('../../../infrastructure/fs/PathResolver.js', () => ({
  pathResolver: {
    resolveAiToolPaths: vi.fn((projectRoot: string) => ({
      configPath: `${projectRoot}/.claude/settings.json`,
      instructionsPath: `${projectRoot}/CLAUDE.md`,
      projectConfigPath: `${projectRoot}/.claude/project.json`,
      agentsPath: `${projectRoot}/.claude/agents`,
    })),
    normalize: vi.fn((path: string) => path),
  },
}));

// Import mocked modules for manipulation
import { fileSystem } from '../../../infrastructure/fs/FileSystem.js';

const BTW_START_MARKER = '<!-- BTW_START -->';
const BTW_END_MARKER = '<!-- BTW_END -->';

// Helper to create FileInfo objects for mocking readdir
function createFileInfo(name: string, basePath: string): { name: string; path: string; isDirectory: boolean; isFile: boolean; size: number } {
  return {
    name,
    path: `${basePath}/${name}`,
    isDirectory: false,
    isFile: true,
    size: 100,
  };
}

function createTestManifest(overrides?: Partial<Manifest>): Manifest {
  return {
    version: '1.0',
    id: 'test-workflow',
    name: 'Test Workflow',
    description: 'A test workflow for unit tests',
    targets: ['claude'] as AITarget[],
    agents: [
      {
        id: 'test-agent',
        name: 'Test Agent',
        description: 'A test agent for testing',
        systemPrompt: 'You are a test agent. Follow these instructions carefully.',
        tags: ['test', 'demo'],
      },
    ],
    author: 'Test Author',
    repository: 'https://github.com/test/workflow',
    ...overrides,
  };
}

describe('ClaudeStrategy', () => {
  let strategy: ClaudeStrategy;
  const projectRoot = '/test/project';
  const claudeMdPath = `${projectRoot}/CLAUDE.md`;
  const agentsPath = `${projectRoot}/.claude/agents`;
  const claudeDir = `${projectRoot}/.claude`;

  beforeEach(() => {
    vi.clearAllMocks();
    strategy = new ClaudeStrategy();

    // Default mock implementations
    vi.mocked(fileSystem.exists).mockResolvedValue(false);
    vi.mocked(fileSystem.readFile).mockResolvedValue('');
    vi.mocked(fileSystem.writeFile).mockResolvedValue(undefined);
    vi.mocked(fileSystem.mkdir).mockResolvedValue(undefined);
    vi.mocked(fileSystem.remove).mockResolvedValue(undefined);
    vi.mocked(fileSystem.backup).mockResolvedValue('/test/backup.btw-backup');
    vi.mocked(fileSystem.restore).mockResolvedValue(undefined);
    vi.mocked(fileSystem.readdir).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('target property', () => {
    it('should have target set to "claude"', () => {
      expect(strategy.target).toBe('claude');
    });
  });

  describe('canHandle()', () => {
    it('should return true for claude target', () => {
      expect(strategy.canHandle('claude')).toBe(true);
    });

    it('should return false for other targets', () => {
      expect(strategy.canHandle('cursor')).toBe(false);
      expect(strategy.canHandle('windsurf')).toBe(false);
      expect(strategy.canHandle('copilot')).toBe(false);
    });
  });

  describe('inject()', () => {
    const options: InjectOptions = { projectRoot };

    describe('successful injection', () => {
      it('should create .claude and agents directories', async () => {
        const manifest = createTestManifest();

        await strategy.inject(manifest, options);

        expect(fileSystem.mkdir).toHaveBeenCalledWith(claudeDir);
        expect(fileSystem.mkdir).toHaveBeenCalledWith(agentsPath);
      });

      it('should create agent files in .claude/agents/', async () => {
        const manifest = createTestManifest();

        await strategy.inject(manifest, options);

        // Should write agent file
        expect(fileSystem.writeFile).toHaveBeenCalledWith(
          `${agentsPath}/test-agent.md`,
          expect.any(String),
          { createDirs: true }
        );
      });

      it('should create CLAUDE.md with workflow summary', async () => {
        const manifest = createTestManifest();

        await strategy.inject(manifest, options);

        // Should write CLAUDE.md
        expect(fileSystem.writeFile).toHaveBeenCalledWith(
          claudeMdPath,
          expect.stringContaining(BTW_START_MARKER)
        );
      });

      it('should return correct injection result', async () => {
        const manifest = createTestManifest();

        const result = await strategy.inject(manifest, options);

        expect(result.target).toBe('claude');
        expect(result.configPath).toBe(claudeMdPath);
        expect(result.agentCount).toBe(1);
        expect(result.agentPaths).toContain(`${agentsPath}/test-agent.md`);
      });

      it('should handle manifest with multiple agents', async () => {
        const manifest = createTestManifest({
          agents: [
            { id: 'agent1', name: 'Agent 1', description: 'First', systemPrompt: 'Prompt 1' },
            { id: 'agent2', name: 'Agent 2', description: 'Second', systemPrompt: 'Prompt 2' },
          ],
        });

        const result = await strategy.inject(manifest, options);

        expect(result.agentCount).toBe(2);
        expect(fileSystem.writeFile).toHaveBeenCalledWith(
          `${agentsPath}/agent1.md`,
          expect.any(String),
          { createDirs: true }
        );
        expect(fileSystem.writeFile).toHaveBeenCalledWith(
          `${agentsPath}/agent2.md`,
          expect.any(String),
          { createDirs: true }
        );
      });
    });

    describe('force option', () => {
      it('should remove existing BTW agents when force is true', async () => {
        vi.mocked(fileSystem.readdir).mockResolvedValue([createFileInfo('old-agent.md', agentsPath)]);
        vi.mocked(fileSystem.readFile).mockResolvedValue('# BTW metadata\n# workflow: test-workflow');

        const manifest = createTestManifest();

        await strategy.inject(manifest, { projectRoot, force: true });

        // With the new multi-workflow support, force removes agents for THIS workflow only
        // Since old-agent.md belongs to test-workflow (same as manifest), it should be removed
        expect(fileSystem.remove).toHaveBeenCalledWith(`${agentsPath}/old-agent.md`);
      });

      it('should reject injection without force when same workflow already exists', async () => {
        vi.mocked(fileSystem.readdir).mockResolvedValue([createFileInfo('test-agent.md', agentsPath)]);
        vi.mocked(fileSystem.readFile).mockResolvedValue('# BTW metadata\n# workflow: test-workflow');

        const manifest = createTestManifest();

        // With multi-workflow support, it rejects when the SAME workflow is already injected
        await expect(strategy.inject(manifest, options)).rejects.toThrow(BTWError);
      });

      it('should allow injection when different workflow exists (multi-workflow support)', async () => {
        vi.mocked(fileSystem.readdir).mockResolvedValue([createFileInfo('other-agent.md', agentsPath)]);
        vi.mocked(fileSystem.readFile).mockResolvedValue('# BTW metadata\n# workflow: different-workflow');

        const manifest = createTestManifest();

        // Multi-workflow support allows different workflows to coexist
        const result = await strategy.inject(manifest, options);

        expect(result.target).toBe('claude');
      });
    });

    describe('backup functionality', () => {
      it('should create backup of existing agents when backup option is true', async () => {
        vi.mocked(fileSystem.readdir).mockResolvedValue([createFileInfo('test-agent.md', agentsPath)]);
        vi.mocked(fileSystem.readFile).mockResolvedValue('# BTW metadata\n# workflow: test-workflow');

        const manifest = createTestManifest();

        // Backup only happens for agents of the SAME workflow being re-injected
        // Since workflow is already injected, we need force to re-inject
        await strategy.inject(manifest, { projectRoot, backup: true, force: true });

        expect(fileSystem.backup).toHaveBeenCalledWith(`${agentsPath}/test-agent.md`);
      });

      it('should not create backup when backup option is false', async () => {
        const manifest = createTestManifest();

        await strategy.inject(manifest, { projectRoot, backup: false });

        expect(fileSystem.backup).not.toHaveBeenCalled();
      });
    });

    describe('merge mode', () => {
      it('should merge with existing CLAUDE.md content when merge option is true', async () => {
        vi.mocked(fileSystem.exists).mockResolvedValue(true);
        vi.mocked(fileSystem.readFile).mockImplementation(async (path) => {
          if (path === claudeMdPath) {
            return '# My Custom Instructions\n\nSome custom content.';
          }
          return '';
        });

        const manifest = createTestManifest();

        await strategy.inject(manifest, { projectRoot, merge: true });

        const writeCall = vi.mocked(fileSystem.writeFile).mock.calls.find(
          call => call[0] === claudeMdPath
        );
        expect(writeCall?.[1]).toContain('# My Custom Instructions');
        expect(writeCall?.[1]).toContain(BTW_START_MARKER);
      });
    });
  });

  describe('eject()', () => {
    const options: EjectOptions = { projectRoot };

    it('should remove BTW agent files', async () => {
      vi.mocked(fileSystem.readdir).mockResolvedValue([createFileInfo('test-agent.md', agentsPath)]);
      vi.mocked(fileSystem.readFile).mockResolvedValue('# BTW metadata\n# workflow: test-workflow');
      vi.mocked(fileSystem.exists).mockResolvedValue(true);

      await strategy.eject(options);

      expect(fileSystem.remove).toHaveBeenCalledWith(`${agentsPath}/test-agent.md`);
    });

    it('should clean BTW content from CLAUDE.md', async () => {
      const existingContent = `# My Project

Some description.

---

${BTW_START_MARKER}
<!-- BTW:test-workflow:2024-01-01T00:00:00.000Z -->

# Test Workflow

${BTW_END_MARKER}`;

      vi.mocked(fileSystem.readdir).mockResolvedValue([]);
      vi.mocked(fileSystem.exists).mockResolvedValue(true);
      vi.mocked(fileSystem.readFile).mockResolvedValue(existingContent);

      await strategy.eject(options);

      const writeCall = vi.mocked(fileSystem.writeFile).mock.calls.find(
        call => call[0] === claudeMdPath
      );
      expect(writeCall?.[1]).toContain('# My Project');
      expect(writeCall?.[1]).not.toContain(BTW_START_MARKER);
    });

    it('should remove CLAUDE.md if it becomes empty after ejection', async () => {
      vi.mocked(fileSystem.readdir).mockResolvedValue([]);
      vi.mocked(fileSystem.exists).mockResolvedValue(true);
      vi.mocked(fileSystem.readFile).mockResolvedValue(`${BTW_START_MARKER}\ncontent\n${BTW_END_MARKER}`);

      await strategy.eject(options);

      expect(fileSystem.remove).toHaveBeenCalledWith(claudeMdPath);
    });

    it('should remove empty agents directory', async () => {
      vi.mocked(fileSystem.readdir).mockResolvedValueOnce([createFileInfo('test-agent.md', agentsPath)]).mockResolvedValueOnce([]);
      vi.mocked(fileSystem.readFile).mockResolvedValue('# BTW metadata\n# workflow: test-workflow');
      vi.mocked(fileSystem.exists).mockResolvedValue(true);

      await strategy.eject(options);

      expect(fileSystem.remove).toHaveBeenCalledWith(agentsPath, true);
    });
  });

  describe('getStatus()', () => {
    it('should return not injected when no BTW agents exist', async () => {
      vi.mocked(fileSystem.readdir).mockResolvedValue([]);

      const status = await strategy.getStatus(projectRoot);

      expect(status.isInjected).toBe(false);
    });

    it('should return injected status when BTW agents exist', async () => {
      vi.mocked(fileSystem.readdir).mockResolvedValue([createFileInfo('test-agent.md', agentsPath)]);
      vi.mocked(fileSystem.readFile).mockResolvedValue('# BTW metadata\n# workflow: test-workflow');
      vi.mocked(fileSystem.exists).mockResolvedValue(false);

      const status = await strategy.getStatus(projectRoot);

      expect(status.isInjected).toBe(true);
      expect(status.workflowId).toBe('test-workflow');
    });

    it('should detect backup files', async () => {
      vi.mocked(fileSystem.readdir).mockResolvedValue([createFileInfo('test-agent.md', agentsPath)]);
      vi.mocked(fileSystem.readFile).mockResolvedValue('# BTW metadata\n# workflow: test-workflow');
      vi.mocked(fileSystem.exists).mockImplementation(async (path) => {
        return path === `${agentsPath}/test-agent.md.btw-backup`;
      });

      const status = await strategy.getStatus(projectRoot);

      expect(status.hasBackup).toBe(true);
    });
  });

  describe('validate()', () => {
    it('should return true when no files exist', async () => {
      vi.mocked(fileSystem.exists).mockResolvedValue(false);

      const result = await strategy.validate(projectRoot);

      expect(result).toBe(true);
    });

    it('should return true when files are valid', async () => {
      vi.mocked(fileSystem.exists).mockResolvedValue(true);
      vi.mocked(fileSystem.readdir).mockResolvedValue([createFileInfo('test-agent.md', agentsPath)]);
      vi.mocked(fileSystem.readFile).mockImplementation(async (path) => {
        if (path.endsWith('.json')) {
          return '{"valid": true}';
        }
        return '# Valid content';
      });

      const result = await strategy.validate(projectRoot);

      expect(result).toBe(true);
    });

    it('should return false when settings.json is invalid', async () => {
      vi.mocked(fileSystem.exists).mockResolvedValue(true);
      vi.mocked(fileSystem.readdir).mockResolvedValue([]);
      vi.mocked(fileSystem.readFile).mockResolvedValue('invalid json');

      const result = await strategy.validate(projectRoot);

      expect(result).toBe(false);
    });
  });

  describe('generateAgentFile()', () => {
    it('should generate agent file with YAML frontmatter', () => {
      const agent = {
        id: 'my-agent',
        name: 'My Agent',
        description: 'Test description',
        systemPrompt: 'You are a helpful assistant.',
      };

      const content = strategy.generateAgentFile(agent, 'test-workflow');

      expect(content).toContain('---');
      expect(content).toContain('name: my-agent');
      expect(content).toContain('description: Test description');
      expect(content).toContain('# BTW metadata');
      expect(content).toContain('# workflow: test-workflow');
      expect(content).toContain('You are a helpful assistant.');
    });

    it('should include model if specified', () => {
      const agent = {
        id: 'my-agent',
        name: 'My Agent',
        description: 'Test',
        systemPrompt: 'Prompt',
        model: 'claude-3-opus',
      };

      const content = strategy.generateAgentFile(agent, 'test-workflow');

      expect(content).toContain('model: opus');
    });

    it('should escape special characters in description', () => {
      const agent = {
        id: 'my-agent',
        name: 'My Agent',
        description: 'Description with: colon and # hash',
        systemPrompt: 'Prompt',
      };

      const content = strategy.generateAgentFile(agent, 'test-workflow');

      expect(content).toContain('description: "Description with: colon and # hash"');
    });
  });

  describe('generateInstructions()', () => {
    it('should generate CLAUDE.md with BTW markers', () => {
      const manifest = createTestManifest();

      const content = strategy.generateInstructions(manifest);

      expect(content).toContain(BTW_START_MARKER);
      expect(content).toContain(BTW_END_MARKER);
    });

    it('should include workflow metadata', () => {
      const manifest = createTestManifest();

      const content = strategy.generateInstructions(manifest);

      expect(content).toContain('**Workflow ID:** test-workflow');
      expect(content).toContain('**Version:** 1.0');
      expect(content).toContain('**Author:** Test Author');
    });

    it('should list available agents', () => {
      const manifest = createTestManifest({
        agents: [
          { id: 'agent1', name: 'Agent One', description: 'First agent', systemPrompt: 'P1' },
          { id: 'agent2', name: 'Agent Two', description: 'Second agent', systemPrompt: 'P2' },
        ],
      });

      const content = strategy.generateInstructions(manifest);

      expect(content).toContain('## Available Agents');
      expect(content).toContain('**Agent One** (`agent1`): First agent');
      expect(content).toContain('**Agent Two** (`agent2`): Second agent');
    });
  });

  describe('generateConfig()', () => {
    it('should generate valid JSON', () => {
      const manifest = createTestManifest();

      const config = strategy.generateConfig(manifest);
      const parsed = JSON.parse(config);

      expect(parsed._btw).toBeDefined();
      expect(parsed._btw.workflowId).toBe('test-workflow');
    });
  });

  describe('edge cases', () => {
    it('should handle manifest without optional fields', async () => {
      const manifest: Manifest = {
        version: '1.0',
        id: 'minimal',
        name: 'Minimal',
        description: 'Minimal workflow',
        targets: ['claude'],
        agents: [
          { id: 'agent', name: 'Agent', description: 'Desc', systemPrompt: 'Prompt' },
        ],
      };

      const result = await strategy.inject(manifest, { projectRoot });

      expect(result.target).toBe('claude');
    });

    it('should handle special characters in agent content', async () => {
      const manifest = createTestManifest({
        agents: [
          {
            id: 'agent',
            name: 'Agent',
            description: 'Description with *markdown*',
            systemPrompt: 'Prompt with {{templates}} and $variables',
          },
        ],
      });

      const result = await strategy.inject(manifest, { projectRoot });

      expect(result.target).toBe('claude');

      const writeCall = vi.mocked(fileSystem.writeFile).mock.calls.find(
        call => call[0] === `${agentsPath}/agent.md`
      );
      expect(writeCall?.[1]).toContain('*markdown*');
      expect(writeCall?.[1]).toContain('{{templates}}');
    });
  });
});
