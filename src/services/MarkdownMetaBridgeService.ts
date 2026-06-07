/**
 * 桥接服务：从归一化的 MarkdownMetaDocument 中提取 prompto 命名空间数据
 * 供 extension.ts 中的执行管线使用
 */

import { parseMarkdownMetaDocument } from "./MarkdownMetaParserService";
import type { PromptoMeta, NamespaceBag } from "../models/MarkdownMeta";

// ── 主查询函数 ──

/**
 * 按标题行号查找节点级 prompto 元数据
 */
export function findPromptoMetaForHeading(
  lines: string[],
  headingLine: number
): PromptoMeta | undefined {
  const doc = parseMarkdownMetaDocument(lines);
  const node = doc.nodes.find((n) => n.line === headingLine);
  return node?.namespaces.prompto;
}

/**
 * 按动作行号查找动作级 prompto 元数据
 */
export function findPromptoMetaForAction(
  lines: string[],
  anchorLine: number
): PromptoMeta | undefined {
  const doc = parseMarkdownMetaDocument(lines);
  const action = doc.actions.find((a) => a.line === anchorLine);
  return action?.namespaces.prompto;
}

/**
 * 按标题行号查找完整命名空间数据（含 flow、outline 等）
 */
export function findNamespacesForHeading(
  lines: string[],
  headingLine: number
): NamespaceBag | undefined {
  const doc = parseMarkdownMetaDocument(lines);
  const node = doc.nodes.find((n) => n.line === headingLine);
  return node?.namespaces;
}

/**
 * 按标题行号提取标题文本
 */
export function getHeadingText(
  lines: string[],
  headingLine: number
): string {
  const line = lines[headingLine] || "";
  const match = line.match(/^#{1,6}\s+(.+?)\s*$/);
  return match ? match[1] : `Heading (line ${headingLine})`;
}

/**
 * 从 TextDocument 提取行数组
 */
export function getDocumentLines(
  document: { lineCount: number; lineAt(index: number): { text: string } }
): string[] {
  return Array.from({ length: document.lineCount }, (_, i) =>
    document.lineAt(i).text
  );
}

/**
 * 从 prompto 元数据构造 SelectedTextVariableContext
 */
export function buildSelectedTextContextFromPrompto(
  prompto: PromptoMeta,
  body?: string
): {
  rawSelectedText: string;
  selectedText: string;
  variables: Record<string, string>;
  promptReference?: string;
  inlinePromptContent?: string;
} {
  const selectedText = body || "";
  const variables: Record<string, string> = {};

  // 从 prompto 中提取变量相关的字段
  if (prompto.deliveryTarget) {
    variables.deliveryTarget = prompto.deliveryTarget;
  }
  if (prompto.outputMode) {
    variables.outputMode = prompto.outputMode;
  }

  return {
    rawSelectedText: selectedText,
    selectedText,
    variables,
    promptReference: prompto.prompt,
    inlinePromptContent: prompto.promptContent,
  };
}

/**
 * 获取节点的正文内容（用于 selectedText）
 */
export function getNodeBody(
  lines: string[],
  headingLine: number
): string {
  const headingMatch = (lines[headingLine] || "").match(/^(#{1,6})\s+/);
  if (!headingMatch) {
    return "";
  }

  const headingLevel = headingMatch[1].length;
  const bodyLines: string[] = [];
  const MD_META_START = /^\s*<!--\s*md-meta(?:\s*-->)?\s*$/;
  const COMMENT_END = /^\s*-->\s*$/;

  // 跳过 meta 块，找到正文起始行
  let i = headingLine + 1;

  // 跳过空行
  while (i < lines.length && !lines[i].trim()) {
    i++;
  }

  // 跳过紧邻标题的 meta 块
  if (i < lines.length && /^\s*<!--/.test(lines[i])) {
    while (i < lines.length && !COMMENT_END.test(lines[i])) {
      i++;
    }
    if (i < lines.length) {
      i++; // 跳过 -->
    }
  }

  // 跳过空行
  while (i < lines.length && !lines[i].trim()) {
    i++;
  }

  // 收集正文直到下一个同级或更高级标题
  for (; i < lines.length; i++) {
    const line = lines[i];
    const nextHeading = line.match(/^(#{1,6})\s+/);
    if (nextHeading && nextHeading[1].length <= headingLevel) {
      break;
    }

    // 过滤正文中的所有 md-meta 块（例如 action 级元信息）
    if (MD_META_START.test(line)) {
      while (i < lines.length && !COMMENT_END.test(lines[i])) {
        i++;
      }
      continue;
    }

    bodyLines.push(line);
  }

  // 去掉末尾空行
  while (bodyLines.length > 0 && !bodyLines[bodyLines.length - 1].trim()) {
    bodyLines.pop();
  }

  return bodyLines.join("\n").trim();
}
