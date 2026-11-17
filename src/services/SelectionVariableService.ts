import { parse } from "handlebars";
import { randomUUID } from "crypto";
import { parseMarkdownMetaDocument } from "./MarkdownMetaParserService";
import { parseSelectionContextVariables } from "./SelectionContextService";
import { isVariableNamePath, mergeVariableNamespaces, VARIABLE_PATH_PATTERN } from "./VariableNamespaceService";

function isVariablePath(expression: hbs.AST.Expression): expression is hbs.AST.PathExpression {
  return expression.type === "PathExpression" &&
    isVariableNamePath((expression as hbs.AST.PathExpression).original);
}

type StringCall = hbs.AST.MustacheStatement | hbs.AST.SubExpression;

function isStringCall(call: StringCall, depth = 0): boolean {
  if (depth >= 8 || !isVariablePath(call.path) || call.hash?.pairs.length) {
    return false;
  }
  const name = call.path.original;
  if (name === "slice") {
    if (call.params.length !== 2 && call.params.length !== 3) {
      return false;
    }
    if (!call.params.slice(1).every(parameter => parameter.type === "NumberLiteral" &&
        Number.isSafeInteger((parameter as hbs.AST.NumberLiteral).value))) {
      return false;
    }
  } else if (!["trim", "upper", "lower"].includes(name) || call.params.length !== 1) {
    return false;
  }
  const source = call.params[0];
  return isVariablePath(source) ||
    (source.type === "SubExpression" && isStringCall(source as hbs.AST.SubExpression, depth + 1));
}

function isConditionExpression(expression: hbs.AST.Expression, depth = 0): boolean {
  if (depth >= 8 || expression.type !== "SubExpression") {
    return false;
  }
  const condition = expression as hbs.AST.SubExpression;
  if (!isVariablePath(condition.path) || condition.hash?.pairs.length) {
    return false;
  }
  const operator = condition.path.original;
  if (operator === "eq" || operator === "ne") {
    return condition.params.length === 2 && isVariablePath(condition.params[0]) &&
      condition.params[1].type === "StringLiteral";
  }
  return (operator === "and" || operator === "or") && condition.params.length >= 2 &&
    condition.params.every(parameter => isConditionExpression(parameter, depth + 1));
}

function isIncludeCall(call: hbs.AST.MustacheStatement): boolean {
  return call.escaped && call.path.type === "PathExpression" &&
    (call.path as hbs.AST.PathExpression).original === "include" &&
    call.params.length === 1 && call.params[0].type === "StringLiteral" &&
    call.hash?.pairs.length === 1 && call.hash.pairs[0].key === "section" &&
    call.hash.pairs[0].value.type === "StringLiteral";
}

function validateProgram(program: hbs.AST.Program, allowIncludes = true): void {
  for (const statement of program.body) {
    if (statement.type === "ContentStatement") {
      continue;
    }
    if (statement.type === "MustacheStatement") {
      const variable = statement as hbs.AST.MustacheStatement;
      if (allowIncludes && isIncludeCall(variable)) continue;
      if (variable.escaped && ((isVariablePath(variable.path) &&
          variable.params.length === 0 && !variable.hash?.pairs.length) || isStringCall(variable))) {
        continue;
      }
    }
    if (statement.type === "BlockStatement") {
      const block = statement as hbs.AST.BlockStatement;
      if (isVariablePath(block.path) && block.path.original === "if" &&
          block.params.length === 1 && !block.hash?.pairs.length &&
          block.program && !block.program.blockParams?.length &&
          isConditionExpression(block.params[0])) {
        validateProgram(block.program, allowIncludes);
        if (block.inverse) {
          validateProgram(block.inverse, allowIncludes);
        }
        continue;
      }
    }
    throw new Error(
      `Unsupported template syntax at line ${statement.loc?.start.line ?? "?"}. ` +
      'Use {{name}}, slice/trim/upper/lower (up to 8 levels, integer slice indices), ' +
      'if conditions using eq/ne comparisons and and/or combinations (up to 8 levels), ' +
      'or a standalone {{include "./file.md" section="Heading"}} (no nested includes).'
    );
  }
}

export async function resolveSelectionVariables(
  content: string,
  documentContent: string,
  fileName: string,
  requestValue: (name: string) => Promise<string | undefined>,
  transformContent: (content: string) => string = content => content,
  loadContext?: (reference: string) => Promise<string>,
  contextOverride?: string,
  loadFragment?: (reference: string, section: string) => Promise<{ content: string; transformContent: (content: string) => string }>
): Promise<string | null> {
  const document = parseMarkdownMetaDocument(documentContent.split(/\r?\n/));
  const metadata = document.document.namespaces.prompto;
  const contextReference = contextOverride ?? metadata?.context;
  let sharedVariables: Record<string, string> = {};
  if (contextReference) {
    try {
      if (!loadContext) {
        throw new Error("Context loading is unavailable for this selection.");
      }
      sharedVariables = parseSelectionContextVariables(await loadContext(contextReference));
    } catch (error) {
      throw new Error(`Cannot load context "${contextReference}": ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const variables = mergeVariableNamespaces(sharedVariables, metadata?.vars ?? {});
  for (const name of ["selectedText", "fileName"]) {
    if (Object.prototype.hasOwnProperty.call(variables, name)) {
      throw new Error(`Document variables cannot override {{${name}}}.`);
    }
  }

  const values = new Map<string, string>([
    ["selectedText", content],
    ["fileName", fileName],
  ]);
  async function getValue(name: string): Promise<string | undefined> {
    if (values.has(name)) {
      return values.get(name);
    }
    if (Object.keys(variables).some(key => key.startsWith(`${name}.`)) ||
        name.split(".").slice(0, -1).some((_segment, index, segments) =>
          values.has(segments.slice(0, index + 1).join(".")) ||
          Object.prototype.hasOwnProperty.call(variables, segments.slice(0, index + 1).join(".")))) {
      throw new Error(`Variable ${name} must reference a string leaf, not a group or a property of a string.`);
    }
    const value = Object.prototype.hasOwnProperty.call(variables, name)
      ? variables[name]
      : await requestValue(name);
    if (value !== undefined) {
      values.set(name, value);
    }
    return value;
  }

  let pathMarker = `PROMPTO_PATH_TOKEN:${randomUUID()}:`;
  while (content.includes(pathMarker)) {
    pathMarker += "_";
  }
  const literalMarker = `PROMPTO_LITERAL_INCLUDE_${randomUUID()}_`;
  const literalIncludes: string[] = [];
  function restoreLiterals(text: string): string {
    return text.replace(new RegExp(`${literalMarker}(\\d+)_`, "g"),
      (_token, index: string) => literalIncludes[Number(index)]);
  }
  function protectExamples(text: string): string {
    let fence: { marker: string; length: number } | undefined;
    let inComment = false;
    const protect = (part: string) => part.replace(/\{\{\s*include\b[^\r\n]*?\}\}/g,
      literal => `${literalMarker}${literalIncludes.push(literal) - 1}_`);
    return text.split("\n").map(line => {
      const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
      if (fence) {
        if (fenceMatch && fenceMatch[1][0] === fence.marker &&
            fenceMatch[1].length >= fence.length && !fenceMatch[2].trim()) fence = undefined;
        return protect(line);
      }
      if (!inComment && fenceMatch) {
        fence = { marker: fenceMatch[1][0], length: fenceMatch[1].length };
        return protect(line);
      }
      let result = "";
      let offset = 0;
      while (offset < line.length) {
        if (inComment) {
          const end = line.indexOf("-->", offset);
          if (end < 0) return result + protect(line.slice(offset));
          result += protect(line.slice(offset, end + 3));
          offset = end + 3;
          inComment = false;
        } else {
          const start = line.indexOf("<!--", offset);
          if (start < 0) return result + line.slice(offset);
          result += line.slice(offset, start);
          offset = start;
          inComment = true;
        }
      }
      return result;
    }).join("\n");
  }
  const templateContent = protectExamples(content).replace(/\{\{path:/g, () => pathMarker);
  const program = parse(templateContent);
  const templateLines = templateContent.split("\n");
  validateProgram(program);

  let expressionMarker = `PROMPTO_STRING_TOKEN_${randomUUID()}_`;
  while (content.includes(expressionMarker)) {
    expressionMarker += "_";
  }
  const expressionPattern = new RegExp(`${expressionMarker}(\\d+)_`, "g");
  const expressions: hbs.AST.MustacheStatement[] = [];
  const expressionSources: string[] = [];

  async function evaluateCondition(condition: hbs.AST.SubExpression): Promise<boolean | undefined> {
    const operator = (condition.path as hbs.AST.PathExpression).original;
    if (operator === "eq" || operator === "ne") {
      const name = (condition.params[0] as hbs.AST.PathExpression).original;
      const value = await getValue(name);
      if (value === undefined) {
        return undefined;
      }
      const expected = (condition.params[1] as hbs.AST.StringLiteral).value
        .split(pathMarker).join("{{path:");
      return operator === "eq" ? value === expected : value !== expected;
    }
    for (const parameter of condition.params) {
      const result = await evaluateCondition(parameter as hbs.AST.SubExpression);
      if (result === undefined) {
        return undefined;
      }
      if (operator === "and" && !result) {
        return false;
      }
      if (operator === "or" && result) {
        return true;
      }
    }
    return operator === "and";
  }

  let includeCount = 0;
  let includedBytes = 0;
  async function selectBranches(branch: hbs.AST.Program, lines = templateLines, allowIncludes = true): Promise<string | null> {
    const parts: string[] = [];
    for (const statement of branch.body) {
      if (statement.type === "ContentStatement") {
        parts.push((statement as hbs.AST.ContentStatement).value.split(pathMarker).join("{{path:"));
      } else if (statement.type === "MustacheStatement") {
        const variable = statement as hbs.AST.MustacheStatement;
        if (isIncludeCall(variable)) {
          if (!allowIncludes) throw new Error("Nested include is not supported.");
          if (!loadFragment) throw new Error("Include loading is unavailable for this selection.");
          if (++includeCount > 32) throw new Error("At most 32 includes are allowed.");
          const before = lines[variable.loc.start.line - 1].slice(0, variable.loc.start.column);
          const after = lines[variable.loc.end.line - 1].slice(variable.loc.end.column);
          if (before.trim() || after.trim()) throw new Error("Include must be on its own line.");
          const fragment = await loadFragment(
            (variable.params[0] as hbs.AST.StringLiteral).value,
            (variable.hash.pairs[0].value as hbs.AST.StringLiteral).value
          );
          includedBytes += Buffer.byteLength(fragment.content, "utf8");
          if (includedBytes > 1024 * 1024) throw new Error("Included content cannot exceed 1 MiB.");
          const fragmentTemplate = protectExamples(fragment.content).replace(/\{\{path:/g, () => pathMarker);
          const fragmentProgram = parse(fragmentTemplate);
          validateProgram(fragmentProgram, false);
          const result = await selectBranches(fragmentProgram, fragmentTemplate.split("\n"), false);
          if (result === null) return null;
          parts.push(fragment.transformContent(result));
          continue;
        }
        if (variable.params.length === 0) {
          parts.push(`{{${(variable.path as hbs.AST.PathExpression).original}}}`);
        } else {
          parts.push(`${expressionMarker}${expressions.length}_`);
          expressions.push(variable);
          const { start, end } = variable.loc;
          const sourceLines = lines.slice(start.line - 1, end.line);
          sourceLines[sourceLines.length - 1] = sourceLines[sourceLines.length - 1].slice(0, end.column);
          sourceLines[0] = sourceLines[0].slice(start.column);
          expressionSources.push(sourceLines.join("\n").split(pathMarker).join("{{path:"));
        }
      } else {
        const block = statement as hbs.AST.BlockStatement;
        const matches = await evaluateCondition(block.params[0] as hbs.AST.SubExpression);
        if (matches === undefined) {
          return null;
        }
        const selectedBranch = matches
          ? block.program : block.inverse;
        if (selectedBranch) {
          const result = await selectBranches(selectedBranch, lines, allowIncludes);
          if (result === null) {
            return null;
          }
          parts.push(result);
        }
      }
    }
    return parts.join("");
  }

  const selectedContent = await selectBranches(program);
  if (selectedContent === null) {
    return null;
  }
  const processedContent = transformContent(selectedContent);
  if (includeCount && Buffer.byteLength(processedContent, "utf8") > 1024 * 1024) {
    throw new Error("Expanded includes cannot exceed 1 MiB.");
  }
  values.set("selectedText", restoreLiterals(processedContent.replace(expressionPattern,
    (_token, index: string) => expressionSources[Number(index)])));
  const names = new Set(
    Array.from(processedContent.matchAll(new RegExp(`\\{\\{(${VARIABLE_PATH_PATTERN})\\}\\}`, "g")), match => match[1])
  );
  for (const name of names) {
    const value = await getValue(name);
    if (value === undefined) {
      return null;
    }
  }

  async function evaluateStringCall(call: StringCall): Promise<string | undefined> {
    const source = call.params[0];
    const value = isVariablePath(source)
      ? await getValue(source.original)
      : await evaluateStringCall(source as hbs.AST.SubExpression);
    if (value === undefined) {
      return undefined;
    }
    switch ((call.path as hbs.AST.PathExpression).original) {
      case "slice":
        return value.slice((call.params[1] as hbs.AST.NumberLiteral).value,
          (call.params[2] as hbs.AST.NumberLiteral | undefined)?.value);
      case "trim":
        return value.trim();
      case "upper":
        return value.toUpperCase();
      case "lower":
        return value.toLowerCase();
      default:
        throw new Error("Unsupported string function.");
    }
  }

  const expressionValues: string[] = [];
  for (const expression of expressions) {
    const result = await evaluateStringCall(expression);
    if (result === undefined) {
      return null;
    }
    expressionValues.push(result);
  }

  const result = restoreLiterals(processedContent.replace(
    new RegExp(`\\{\\{(${VARIABLE_PATH_PATTERN})\\}\\}|${expressionMarker}(\\d+)_`, "g"),
    (_template, name: string | undefined, index: string | undefined) =>
      name !== undefined ? values.get(name)! : expressionValues[Number(index)]
  ));
  if (includeCount && Buffer.byteLength(result, "utf8") > 1024 * 1024) {
    throw new Error("Rendered includes cannot exceed 1 MiB.");
  }
  return result;
}