import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { Config } from "./config.js";
import { Registry, getRepoById } from "./registry.js";

const execFileAsync = promisify(execFile);

async function runGit(args: string[], cwd?: string): Promise<void> {
  await execFileAsync("git", args, { cwd });
}

async function ensureRepo(
  repoId: string,
  repoUrl: string,
  branch: string,
  localPath: string
): Promise<void> {
  try {
    await fs.stat(localPath);
  } catch {
    await fs.mkdir(path.dirname(localPath), { recursive: true });
    await runGit(["clone", "--depth", "1", "--branch", branch, repoUrl, localPath]);
  }
}

async function updateRepo(branch: string, localPath: string): Promise<void> {
  await runGit(["checkout", branch], localPath);
  await runGit(["pull", "--ff-only", "origin", branch], localPath);
}

export interface SyncResult {
  updatedRepos: string[];
  errors: string[];
}

export async function syncRepos(
  config: Config,
  registry: Registry,
  repoId?: string
): Promise<SyncResult> {
  const targetRepos = repoId
    ? [getRepoById(registry, repoId)].filter(Boolean)
    : registry.repos;

  const updatedRepos: string[] = [];
  const errors: string[] = [];

  for (const repo of targetRepos) {
    if (!repo) {
      errors.push(`unknown repo: ${repoId}`);
      continue;
    }
    try {
      await ensureRepo(repo.id, repo.url, repo.branch, repo.localPath);
      await updateRepo(repo.branch, repo.localPath);
      updatedRepos.push(repo.id);
    } catch (err) {
      errors.push(`sync failed for ${repo.id}: ${String(err)}`);
    }
  }

  if (config.overlayPath) {
    await fs.mkdir(config.overlayPath, { recursive: true });
  }

  return { updatedRepos, errors };
}
