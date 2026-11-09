import { parseYamlSubset } from "./MarkdownYamlParserService";
import { flattenVariableDefinitions } from "./VariableNamespaceService";

function isMapping(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parseSelectionContextVariables(content: string): Record<string, string> {
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/);
  const start = lines.findIndex(line => line.trim());
  if (start < 0 || !/^\s*<!--\s*md-meta\s*$/.test(lines[start])) {
    throw new Error("Context files must start with a document-scoped md-meta block.");
  }
  const end = lines.findIndex((line, index) => index > start && /^\s*-->\s*$/.test(line));
  if (end < 0) {
    throw new Error("Unclosed context md-meta block.");
  }
  const root = parseYamlSubset(lines.slice(start + 1, end).join("\n"), true);
  if (!isMapping(root) || root.scope !== "document" ||
      (root.version !== undefined && root.version !== 1) || !isMapping(root.prompto)) {
    throw new Error("Context metadata requires scope: document and a prompto mapping (version 1).");
  }
  if (Object.prototype.hasOwnProperty.call(root.prompto, "context")) {
    throw new Error("Shared contexts cannot reference other contexts.");
  }
  if (!isMapping(root.prompto.vars)) {
    throw new Error("Context metadata requires a prompto.vars mapping.");
  }
  const variables = flattenVariableDefinitions(root.prompto.vars);
  for (const name of Object.keys(variables)) {
    if (name === "selectedText" || name === "fileName") {
      throw new Error(`Context variables cannot override {{${name}}}.`);
    }
  }
  return variables;
}