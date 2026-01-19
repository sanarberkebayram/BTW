import path from "node:path";
import os from "node:os";

export interface Config {
  configPath: string;
  reposRoot: string;
  overlayPath: string;
  indexPath: string;
  defaultRepoUrl: string | null;
  defaultBranch: string;
  syncIntervalSec: number;
}

export function loadConfig(): Config {
  const home = os.homedir();
  const baseDir = path.join(home, ".btw");
  const configPath =
    process.env.BTW_CONFIG_PATH ?? path.join(baseDir, "config.json");

  return {
    configPath,
    reposRoot: path.join(baseDir, "repos"),
    overlayPath: path.join(baseDir, "overlay"),
    indexPath:
      process.env.BTW_INDEX_PATH ?? path.join(baseDir, "index", "index.db"),
    defaultRepoUrl: process.env.BTW_DEFAULT_REPO_URL ?? null,
    defaultBranch: process.env.BTW_BRANCH ?? "main",
    syncIntervalSec: Number(process.env.BTW_SYNC_INTERVAL_SEC ?? "300"),
  };
}
