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

/**
 * Cache compiled validators keyed by a stable hash of the schema.
 *
 * Keying by capability *name* is unsafe because a provider may re-discover the
 * same capability with a different schema. Keying by the serialized schema also
 * keeps validation correct for tests that reuse capability names.
 */
const validatorCache = new Map<string, ValidateFunction | null>();

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

/**
 * Decide whether a schema is trivially permissive and can be skipped.
 *
 * A schema is treated as "anything goes" when it is missing, is not an object,
 * is an empty object, or is `{ type: "object" }` with no properties/constraints.
 */
function isPermissiveSchema(schema: unknown): boolean {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return true;
  }

  const keys = Object.keys(schema as Record<string, unknown>);
  if (keys.length === 0) return true;

  const record = schema as Record<string, unknown>;
  const onlyType = keys.length === 1 && keys[0] === "type";
  if (onlyType && record.type === "object") return true;

  const noConstraints =
    keys.every((key) =>
      ["$schema", "$id", "title", "description", "type", "default"].includes(
        key
      )
    ) && record.type === "object";

  return noConstraints;
}

function getValidator(
  capability: CapabilityDefinition
): ValidateFunction | undefined {
  const schema = capability.inputSchema;

  if (isPermissiveSchema(schema)) {
    return undefined;
  }

  const cacheKey = JSON.stringify(schema);
  const cached = validatorCache.get(cacheKey);
  if (cached !== undefined) {
    return cached ?? undefined;
  }

  try {
    const validator = ajv.compile(schema);
    validatorCache.set(cacheKey, validator);
    return validator;
  } catch (error) {
    // A provider may return a schema Ajv cannot compile. Treat the capability
    // as unvalidated rather than blocking execution entirely.
    console.warn(
      `Could not compile schema for capability "${capability.name}":`,
      error instanceof Error ? error.message : error
    );
    validatorCache.set(cacheKey, null);
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
