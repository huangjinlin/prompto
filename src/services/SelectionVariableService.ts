import { parse } from "handlebars";
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

function validateProgram(program: hbs.AST.Program): void {
  for (const statement of program.body) {
    if (statement.type === "ContentStatement") {
      continue;
    }
    if (statement.type === "MustacheStatement") {
      const variable = statement as hbs.AST.MustacheStatement;
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
        validateProgram(block.program);
        if (block.inverse) {
          validateProgram(block.inverse);
        }
        continue;
      }
    }
    throw new Error(
      `Unsupported template syntax at line ${statement.loc?.start.line ?? "?"}. ` +
      'Use {{name}}, slice/trim/upper/lower (up to 8 levels, integer slice indices), ' +
      'or if conditions using eq/ne comparisons and and/or combinations (up to 8 levels).'
    );
  }
}

export async function resolveSelectionVariables(
  content: string,
  documentContent: string,
  fileName: string,
  requestValue: (name: string) => Promise<string | undefined>,
  transformContent: (content: string) => string = content => content,
  loadContext?: (reference: string) => Promise<string>
): Promise<string | null> {
  const document = parseMarkdownMetaDocument(documentContent.split(/\r?\n/));
  const metadata = document.document.namespaces.prompto;
  let sharedVariables: Record<string, string> = {};
  if (metadata?.context) {
    try {
      if (!loadContext) {
        throw new Error("Context loading is unavailable for this selection.");
      }
      sharedVariables = parseSelectionContextVariables(await loadContext(metadata.context));
    } catch (error) {
      throw new Error(`Cannot load context "${metadata.context}": ${error instanceof Error ? error.message : String(error)}`);
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

  let pathMarker = "PROMPTO_PATH_TOKEN:";
  while (content.includes(pathMarker)) {
    pathMarker += "_";
  }
  const templateContent = content.replace(/\{\{path:/g, () => pathMarker);
  const program = parse(templateContent);
  validateProgram(program);

  let expressionMarker = "PROMPTO_STRING_TOKEN_";
  while (content.includes(expressionMarker)) {
    expressionMarker += "_";
  }
  const expressionPattern = new RegExp(`${expressionMarker}(\\d+)_`, "g");
  const expressions: hbs.AST.MustacheStatement[] = [];
  const expressionSources: string[] = [];
  const templateLines = templateContent.split("\n");

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

  async function selectBranches(branch: hbs.AST.Program): Promise<string | null> {
    const parts: string[] = [];
    for (const statement of branch.body) {
      if (statement.type === "ContentStatement") {
        parts.push((statement as hbs.AST.ContentStatement).value.split(pathMarker).join("{{path:"));
      } else if (statement.type === "MustacheStatement") {
        const variable = statement as hbs.AST.MustacheStatement;
        if (variable.params.length === 0) {
          parts.push(`{{${(variable.path as hbs.AST.PathExpression).original}}}`);
        } else {
          parts.push(`${expressionMarker}${expressions.length}_`);
          expressions.push(variable);
          const { start, end } = variable.loc;
          const sourceLines = templateLines.slice(start.line - 1, end.line);
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
          const result = await selectBranches(selectedBranch);
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
  values.set("selectedText", processedContent.replace(expressionPattern,
    (_token, index: string) => expressionSources[Number(index)]));
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

  return processedContent.replace(
    new RegExp(`\\{\\{(${VARIABLE_PATH_PATTERN})\\}\\}|${expressionMarker}(\\d+)_`, "g"),
    (_template, name: string | undefined, index: string | undefined) =>
      name !== undefined ? values.get(name)! : expressionValues[Number(index)]
  );
}