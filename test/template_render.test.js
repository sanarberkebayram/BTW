import assert from "node:assert/strict";
import { renderTemplateText } from "../dist/template_render.js";

const result = renderTemplateText("Hello {{name}} {{missing}}", { name: "BTW" });

assert.equal(result.text, "Hello BTW ", "renders known variable");
assert.deepEqual(result.missing, ["missing"], "tracks missing variable");
