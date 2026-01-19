import assert from "node:assert/strict";
import { validateTemplateJson } from "../dist/schemas.js";

const errors = validateTemplateJson({ id: "t1" });
assert.ok(errors.length > 0, "missing required fields should error");
