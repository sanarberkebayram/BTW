import fs from "node:fs/promises";
import { Config } from "./config.js";
import { IndexStore } from "./indexer.js";
import { Registry } from "./registry.js";
import { scanRepo } from "./repo_scan.js";

async function pathExists(dirPath: string): Promise<boolean> {
  try {
    await fs.stat(dirPath);
    return true;
  } catch {
    return false;
  }
}

export async function buildIndex(
  config: Config,
  registry: Registry,
  index: IndexStore
): Promise<{ errors: string[] }> {
  index.reset();
  const errors: string[] = [];

  const overlayPath = config.overlayPath;
  if (!(await pathExists(overlayPath))) {
    await fs.mkdir(overlayPath, { recursive: true });
  }
  const overlayScan = await scanRepo("overlay", overlayPath, true);
  index.addRepo(overlayScan.repo);
  for (const skill of overlayScan.skills) {
    index.addSkill(skill.summary, skill.item);
  }
  for (const agent of overlayScan.agents) {
    index.addAgent(agent.summary, agent.item);
  }
  for (const template of overlayScan.templates) {
    index.addTemplate(template.summary, template.item);
  }
  errors.push(...overlayScan.errors);

  for (const repo of registry.repos) {
    if (!(await pathExists(repo.localPath))) {
      errors.push(`repo path missing: ${repo.id} at ${repo.localPath}`);
      continue;
    }
    const scan = await scanRepo(repo.id, repo.localPath, false);
    index.addRepo(scan.repo);
    for (const skill of scan.skills) {
      index.addSkill(skill.summary, skill.item);
    }
    for (const agent of scan.agents) {
      index.addAgent(agent.summary, agent.item);
    }
    for (const template of scan.templates) {
      index.addTemplate(template.summary, template.item);
    }
    errors.push(...scan.errors);
  }

  return { errors };
}
