declare module "jsonschema" {
  export interface ValidationError {
    stack?: string;
    toString(): string;
  }

  export interface ValidatorResult {
    errors: ValidationError[];
  }

  export class Validator {
    validate(instance: unknown, schema: object): ValidatorResult;
  }
}
