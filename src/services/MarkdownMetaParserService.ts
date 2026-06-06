/**
 * 统一 Markdown 元信息解析服务
 * 识别 md-meta、prompto、prompto-action、outline 四种宿主块
 * 输出 MarkdownMetaDocument 归一化结构
 */

import { parseYamlSubset } from "./MarkdownYamlParserService";
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
const PROMPTO_START = /^\s*<!--\s*prompto\s*$/;
const PROMPTO_ACTION_START = /^\s*<!--\s*prompto-action\s*$/;
const OUTLINE_START = /^\s*<!--\s*outline\s*$/;
const COMMENT_END = /^\s*-->\s*$/;
const HEADING = /^(#{1,6})\s+(.+?)\s*$/;
const CODE_FENCE = /^\s*(`{3,}|~{3,})/;
const KV_LINE = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)\s*$/;

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
      } else if (activeFenceMarker === marker) {
        inCodeFence = false;
        activeFenceMarker = undefined;
      }
      continue;
    }
    if (inCodeFence) {
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
        processMdMetaBlock(doc, block.body, block.endLine, isDocScope ? undefined : lastHeading);
        seenMetaBlock = true;
        i = block.endLine;
      }
      continue;
    }

    // prompto 块（旧语法）
    if (PROMPTO_START.test(line)) {
      const block = extractCommentBlock(lines, i);
      if (block) {
        const vars = parseFlatKeyValue(block.body);
        seenMetaBlock = true;
        if (lastHeading) {
          const prompto = buildPromptoFromFlat(vars);
          doc.nodes.push({
            title: lastHeading.title,
            level: lastHeading.level,
            line: lastHeading.line,
            scope: "node",
            namespaces: { prompto },
          });
        }
        i = block.endLine;
      }
      continue;
    }

    // prompto-action 块（旧语法）
    if (PROMPTO_ACTION_START.test(line)) {
      const block = extractCommentBlock(lines, i);
      if (block) {
        const vars = parseFlatKeyValue(block.body);
        seenMetaBlock = true;
        const title = vars.title?.trim();
        if (title) {
          const prompto = buildPromptoFromFlat(vars, true);
          doc.actions.push({
            line: findActionAnchorLine(lines, block.endLine),
            scope: "action",
            namespaces: { prompto },
          });
        }
        i = block.endLine;
      }
      continue;
    }

    // outline 块（旧语法）
    if (OUTLINE_START.test(line)) {
      const block = extractCommentBlock(lines, i);
      if (block) {
        const vars = parseFlatKeyValue(block.body);
        seenMetaBlock = true;
        const status = vars.status?.trim() || undefined;
        if (lastHeading) {
          doc.nodes.push({
            title: lastHeading.title,
            level: lastHeading.level,
            line: lastHeading.line,
            scope: "node",
            namespaces: { outline: { status } },
          });
        }
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
  lastHeading: { title: string; level: number; line: number } | undefined
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
    scope === "document" || (!scope && !lastHeading);

  if (isDocumentScope) {
    if (defaults) {
      doc.document.defaults = parseNamespaceBag(defaults);
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

  if (typeof obj.prompt === "string") {
    meta.prompt = obj.prompt;
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

  // 冲突检测
  if (meta.prompt && meta.promptContent) {
    meta._resolved = {
      conflict: "prompt-vs-promptContent",
      chosen: "promptContent",
    };
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

// ── 旧语法归一化 ──

function buildPromptoFromFlat(
  vars: Record<string, string>,
  isAction = false
): PromptoMeta {
  const meta: PromptoMeta = {};

  const prompt = vars.prompt?.trim();
  const promptContent = vars.promptContent?.trim();

  if (!isAction) {
    if (prompt) {
      meta.prompt = prompt;
    }
    if (vars.deliveryTarget?.trim()) {
      meta.deliveryTarget = vars.deliveryTarget.trim();
    }
    if (vars.outputMode?.trim()) {
      meta.outputMode = vars.outputMode.trim();
    }
  }

  if (isAction && vars.title?.trim()) {
    meta.title = vars.title.trim();
  }

  // 处理 promptContent（支持 | 多行）
  if (promptContent) {
    meta.promptContent = promptContent;
  }

  // 冲突检测：旧块同时出现 prompt 和 promptContent，默认取 promptContent
  if (meta.prompt && meta.promptContent) {
    meta._resolved = {
      conflict: "prompt-vs-promptContent",
      chosen: "promptContent",
    };
  }

  return meta;
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

function parseFlatKeyValue(body: string): Record<string, string> {
  const vars: Record<string, string> = {};
  const lines = body.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) {
      continue;
    }

    const match = line.match(KV_LINE);
    if (!match) {
      continue;
    }

    const key = match[1];
    const value = match[2];

    if (value === "|") {
      // 多行值
      const multiline: string[] = [];
      i++;
      while (i < lines.length) {
        const nextLine = lines[i];
        if (!nextLine.trim()) {
          multiline.push("");
          i++;
          continue;
        }
        // 如果是新的 key: 或结束标记，停止
        if (KV_LINE.test(nextLine)) {
          break;
        }
        multiline.push(nextLine);
        i++;
      }
      // 回退一行，让外层循环继续
      i--;
      // 去掉末尾空行
      while (multiline.length > 0 && multiline[multiline.length - 1] === "") {
        multiline.pop();
      }
      // 去掉公共前导空格（YAML 多行字符串缩进）
      vars[key] = stripCommonIndent(multiline).join("\n");
    } else {
      vars[key] = value;
    }
  }

  return vars;
}

function findActionAnchorLine(
  lines: string[],
  metadataEndLine: number
): number {
  for (let i = metadataEndLine + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) {
      continue;
    }
    if (
      PROMPTO_ACTION_START.test(lines[i]) ||
      PROMPTO_START.test(lines[i]) ||
      MD_META_START.test(lines[i]) ||
      HEADING.test(lines[i]) ||
      trimmed.startsWith("<!--")
    ) {
      return metadataEndLine + 1;
    }
    return i;
  }
  return metadataEndLine + 1;
}

function findActionAnchorLineFromEnd(endLine: number): number {
  return endLine + 1;
}

function stripCommonIndent(lines: string[]): string[] {
  if (lines.length === 0) {
    return lines;
  }
  // 找到非空行的最小前导空格数
  let minIndent = Infinity;
  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    const indent = line.length - line.trimStart().length;
    if (indent < minIndent) {
      minIndent = indent;
    }
  }
  if (minIndent === Infinity || minIndent === 0) {
    return lines;
  }
  return lines.map((line) => {
    if (!line.trim()) {
      return "";
    }
    return line.slice(minIndent);
  });
}
