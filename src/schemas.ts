import { Validator } from "jsonschema";
import type { ValidationError } from "jsonschema";

const validator = new Validator();

const repoSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "btw.schema.repo.json",
  type: "object",
  required: ["id", "name", "schema_version", "repo_version"],
  additionalProperties: false,
  properties: {
    id: { type: "string", pattern: "^[a-z0-9-]{2,64}$" },
    name: { type: "string", minLength: 2, maxLength: 128 },
    schema_version: { type: "string", minLength: 1 },
    repo_version: { type: "string", minLength: 1 },
    description: { type: "string", maxLength: 2048 },
    categories: { type: "array", items: { type: "string" } },
    owner: { type: "string", maxLength: 128 },
    contact: { type: "string", maxLength: 256 },
    homepage: { type: "string", maxLength: 512 },
    license: { type: "string", maxLength: 64 },
  },
};

const skillSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "btw.schema.skill.json",
  type: "object",
  required: ["id", "name", "schema_version"],
  additionalProperties: false,
  properties: {
    id: { type: "string", pattern: "^[a-z0-9-]{2,64}$" },
    name: { type: "string", minLength: 2, maxLength: 128 },
    schema_version: { type: "string", minLength: 1 },
    description: { type: "string", maxLength: 2048 },
    categories: { type: "array", items: { type: "string" } },
    tags: { type: "array", items: { type: "string" } },
    triggers: { type: "array", items: { type: "string" } },
    language: { type: "string", maxLength: 64 },
    tool: { type: "string", maxLength: 64 },
  },
};

const templateSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "btw.schema.template.json",
  type: "object",
  required: ["id", "name", "schema_version", "agents", "skills"],
  additionalProperties: false,
  properties: {
    id: { type: "string", pattern: "^[a-z0-9-]{2,64}$" },
    name: { type: "string", minLength: 2, maxLength: 128 },
    schema_version: { type: "string", minLength: 1 },
    description: { type: "string", maxLength: 2048 },
    categories: { type: "array", items: { type: "string" } },
    language: { type: "string", maxLength: 64 },
    tool: { type: "string", maxLength: 64 },
    agents: {
      type: "array",
      items: { type: "string", pattern: "^[a-z0-9-]{2,64}$" },
    },
    skills: {
      type: "array",
      items: { type: "string", pattern: "^[a-z0-9-]{2,64}$" },
    },
    inputs: {
      type: "array",
      items: {
        type: "object",
        required: ["name", "type", "required"],
        additionalProperties: false,
        properties: {
          name: { type: "string", pattern: "^[a-zA-Z0-9_-]{2,64}$" },
          type: {
            type: "string",
            enum: ["string", "number", "boolean", "enum"],
          },
          required: { type: "boolean" },
          default: {},
          description: { type: "string", maxLength: 512 },
          enum: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
};

const extendsSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "btw.schema.extends.json",
  type: "object",
  required: ["extends"],
  additionalProperties: false,
  properties: {
    extends: { type: "string", pattern: "^[a-z0-9-]{2,64}$" },
    repo: { type: "string", pattern: "^[a-z0-9-]{2,64}$" },
  },
};

const agentSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "btw.schema.agent.json",
  type: "object",
  required: ["id", "name"],
  additionalProperties: false,
  properties: {
    id: { type: "string", pattern: "^[a-z0-9-]{2,64}$" },
    name: { type: "string", minLength: 2, maxLength: 128 },
    description: { type: "string", maxLength: 2048 },
    skills: {
      type: "array",
      items: { type: "string", pattern: "^[a-z0-9-]{2,64}$" },
    },
    tools: { type: "array", items: { type: "string" } },
    guardrails: { type: "object" },
  },
};

function formatErrors(errors: ValidationError[]): string[] {
  return errors.map((err) => err.stack || err.toString());
}

function validateWith(schema: object, data: unknown): string[] {
  const result = validator.validate(data, schema);
  return result.errors.length > 0 ? formatErrors(result.errors) : [];
}

export function validateRepoJson(data: unknown): string[] {
  return validateWith(repoSchema, data);
}

export function validateSkillJson(data: unknown): string[] {
  return validateWith(skillSchema, data);
}

export function validateTemplateJson(data: unknown): string[] {
  return validateWith(templateSchema, data);
}

export function validateExtendsJson(data: unknown): string[] {
  return validateWith(extendsSchema, data);
}

export function validateAgentYaml(data: unknown): string[] {
  return validateWith(agentSchema, data);
}
