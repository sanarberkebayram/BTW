export interface RepoSummary {
  id: string;
  name: string;
  description?: string;
  categories: string[];
}

export interface SkillSummary {
  id: string;
  repo_id: string;
  name: string;
  description?: string;
  categories: string[];
  tags: string[];
  language?: string;
  tool?: string;
}

export interface AgentSummary {
  id: string;
  repo_id: string;
  name: string;
  description?: string;
  categories: string[];
  tags: string[];
  language?: string;
  tool?: string;
}

export interface TemplateSummary {
  id: string;
  repo_id: string;
  name: string;
  description?: string;
  categories: string[];
  tags: string[];
  language?: string;
  tool?: string;
}

export interface SkillItem {
  id: string;
  repo_id: string;
  metadata: Record<string, unknown>;
  body: {
    skill_md: string;
  };
  assetsPath?: string;
}

export interface AgentItem {
  id: string;
  repo_id: string;
  metadata: Record<string, unknown>;
  body: {
    prompt_md: string;
  };
}

export interface TemplateItem {
  id: string;
  repo_id: string;
  metadata: Record<string, unknown>;
  body: {
    template_md: string;
  };
  extends?: {
    template_id: string;
    repo_id?: string;
  };
}

export interface ListFilters {
  q?: string;
  repo?: string;
  category?: string;
  tag?: string;
  language?: string;
  tool?: string;
  limit?: number;
  cursor?: string;
}

export interface PaginatedResult<T> {
  items: T[];
  cursor: string | null;
  next_cursor: string | null;
  limit: number;
  total: number;
}

export interface IndexStore {
  reset(): void;
  addRepo(repo: RepoSummary): void;
  addSkill(summary: SkillSummary, item: SkillItem): void;
  addAgent(summary: AgentSummary, item: AgentItem): void;
  addTemplate(summary: TemplateSummary, item: TemplateItem): void;
  listRepos(filters: ListFilters): PaginatedResult<RepoSummary>;
  listSkills(filters: ListFilters): PaginatedResult<SkillSummary>;
  listAgents(filters: ListFilters): PaginatedResult<AgentSummary>;
  listTemplates(filters: ListFilters): PaginatedResult<TemplateSummary>;
  getTemplate(repoId: string, templateId: string): TemplateItem | null;
  getSkill(repoId: string, skillId: string): SkillItem | null;
  getAgent(repoId: string, agentId: string): AgentItem | null;
  getRepo(repoId: string): RepoSummary | null;
  hasSkill(repoId: string, skillId: string): boolean;
  hasAgent(repoId: string, agentId: string): boolean;
  counts(): { skills: number; agents: number; templates: number; total: number };
}
