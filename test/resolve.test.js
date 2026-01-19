import assert from "node:assert/strict";
import { InMemoryIndex } from "../dist/in_memory_index.js";
import { resolveTemplateComposed } from "../dist/resolve.js";

const index = new InMemoryIndex();
index.addRepo({ id: "default", name: "Default", categories: [] });

index.addTemplate(
  {
    id: "base",
    repo_id: "default",
    name: "Base",
    categories: [],
    tags: [],
  },
  {
    id: "base",
    repo_id: "default",
    metadata: { id: "base", name: "Base", skills: ["s1"] },
    body: { template_md: "Base body" },
  }
);

index.addTemplate(
  {
    id: "child",
    repo_id: "default",
    name: "Child",
    categories: [],
    tags: [],
  },
  {
    id: "child",
    repo_id: "default",
    metadata: { id: "child", name: "Child", skills: ["s2"] },
    body: { template_md: "Child body" },
    extends: { template_id: "base" },
  }
);

const registry = { active_repo_id: "default", repos: [] };
const resolved = resolveTemplateComposed(index, registry, "child", "default");

assert.equal(resolved.errors.length, 0, "no composition errors");
assert.equal(resolved.item?.body.template_md, "Child body", "child body wins");
assert.deepEqual(
  resolved.item?.metadata.skills,
  ["s2"],
  "child metadata overrides parent"
);
