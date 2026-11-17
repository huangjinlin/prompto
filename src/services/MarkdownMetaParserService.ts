/**
 * 统一 Markdown 元信息解析服务
 * 仅识别 md-meta 宿主块
 * 输出 MarkdownMetaDocument 归一化结构
 */

import { parseYamlSubset } from "./MarkdownYamlParserService";
import { flattenVariableDefinitions } from "./VariableNamespaceService";
import type {
  ActionMeta,
  DocumentMeta,
  FlowBranch,
  FlowMeta,
  NamespaceBag,
  NodeMeta,
  OutlineMeta,
  PromptoMeta,
  MarkdownMetaDocument,
} from "../models/MarkdownMeta";

// ── 正则 ──

const MD_META_START = /^\s*<!--\s*md-meta\s*$/;
const COMMENT_END = /^\s*-->\s*$/;
const HEADING = /^(#{1,6})\s+(.+?)\s*$/;
const CODE_FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

// ── 主入口 ──

export function parseMarkdownMetaDocument(
  lines: string[]
): MarkdownMetaDocument {
  const doc: MarkdownMetaDocument = {
    version: 1,
    document: { defaults: {}, namespaces: {} },
    nodes: [],
    actions: [],
  };

  let inCodeFence = false;
  let activeFenceMarker: string | undefined;
  let activeFenceLength = 0;
  let lastHeading: { title: string; level: number; line: number } | undefined;
  let seenMetaBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 代码块跳过
    const fenceMatch = line.match(CODE_FENCE);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (!inCodeFence) {
        inCodeFence = true;
        activeFenceMarker = marker;
        activeFenceLength = fenceMatch[1].length;
      } else if (activeFenceMarker === marker && fenceMatch[1].length >= activeFenceLength && !fenceMatch[2].trim()) {
        inCodeFence = false;
        activeFenceMarker = undefined;
      }
      continue;
    }
    if (inCodeFence) {
      continue;
    }

    if (/^\s*<!--/.test(line) && !MD_META_START.test(line)) {
      if (!line.slice(line.indexOf("<!--") + 4).includes("-->")) {
        while (i + 1 < lines.length) {
          i++;
          if (lines[i].includes("-->")) {
            break;
          }
        }
      }
      continue;
    }

    // 标题记录
    const headingMatch = line.match(HEADING);
    if (headingMatch) {
      lastHeading = {
        title: headingMatch[2],
        level: headingMatch[1].length,
        line: i,
      };
      continue;
    }

    // md-meta 块
    if (MD_META_START.test(line)) {
      const block = extractCommentBlock(lines, i);
      if (block) {
        // 判断是否为文档作用域：
        // 1. 没有标题在前面
        // 2. 前面只有 H1 标题且这是第一个 meta 块
        const isDocScope =
          !lastHeading || (lastHeading.level === 1 && !seenMetaBlock);
        processMdMetaBlock(doc, block.body, block.endLine, lastHeading, isDocScope);
        seenMetaBlock = true;
        i = block.endLine;
      }
      continue;
    }

  }

  return doc;
}

// ── md-meta 块处理 ──

function processMdMetaBlock(
  doc: MarkdownMetaDocument,
  body: string,
  endLine: number,
  lastHeading: { title: string; level: number; line: number } | undefined,
  implicitDocumentScope: boolean
): void {
  const parsed = parseYamlSubset(body);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return;
  }

  const root = parsed as Record<string, unknown>;
  const version = typeof root.version === "number" ? root.version : 1;
  doc.version = version;

  const scope = typeof root.scope === "string" ? root.scope : undefined;
  const defaults = root.defaults as Record<string, unknown> | undefined;

  // 提取命名空间
  const namespaces = extractNamespaces(root);

  // 文档级：第一个标题之前，或 scope === "document"
  const isDocumentScope =
    scope === "document" || (!scope && implicitDocumentScope);

  if (!isDocumentScope && namespaces.prompto?.chatSession) {
    throw new Error("Prompto chatSession is only supported at document scope.");
  }

  if (isDocumentScope) {
    if (defaults) {
      doc.document.defaults = parseNamespaceBag(defaults);
      if (doc.document.defaults.prompto?.chatSession) {
        throw new Error("Use document prompto.chatSession, not defaults.prompto.chatSession.");
      }
    }
    doc.document.namespaces = namespaces;
    return;
  }

  // 动作级
  if (scope === "action") {
    doc.actions.push({
      line: findActionAnchorLineFromEnd(endLine),
      scope: "action",
      namespaces,
    });
    return;
  }

  // 节点级（默认）
  if (lastHeading) {
    doc.nodes.push({
      title: lastHeading.title,
      level: lastHeading.level,
      line: lastHeading.line,
      scope: "node",
      namespaces,
    });
  }
}

// ── 命名空间提取 ──

function extractNamespaces(root: Record<string, unknown>): NamespaceBag {
  const bag: NamespaceBag = {};

  if (root.prompto && typeof root.prompto === "object" && !Array.isArray(root.prompto)) {
    bag.prompto = parsePromptoMeta(root.prompto as Record<string, unknown>);
  }

  if (root.flow && typeof root.flow === "object" && !Array.isArray(root.flow)) {
    bag.flow = parseFlowMeta(root.flow as Record<string, unknown>);
  }

  if (root.outline && typeof root.outline === "object" && !Array.isArray(root.outline)) {
    bag.outline = parseOutlineMeta(root.outline as Record<string, unknown>);
  }

  // 自定义命名空间
  const standardKeys = new Set([
    "version",
    "scope",
    "defaults",
    "prompto",
    "flow",
    "outline",
  ]);
  for (const key of Object.keys(root)) {
    if (!standardKeys.has(key)) {
      if (!bag.custom) {
        bag.custom = {};
      }
      bag.custom[key] = root[key];
    }
  }

  return bag;
}

function parsePromptoMeta(obj: Record<string, unknown>): PromptoMeta {
  const meta: PromptoMeta = {};

  if (Object.prototype.hasOwnProperty.call(obj, "source") || Object.prototype.hasOwnProperty.call(obj, "deliveryFrom")) {
    throw new Error("Prompto source and deliveryFrom have been removed. Use {{include \"./file.md\" section=\"Heading\"}} in the body instead.");
  }

  if (typeof obj.promptContent === "string") {
    meta.promptContent = obj.promptContent;
  }
  if (typeof obj.deliveryTarget === "string") {
    meta.deliveryTarget = obj.deliveryTarget;
  }
  if (typeof obj.outputMode === "string") {
    meta.outputMode = obj.outputMode;
  }
  if (typeof obj.title === "string") {
    meta.title = obj.title;
  }

  if (Object.prototype.hasOwnProperty.call(obj, "chatSession")) {
    const session = obj.chatSession;
    if (!session || typeof session !== "object" || Array.isArray(session)) {
      throw new Error("Prompto chatSession must contain a literal title.");
    }
    const fields = session as Record<string, unknown>;
    if (Object.keys(fields).some(key => key !== "title" && key !== "workspace" && key !== "project") ||
        typeof fields.title !== "string" || !fields.title.trim() ||
        /[\u0000-\u001f\u007f{}]/.test(fields.title) ||
        (Object.prototype.hasOwnProperty.call(fields, "workspace") &&
          (typeof fields.workspace !== "string" || !fields.workspace.trim() || /[\u0000-\u001f\u007f{}]/.test(fields.workspace))) ||
        (Object.prototype.hasOwnProperty.call(fields, "project") &&
          (typeof fields.project !== "string" || !fields.project.trim() || /[\u0000-\u001f\u007f{}]/.test(fields.project)))) {
      throw new Error("Prompto chatSession.title and optional workspace/project must be non-empty, single-line literals.");
    }
    meta.chatSession = { title: fields.title.trim(), ...(typeof fields.workspace === "string" ? { workspace: fields.workspace.trim() } : {}), ...(typeof fields.project === "string" ? { project: fields.project.trim() } : {}) };
  }

  if (Object.prototype.hasOwnProperty.call(obj, "sectionLevels")) {
    let levels: unknown = obj.sectionLevels;
    if (typeof levels === "string") {
      try {
        levels = JSON.parse(levels);
      } catch {
        throw new Error("Prompto sectionLevels must be an array of heading levels from 1 to 6.");
      }
    }
    if (!Array.isArray(levels) || levels.some(level => !Number.isInteger(level) || level < 1 || level > 6)) {
      throw new Error("Prompto sectionLevels must be an array of heading levels from 1 to 6.");
    }
    meta.sectionLevels = [...new Set<number>(levels)];
  }

  if (Object.prototype.hasOwnProperty.call(obj, "context")) {
    if (typeof obj.context !== "string" || !obj.context.trim() || /[{}\r\n\0]/.test(obj.context)) {
      throw new Error("Prompto context must be a non-empty, single-line literal file path.");
    }
    meta.context = obj.context.trim();
  }

  // 提取自定义变量（vars 子结构）
  if (Object.prototype.hasOwnProperty.call(obj, "vars")) {
    meta.vars = flattenVariableDefinitions(obj.vars);
  }

  return meta;
}

function parseFlowMeta(obj: Record<string, unknown>): FlowMeta {
  const meta: FlowMeta = {};

  if (typeof obj.id === "string") {
    meta.id = obj.id;
  }
  if (typeof obj.title === "string") {
    meta.title = obj.title;
  }
  if (typeof obj.direction === "string") {
    meta.direction = obj.direction;
  }
  if (typeof obj.entry === "string") {
    meta.entry = obj.entry;
  }
  if (typeof obj.kind === "string") {
    meta.kind = obj.kind;
  }
  if (typeof obj.next === "string") {
    meta.next = obj.next;
  }
  if (typeof obj.group === "string") {
    meta.group = obj.group;
  }
  if (Array.isArray(obj.branches)) {
    meta.branches = obj.branches
      .filter(
        (b): b is Record<string, unknown> =>
          typeof b === "object" && b !== null && !Array.isArray(b)
      )
      .map((b) => {
        const branch: FlowBranch = {
          label: typeof b.label === "string" ? b.label : "",
          to: typeof b.to === "string" ? b.to : "",
        };
        return branch;
      });
  }

  return meta;
}

function parseOutlineMeta(obj: Record<string, unknown>): OutlineMeta {
  const meta: OutlineMeta = {};

  if (obj.status === null) {
    meta.status = null;
  } else if (typeof obj.status === "string") {
    meta.status = obj.status;
  }

  return meta;
}

function parseNamespaceBag(obj: Record<string, unknown>): NamespaceBag {
  return extractNamespaces(obj);
}

// ── 工具函数 ──

interface CommentBlock {
  body: string;
  endLine: number;
}

function extractCommentBlock(
  lines: string[],
  startLine: number
): CommentBlock | undefined {
  const bodyLines: string[] = [];

  for (let i = startLine + 1; i < lines.length; i++) {
    const line = lines[i];
    if (COMMENT_END.test(line)) {
      return {
        body: bodyLines.join("\n"),
        endLine: i,
      };
    }
    bodyLines.push(line);
  }

  return undefined;
}

function findActionAnchorLineFromEnd(endLine: number): number {
  return endLine + 1;
}
