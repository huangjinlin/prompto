export const VARIABLE_PATH_PATTERN = "[A-Za-z_][A-Za-z0-9_]*(?:\\.[A-Za-z_][A-Za-z0-9_]*)*";

const variablePathRegex = new RegExp(`^${VARIABLE_PATH_PATTERN}$`);
const forbiddenSegments = new Set(["__proto__", "prototype", "constructor"]);
const builtinNames = new Set(["selectedText", "fileName"]);

export function isVariableNamePath(name: string): boolean {
  const segments = name.split(".");
  return variablePathRegex.test(name) &&
    !segments.some(segment => forbiddenSegments.has(segment)) &&
    (segments.length === 1 || !builtinNames.has(segments[0]));
}

export function flattenVariableDefinitions(definitions: unknown): Record<string, string> {
  if (!definitions || typeof definitions !== "object" || Array.isArray(definitions)) {
    throw new Error("Prompto vars must be a mapping of string leaves or nested groups.");
  }
  const variables: Record<string, string> = {};
  function visit(group: Record<string, unknown>, prefix: string): void {
    const entries = Object.entries(group);
    if (prefix && entries.length === 0) {
      throw new Error(`Variable group ${prefix} must contain string leaves.`);
    }
    for (const [name, value] of entries) {
      const fullName = prefix ? `${prefix}.${name}` : name;
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || !isVariableNamePath(fullName)) {
        throw new Error(`Invalid variable definition ${fullName}. Use nested mappings, not dotted keys or reserved path segments.`);
      }
      if (typeof value === "string") {
        variables[fullName] = value;
      } else if (value && typeof value === "object" && !Array.isArray(value)) {
        if (builtinNames.has(fullName)) {
          throw new Error(`Variables cannot override {{${fullName}}}.`);
        }
        visit(value as Record<string, unknown>, fullName);
      } else {
        throw new Error(`Variable ${fullName} must be a string or a nested mapping; quote numbers and booleans. Arrays are not supported.`);
      }
    }
  }
  visit(definitions as Record<string, unknown>, "");
  return variables;
}

export function mergeVariableNamespaces(
  shared: Record<string, string>,
  local: Record<string, string>
): Record<string, string> {
  const variables = { ...shared, ...local };
  for (const name of Object.keys(variables)) {
    const segments = name.split(".");
    for (let depth = 1; depth < segments.length; depth++) {
      const group = segments.slice(0, depth).join(".");
      if (Object.prototype.hasOwnProperty.call(variables, group)) {
        throw new Error(`Variable structure conflict at ${group}: it cannot be both a string and a group.`);
      }
    }
  }
  return variables;
}