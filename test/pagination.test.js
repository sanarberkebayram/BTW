import assert from "node:assert/strict";
import { InMemoryIndex } from "../dist/in_memory_index.js";

const index = new InMemoryIndex();
index.addRepo({ id: "default", name: "Default", categories: [] });
index.addSkill(
  {
    id: "a",
    repo_id: "default",
    name: "A",
    description: "",
    categories: [],
    tags: [],
  },
  { id: "a", repo_id: "default", metadata: {}, body: { skill_md: "a" } }
);
index.addSkill(
  {
    id: "b",
    repo_id: "default",
    name: "B",
    description: "",
    categories: [],
    tags: [],
  },
  { id: "b", repo_id: "default", metadata: {}, body: { skill_md: "b" } }
);

const first = index.listSkills({ limit: 1 });
assert.equal(first.items.length, 1, "first page size");
assert.equal(first.items[0].id, "a", "first page item");

const second = index.listSkills({ limit: 1, cursor: first.next_cursor });
assert.equal(second.items.length, 1, "second page size");
assert.equal(second.items[0].id, "b", "second page item");
