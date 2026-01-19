import assert from "node:assert/strict";
import { encodeCursorKey, decodeCursorKey } from "../dist/cursor.js";

assert.equal(
  decodeCursorKey(null),
  null,
  "null cursor should decode to null"
);

const key = { repo_id: "default", id: "alpha" };
const encoded = encodeCursorKey(key);
const decoded = decodeCursorKey(encoded);

assert.deepEqual(decoded, key, "encoded cursor should round-trip");
