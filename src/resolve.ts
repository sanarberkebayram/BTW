import { IndexStore, TemplateItem } from "./indexer.js";
import { Registry } from "./registry.js";

export interface ResolvedTemplate {
  item: TemplateItem | null;
  errors: string[];
}

export function getResolutionOrder(
  index: IndexStore,
  registry: Registry
): string[] {
  const order: string[] = [];
  if (index.getRepo("overlay")) {
    order.push("overlay");
  }
  if (registry.active_repo_id) {
    order.push(registry.active_repo_id);
  }
  for (const repo of registry.repos) {
    if (!order.includes(repo.id)) {
      order.push(repo.id);
    }
  }
  return order;
}

export function resolveTemplate(
  index: IndexStore,
  registry: Registry,
  templateId: string,
  repoId?: string
): TemplateItem | null {
  if (repoId) {
    return index.getTemplate(repoId, templateId);
  }
  for (const repo of getResolutionOrder(index, registry)) {
    const item = index.getTemplate(repo, templateId);
    if (item) {
      return item;
    }
  }
  return null;
}

export function resolveTemplateComposed(
  index: IndexStore,
  registry: Registry,
  templateId: string,
  repoId?: string
): ResolvedTemplate {
  const errors: string[] = [];
  const base = resolveTemplate(index, registry, templateId, repoId);
  if (!base) {
    const ref = repoId ? `${repoId}/${templateId}` : templateId;
    return { item: null, errors: [`missing template ${ref}`] };
  }

  const visited = new Set<string>();

  function resolveChain(item: TemplateItem): TemplateItem | null {
    const key = `${item.repo_id}:${item.id}`;
    if (visited.has(key)) {
      errors.push(`template composition cycle at ${key}`);
      return null;
    }
    visited.add(key);

    if (!item.extends) {
      return item;
    }

    const parentRepoId = item.extends.repo_id ?? item.repo_id;
    const parent = index.getTemplate(parentRepoId, item.extends.template_id);
    if (!parent) {
      errors.push(
        `missing parent template ${parentRepoId}/${item.extends.template_id}`
      );
      return null;
    }

    const resolvedParent = resolveChain(parent);
    if (!resolvedParent) {
      return null;
    }

    return mergeTemplates(resolvedParent, item);
  }

  const resolved = resolveChain(base);
  if (!resolved) {
    return { item: base, errors };
  }
  return { item: resolved, errors };
}

function mergeTemplates(parent: TemplateItem, child: TemplateItem): TemplateItem {
  const mergedMetadata = {
    ...parent.metadata,
    ...child.metadata,
    id: child.id,
  };
  return {
    id: child.id,
    repo_id: child.repo_id,
    metadata: mergedMetadata,
    body: {
      template_md: child.body.template_md || parent.body.template_md,
    },
  };
}
