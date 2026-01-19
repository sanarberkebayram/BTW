import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
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
import { decodeCursorKey, encodeCursorKey } from "./cursor.js";

function normalizeLimit(limit?: number): number {
  if (typeof limit !== "number" || limit <= 0) {
    return 50;
  }
  return Math.min(limit, 200);
}

function parseJsonArray(value: string | null): string[] {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

function serializeArray(value: string[]): string {
  return JSON.stringify(value ?? []);
}

export class SqliteIndex implements IndexStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = this.openDb(dbPath);
    this.init();
  }

  private openDb(dbPath: string): Database.Database {
    const dir = path.dirname(dbPath);
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      // best-effort; sqlite will error if path is invalid
    }
    const db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    return db;
  }

  reset(): void {
    this.db.exec(`
      DROP TABLE IF EXISTS repos;
      DROP TABLE IF EXISTS skills;
      DROP TABLE IF EXISTS agents;
      DROP TABLE IF EXISTS templates;
    `);
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS repos (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        categories TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS skills (
        repo_id TEXT NOT NULL,
        id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        categories TEXT NOT NULL,
        tags TEXT NOT NULL,
        language TEXT,
        tool TEXT,
        metadata TEXT NOT NULL,
        skill_md TEXT NOT NULL,
        assets_path TEXT,
        PRIMARY KEY (repo_id, id)
      );

      CREATE TABLE IF NOT EXISTS agents (
        repo_id TEXT NOT NULL,
        id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        categories TEXT NOT NULL,
        tags TEXT NOT NULL,
        language TEXT,
        tool TEXT,
        metadata TEXT NOT NULL,
        prompt_md TEXT NOT NULL,
        PRIMARY KEY (repo_id, id)
      );

      CREATE TABLE IF NOT EXISTS templates (
        repo_id TEXT NOT NULL,
        id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        categories TEXT NOT NULL,
        tags TEXT NOT NULL,
        language TEXT,
        tool TEXT,
        metadata TEXT NOT NULL,
        template_md TEXT NOT NULL,
        extends_template_id TEXT,
        extends_repo_id TEXT,
        PRIMARY KEY (repo_id, id)
      );

      CREATE INDEX IF NOT EXISTS idx_skills_repo ON skills (repo_id);
      CREATE INDEX IF NOT EXISTS idx_agents_repo ON agents (repo_id);
      CREATE INDEX IF NOT EXISTS idx_templates_repo ON templates (repo_id);
    `);
  }

  addRepo(repo: RepoSummary): void {
    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO repos (id, name, description, categories)
       VALUES (@id, @name, @description, @categories)`
    );
    stmt.run({
      id: repo.id,
      name: repo.name,
      description: repo.description ?? null,
      categories: serializeArray(repo.categories),
    });
  }

  addSkill(summary: SkillSummary, item: SkillItem): void {
    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO skills
      (repo_id, id, name, description, categories, tags, language, tool, metadata, skill_md, assets_path)
      VALUES (@repo_id, @id, @name, @description, @categories, @tags, @language, @tool, @metadata, @skill_md, @assets_path)`
    );
    stmt.run({
      repo_id: summary.repo_id,
      id: summary.id,
      name: summary.name,
      description: summary.description ?? null,
      categories: serializeArray(summary.categories),
      tags: serializeArray(summary.tags),
      language: summary.language ?? null,
      tool: summary.tool ?? null,
      metadata: JSON.stringify(item.metadata ?? {}),
      skill_md: item.body.skill_md,
      assets_path: item.assetsPath ?? null,
    });
  }

  addAgent(summary: AgentSummary, item: AgentItem): void {
    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO agents
      (repo_id, id, name, description, categories, tags, language, tool, metadata, prompt_md)
      VALUES (@repo_id, @id, @name, @description, @categories, @tags, @language, @tool, @metadata, @prompt_md)`
    );
    stmt.run({
      repo_id: summary.repo_id,
      id: summary.id,
      name: summary.name,
      description: summary.description ?? null,
      categories: serializeArray(summary.categories),
      tags: serializeArray(summary.tags),
      language: summary.language ?? null,
      tool: summary.tool ?? null,
      metadata: JSON.stringify(item.metadata ?? {}),
      prompt_md: item.body.prompt_md,
    });
  }

  addTemplate(summary: TemplateSummary, item: TemplateItem): void {
    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO templates
      (repo_id, id, name, description, categories, tags, language, tool, metadata, template_md, extends_template_id, extends_repo_id)
      VALUES (@repo_id, @id, @name, @description, @categories, @tags, @language, @tool, @metadata, @template_md, @extends_template_id, @extends_repo_id)`
    );
    stmt.run({
      repo_id: summary.repo_id,
      id: summary.id,
      name: summary.name,
      description: summary.description ?? null,
      categories: serializeArray(summary.categories),
      tags: serializeArray(summary.tags),
      language: summary.language ?? null,
      tool: summary.tool ?? null,
      metadata: JSON.stringify(item.metadata ?? {}),
      template_md: item.body.template_md,
      extends_template_id: item.extends?.template_id ?? null,
      extends_repo_id: item.extends?.repo_id ?? null,
    });
  }

  listRepos(filters: ListFilters): PaginatedResult<RepoSummary> {
    const { where, params } = this.buildWhere("repos", filters, false);
    const limit = normalizeLimit(filters.limit);
    const cursorKey = decodeCursorKey(filters.cursor);
    if (cursorKey) {
      where.clauses.push(
        "(id > @cursor_id)"
      );
      params.cursor_id = cursorKey.id;
    }
    const whereSql = where.clauses.length ? `WHERE ${where.clauses.join(" AND ")}` : "";
    const rows = this.db
      .prepare(
        `SELECT id, name, description, categories
         FROM repos
         ${whereSql}
         ORDER BY id ASC
         LIMIT @limit_plus_one`
      )
      .all({ ...params, limit_plus_one: limit + 1 }) as Array<{
      id: string;
      name: string;
      description: string | null;
      categories: string;
    }>;
    const items = rows.slice(0, limit).map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      categories: parseJsonArray(row.categories),
    }));
    const nextCursor =
      rows.length > limit && items.length > 0
        ? encodeCursorKey({ repo_id: items[items.length - 1].id, id: items[items.length - 1].id })
        : null;
    const total = this.count("repos", filters);
    return {
      items,
      cursor: filters.cursor ?? null,
      next_cursor: nextCursor,
      limit,
      total,
    };
  }

  listSkills(filters: ListFilters): PaginatedResult<SkillSummary> {
    return this.listWithFilters<SkillSummary>(
      "skills",
      filters,
      (row) => ({
        id: row.id,
        repo_id: row.repo_id,
        name: row.name,
        description: row.description ?? undefined,
        categories: parseJsonArray(row.categories),
        tags: parseJsonArray(row.tags),
        language: row.language ?? undefined,
        tool: row.tool ?? undefined,
      })
    );
  }

  listAgents(filters: ListFilters): PaginatedResult<AgentSummary> {
    return this.listWithFilters<AgentSummary>(
      "agents",
      filters,
      (row) => ({
        id: row.id,
        repo_id: row.repo_id,
        name: row.name,
        description: row.description ?? undefined,
        categories: parseJsonArray(row.categories),
        tags: parseJsonArray(row.tags),
        language: row.language ?? undefined,
        tool: row.tool ?? undefined,
      })
    );
  }

  listTemplates(filters: ListFilters): PaginatedResult<TemplateSummary> {
    return this.listWithFilters<TemplateSummary>(
      "templates",
      filters,
      (row) => ({
        id: row.id,
        repo_id: row.repo_id,
        name: row.name,
        description: row.description ?? undefined,
        categories: parseJsonArray(row.categories),
        tags: parseJsonArray(row.tags),
        language: row.language ?? undefined,
        tool: row.tool ?? undefined,
      })
    );
  }

  getTemplate(repoId: string, templateId: string): TemplateItem | null {
    const row = this.db
      .prepare(
        `SELECT id, repo_id, metadata, template_md, extends_template_id, extends_repo_id
         FROM templates WHERE repo_id = ? AND id = ?`
      )
      .get(repoId, templateId) as
      | {
          id: string;
          repo_id: string;
          metadata: string;
          template_md: string;
          extends_template_id: string | null;
          extends_repo_id: string | null;
        }
      | undefined;
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      repo_id: row.repo_id,
      metadata: JSON.parse(row.metadata),
      body: { template_md: row.template_md },
      extends: row.extends_template_id
        ? {
            template_id: row.extends_template_id,
            repo_id: row.extends_repo_id ?? undefined,
          }
        : undefined,
    };
  }

  getSkill(repoId: string, skillId: string): SkillItem | null {
    const row = this.db
      .prepare(
        `SELECT id, repo_id, metadata, skill_md, assets_path
         FROM skills WHERE repo_id = ? AND id = ?`
      )
      .get(repoId, skillId) as
      | {
          id: string;
          repo_id: string;
          metadata: string;
          skill_md: string;
          assets_path: string | null;
        }
      | undefined;
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      repo_id: row.repo_id,
      metadata: JSON.parse(row.metadata),
      body: { skill_md: row.skill_md },
      assetsPath: row.assets_path ?? undefined,
    };
  }

  getAgent(repoId: string, agentId: string): AgentItem | null {
    const row = this.db
      .prepare(
        `SELECT id, repo_id, metadata, prompt_md
         FROM agents WHERE repo_id = ? AND id = ?`
      )
      .get(repoId, agentId) as
      | {
          id: string;
          repo_id: string;
          metadata: string;
          prompt_md: string;
        }
      | undefined;
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      repo_id: row.repo_id,
      metadata: JSON.parse(row.metadata),
      body: { prompt_md: row.prompt_md },
    };
  }

  getRepo(repoId: string): RepoSummary | null {
    const row = this.db
      .prepare(`SELECT id, name, description, categories FROM repos WHERE id = ?`)
      .get(repoId) as
      | {
          id: string;
          name: string;
          description: string | null;
          categories: string;
        }
      | undefined;
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      categories: parseJsonArray(row.categories),
    };
  }

  hasSkill(repoId: string, skillId: string): boolean {
    const row = this.db
      .prepare(`SELECT 1 FROM skills WHERE repo_id = ? AND id = ?`)
      .get(repoId, skillId);
    return Boolean(row);
  }

  hasAgent(repoId: string, agentId: string): boolean {
    const row = this.db
      .prepare(`SELECT 1 FROM agents WHERE repo_id = ? AND id = ?`)
      .get(repoId, agentId);
    return Boolean(row);
  }

  counts(): { skills: number; agents: number; templates: number; total: number } {
    const skills = this.count("skills", {});
    const agents = this.count("agents", {});
    const templates = this.count("templates", {});
    return { skills, agents, templates, total: skills + agents + templates };
  }

  private listWithFilters<T>(
    table: "skills" | "agents" | "templates",
    filters: ListFilters,
    mapper: (row: any) => T
  ): PaginatedResult<T> {
    const { where, params } = this.buildWhere(table, filters, true);
    const limit = normalizeLimit(filters.limit);
    const whereSql = where.clauses.length ? `WHERE ${where.clauses.join(" AND ")}` : "";
    const rows = this.db
      .prepare(
        `SELECT id, repo_id, name, description, categories, tags, language, tool
         FROM ${table}
         ${whereSql}
         ORDER BY repo_id ASC, id ASC
         LIMIT @limit_plus_one`
      )
      .all({ ...params, limit_plus_one: limit + 1 });
    const items = rows.slice(0, limit).map(mapper);
    const last = items[items.length - 1] as { repo_id: string; id: string } | undefined;
    const nextCursor =
      rows.length > limit && last
        ? encodeCursorKey({ repo_id: last.repo_id, id: last.id })
        : null;
    const total = this.count(table, filters);
    return {
      items,
      cursor: filters.cursor ?? null,
      next_cursor: nextCursor,
      limit,
      total,
    };
  }

  private buildWhere(
    table: "repos" | "skills" | "agents" | "templates",
    filters: ListFilters,
    includeCursor: boolean
  ): { where: { clauses: string[] }; params: Record<string, unknown> } {
    const clauses: string[] = [];
    const params: Record<string, unknown> = {};

    if (table !== "repos") {
      if (filters.repo) {
        clauses.push("repo_id = @repo");
        params.repo = filters.repo;
      }
      if (filters.language) {
        clauses.push("language = @language");
        params.language = filters.language;
      }
      if (filters.tool) {
        clauses.push("tool = @tool");
        params.tool = filters.tool;
      }
      if (filters.category) {
        clauses.push(
          "EXISTS (SELECT 1 FROM json_each(categories) WHERE value = @category)"
        );
        params.category = filters.category;
      }
      if (filters.tag) {
        clauses.push(
          "EXISTS (SELECT 1 FROM json_each(tags) WHERE value = @tag)"
        );
        params.tag = filters.tag;
      }
      if (filters.q) {
        clauses.push("(name LIKE @q OR description LIKE @q)");
        params.q = `%${filters.q}%`;
      }
    } else {
      if (filters.category) {
        clauses.push(
          "EXISTS (SELECT 1 FROM json_each(categories) WHERE value = @category)"
        );
        params.category = filters.category;
      }
      if (filters.q) {
        clauses.push("(name LIKE @q OR description LIKE @q)");
        params.q = `%${filters.q}%`;
      }
    }

    if (includeCursor) {
      const cursorKey = decodeCursorKey(filters.cursor);
      if (cursorKey) {
        if (table === "repos") {
          clauses.push("(id > @cursor_id)");
          params.cursor_id = cursorKey.id;
        } else {
          clauses.push(
            "(repo_id > @cursor_repo OR (repo_id = @cursor_repo AND id > @cursor_id))"
          );
          params.cursor_repo = cursorKey.repo_id;
          params.cursor_id = cursorKey.id;
        }
      }
    }

    return { where: { clauses }, params };
  }

  private count(
    table: "repos" | "skills" | "agents" | "templates",
    filters: ListFilters
  ): number {
    const { where, params } = this.buildWhere(table, filters, false);
    const whereSql = where.clauses.length ? `WHERE ${where.clauses.join(" AND ")}` : "";
    const row = this.db
      .prepare(`SELECT COUNT(*) as count FROM ${table} ${whereSql}`)
      .get(params) as { count: number } | undefined;
    return row?.count ?? 0;
  }
}
