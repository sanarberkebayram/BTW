import fs from "node:fs/promises";
import path from "node:path";
import { Config } from "./config.js";

export interface RepoEntry {
  id: string;
  url: string;
  branch: string;
  localPath: string;
  categories: string[];
}

export interface Registry {
  active_repo_id: string | null;
  repos: RepoEntry[];
}

async function ensureDir(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

export async function loadRegistry(config: Config): Promise<Registry> {
  try {
    const raw = await fs.readFile(config.configPath, "utf8");
    return JSON.parse(raw) as Registry;
  } catch (err) {
    const baseRegistry: Registry = {
      active_repo_id: null,
      repos: [],
    };
    if (config.defaultRepoUrl) {
      const defaultRepo: RepoEntry = {
        id: "default",
        url: config.defaultRepoUrl,
        branch: config.defaultBranch,
        localPath: path.join(config.reposRoot, "default"),
        categories: ["general"],
      };
      baseRegistry.active_repo_id = defaultRepo.id;
      baseRegistry.repos.push(defaultRepo);
    }
    await saveRegistry(config, baseRegistry);
    return baseRegistry;
  }
}

export async function saveRegistry(
  config: Config,
  registry: Registry
): Promise<void> {
  await ensureDir(config.configPath);
  await fs.writeFile(
    config.configPath,
    JSON.stringify(registry, null, 2),
    "utf8"
  );
}

export function getRepoById(
  registry: Registry,
  repoId: string
): RepoEntry | null {
  return registry.repos.find((repo) => repo.id === repoId) ?? null;
}
