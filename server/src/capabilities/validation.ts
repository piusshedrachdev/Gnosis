import Ajv, { ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { CapabilityDefinition } from "../providers/provider";

/**
 * JSON Schema validation for capability arguments.
 *
 * The MVP prefers a real validator over hand-rolled checks so that the schema
 * supplied by the provider is enforced as-is.
 */

const ajv = new Ajv({
  allErrors: true,
  strict: false,
  coerceTypes: false,
  useDefaults: true,
  allowUnionTypes: true,
});

addFormats(ajv);

/** Cache compiled validators per capability name. */
const validatorCache = new Map<string, ValidateFunction>();

/** Error thrown when capability arguments fail schema validation. */
export class CapabilityValidationError extends Error {
  readonly code = "INVALID_ARGUMENTS";
  readonly details: string[];

  constructor(message: string, details: string[]) {
    super(message);
    this.name = "CapabilityValidationError";
    this.details = details;
  }
}

function getValidator(
  capability: CapabilityDefinition
): ValidateFunction | undefined {
  const cached = validatorCache.get(capability.name);
  if (cached) return cached;

  const schema = capability.inputSchema;

  // A schema with no explicit type/properties accepts anything.
  if (!schema || Object.keys(schema).length === 0) {
    return undefined;
  }

  try {
    const validator = ajv.compile(schema);
    validatorCache.set(capability.name, validator);
    return validator;
  } catch (error) {
    // A provider may return a schema Ajv cannot compile. Treat the capability
    // as unvalidated rather than blocking execution entirely.
    console.warn(
      `Could not compile schema for capability "${capability.name}":`,
      error instanceof Error ? error.message : error
    );
    return undefined;
  }
}

/**
 * Validate arguments against a capability's schema.
 *
 * @throws CapabilityValidationError when the arguments are invalid.
 */
export function validateArguments(
  capability: CapabilityDefinition,
  args: Record<string, unknown>
): void {
  const validator = getValidator(capability);
  if (!validator) return;

  const valid = validator(args);
  if (valid) return;

  const details = (validator.errors ?? []).map(
    (err) => `${err.instancePath || "/"} ${err.message ?? "is invalid"}`.trim()
  );

  throw new CapabilityValidationError(
    `Invalid arguments for capability "${capability.name}".`,
    details
  );
}
