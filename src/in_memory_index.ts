import {
  AgentItem,
  AgentSummary,
  IndexStore,
  ListFilters,
  PaginatedResult,
  RepoSummary,
  SkillItem,
  SkillSummary,
  TemplateItem,
  TemplateSummary,
} from "./indexer.js";
import {
  compareCursorKeys,
  decodeCursorKey,
  encodeCursorKey,
} from "./cursor.js";

function normalizeLimit(limit?: number): number {
  if (typeof limit !== "number" || limit <= 0) {
    return 50;
  }
  return Math.min(limit, 200);
}

export class InMemoryIndex implements IndexStore {
  private repos: RepoSummary[] = [];
  private skills: SkillSummary[] = [];
  private agents: AgentSummary[] = [];
  private templates: TemplateSummary[] = [];
  private skillBodies: Map<string, SkillItem> = new Map();
  private agentBodies: Map<string, AgentItem> = new Map();
  private templateBodies: Map<string, TemplateItem> = new Map();

  reset(): void {
    this.repos = [];
    this.skills = [];
    this.agents = [];
    this.templates = [];
    this.skillBodies.clear();
    this.agentBodies.clear();
    this.templateBodies.clear();
  }

  addRepo(repo: RepoSummary): void {
    this.repos.push(repo);
  }

  addSkill(summary: SkillSummary, item: SkillItem): void {
    this.skills.push(summary);
    this.skillBodies.set(`${summary.repo_id}:${summary.id}`, item);
  }

  addAgent(summary: AgentSummary, item: AgentItem): void {
    this.agents.push(summary);
    this.agentBodies.set(`${summary.repo_id}:${summary.id}`, item);
  }

  addTemplate(summary: TemplateSummary, item: TemplateItem): void {
    this.templates.push(summary);
    this.templateBodies.set(`${summary.repo_id}:${summary.id}`, item);
  }

  listRepos(filters: ListFilters): PaginatedResult<RepoSummary> {
    let items = this.repos;
    if (filters.category) {
      items = items.filter((repo) =>
        repo.categories.includes(filters.category ?? "")
      );
    }
    if (filters.q) {
      const q = filters.q.toLowerCase();
      items = items.filter((repo) => repo.name.toLowerCase().includes(q));
    }
    return paginateItems(items, filters, (item) => ({
      repo_id: item.id,
      id: item.id,
    }));
  }

  listSkills(filters: ListFilters): PaginatedResult<SkillSummary> {
    return paginateItems(this.applyFilters(this.skills, filters), filters, (item) => ({
      repo_id: item.repo_id,
      id: item.id,
    }));
  }

  listAgents(filters: ListFilters): PaginatedResult<AgentSummary> {
    return paginateItems(this.applyFilters(this.agents, filters), filters, (item) => ({
      repo_id: item.repo_id,
      id: item.id,
    }));
  }

  listTemplates(filters: ListFilters): PaginatedResult<TemplateSummary> {
    return paginateItems(this.applyFilters(this.templates, filters), filters, (item) => ({
      repo_id: item.repo_id,
      id: item.id,
    }));
  }

  getTemplate(repoId: string, templateId: string): TemplateItem | null {
    return this.templateBodies.get(`${repoId}:${templateId}`) ?? null;
  }

  getSkill(repoId: string, skillId: string): SkillItem | null {
    return this.skillBodies.get(`${repoId}:${skillId}`) ?? null;
  }

  getAgent(repoId: string, agentId: string): AgentItem | null {
    return this.agentBodies.get(`${repoId}:${agentId}`) ?? null;
  }

  hasSkill(repoId: string, skillId: string): boolean {
    return this.skillBodies.has(`${repoId}:${skillId}`);
  }

  hasAgent(repoId: string, agentId: string): boolean {
    return this.agentBodies.has(`${repoId}:${agentId}`);
  }

  getRepo(repoId: string): RepoSummary | null {
    return this.repos.find((repo) => repo.id === repoId) ?? null;
  }

  counts(): { skills: number; agents: number; templates: number; total: number } {
    const skills = this.skills.length;
    const agents = this.agents.length;
    const templates = this.templates.length;
    return { skills, agents, templates, total: skills + agents + templates };
  }

  private applyFilters<T extends { repo_id?: string; categories?: string[]; tags?: string[]; name?: string }>(
    items: T[],
    filters: ListFilters
  ): T[] {
    let filtered = items;
    if (filters.repo) {
      filtered = filtered.filter((item) => item.repo_id === filters.repo);
    }
    if (filters.category) {
      filtered = filtered.filter((item) =>
        item.categories?.includes(filters.category ?? "")
      );
    }
    if (filters.tag) {
      filtered = filtered.filter((item) =>
        item.tags?.includes(filters.tag ?? "")
      );
    }
    if (filters.language) {
      filtered = filtered.filter(
        (item) => (item as { language?: string }).language === filters.language
      );
    }
    if (filters.tool) {
      filtered = filtered.filter(
        (item) => (item as { tool?: string }).tool === filters.tool
      );
    }
    if (filters.q) {
      const q = filters.q.toLowerCase();
      filtered = filtered.filter((item) =>
        (item.name ?? "").toLowerCase().includes(q)
      );
    }
    return filtered;
  }
}

function paginateItems<T>(
  items: T[],
  filters: ListFilters,
  keyFn: (item: T) => { repo_id: string; id: string }
): PaginatedResult<T> {
  const limit = normalizeLimit(filters.limit);
  const cursorKey = decodeCursorKey(filters.cursor);
  const sorted = [...items].sort((a, b) =>
    compareCursorKeys(keyFn(a), keyFn(b))
  );
  let startIndex = 0;
  if (cursorKey) {
    startIndex = sorted.findIndex(
      (item) => compareCursorKeys(keyFn(item), cursorKey) > 0
    );
    if (startIndex < 0) {
      startIndex = sorted.length;
    }
  }
  const page = sorted.slice(startIndex, startIndex + limit);
  const last = page[page.length - 1];
  const nextCursor =
    page.length === limit && last
      ? encodeCursorKey(keyFn(last))
      : null;
  return {
    items: page,
    cursor: filters.cursor ?? null,
    next_cursor: nextCursor,
    limit,
    total: sorted.length,
  };
}
