/**
 * Flow 提取服务
 * 从 MarkdownMetaDocument 中提取 flow 命名空间，构建稳定图模型
 */

import { parseMarkdownMetaDocument } from "./MarkdownMetaParserService";
import type { MarkdownMetaDocument, NodeMeta, FlowMeta, PromptoMeta } from "../models/MarkdownMeta";

// ── 图模型类型 ──

export type FlowNodeKind = "start" | "action" | "decision" | "end";

export interface FlowNodePrompto {
  title: string;
  line: number;
  isAction: boolean;
  prompt?: string;
  promptContent?: string;
  deliveryTarget?: string;
  outputMode?: string;
  vars?: Record<string, string>;
}

export interface FlowNode {
  id: string;
  title: string;
  kind: FlowNodeKind;
  line: number;
  group?: string;
  promptoItems?: FlowNodePrompto[];
  hasBody?: boolean;
  bodyPreview?: string;
}

export interface FlowEdge {
  from: string;
  to: string;
  label?: string;
  branchIndex?: number;
  branchCount?: number;
}

export interface FlowGraph {
  id?: string;
  title?: string;
  direction?: string;
  entry?: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  diagnostics: FlowDiagnostic[];
}

export interface FlowDiagnostic {
  type: "missing-id" | "invalid-entry" | "invalid-next" | "invalid-branch-target" | "duplicate-id" | "no-entry" | "missing-kind";
  message: string;
  line?: number;
  nodeId?: string;
}

// ── 主入口 ──

export function extractFlowGraph(lines: string[]): FlowGraph {
  const doc = parseMarkdownMetaDocument(lines);
  return buildFlowGraph(doc, lines);
}

/**
 * 提取多个流程图（按 H1 文档级 flow 分组）
 * 每个拥有 flow.id 的 H1 节点视为一个独立流程图的根
 */
export function extractFlowGraphs(lines: string[]): FlowGraph[] {
  const doc = parseMarkdownMetaDocument(lines);

  // 收集所有 H1 级别的 flow 配置
  // 包括：文档级（第一个 H1 的 md-meta 被解析为 document scope）+ 节点级 H1
  type H1FlowEntry = { line: number; flow: FlowMeta; isDocScope: boolean };
  const h1Flows: H1FlowEntry[] = [];

  // 检查文档级 flow（第一个 H1 的情况）
  const docFlow = doc.document.namespaces.flow;
  if (docFlow?.id) {
    // 找到第一个 H1 节点的行号
    const HEADING_RE = /^(#{1})\s+/;
    for (let i = 0; i < lines.length; i++) {
      if (HEADING_RE.test(lines[i])) {
        h1Flows.push({ line: i, flow: docFlow, isDocScope: true });
        break;
      }
    }
  }

  // 检查节点级 H1
  for (const node of doc.nodes) {
    if (node.level === 1 && node.namespaces.flow?.id) {
      h1Flows.push({ line: node.line, flow: node.namespaces.flow, isDocScope: false });
    }
  }

  // 按行号排序去重（文档级和节点级可能指向同一个 H1）
  h1Flows.sort((a, b) => a.line - b.line);
  const unique: H1FlowEntry[] = [];
  for (const entry of h1Flows) {
    if (unique.length === 0 || unique[unique.length - 1].line !== entry.line) {
      unique.push(entry);
    }
  }

  if (unique.length === 0) {
    return [buildFlowGraph(doc, lines)];
  }

  const graphs: FlowGraph[] = [];

  for (let i = 0; i < unique.length; i++) {
    const h1 = unique[i];
    const nextH1Line = i + 1 < unique.length ? unique[i + 1].line : Infinity;

    // 收集此 H1 区间内的子节点（排除 H1 自身）
    const subNodes = doc.nodes.filter(
      (n) => n.line > h1.line && n.line < nextH1Line
    );

    // 收集此 H1 区间内的 actions
    const subActions = doc.actions.filter(
      (a) => a.line > h1.line && a.line < nextH1Line
    );

    // 找到此 H1 的标题
    const headingMatch = lines[h1.line]?.match(/^#{1,6}\s+(.+?)\s*$/);
    const h1Title = headingMatch ? headingMatch[1] : h1.flow.title || "Flow";

    // 构造子文档
    const subDoc: MarkdownMetaDocument = {
      version: doc.version,
      document: {
        defaults: doc.document.defaults,
        namespaces: {
          flow: {
            id: h1.flow.id,
            title: h1.flow.title || h1Title,
            direction: h1.flow.direction,
            entry: h1.flow.entry,
          },
        },
      },
      nodes: subNodes,
      actions: subActions,
    };

    graphs.push(buildFlowGraph(subDoc, lines));
  }

  return graphs;
}

export function buildFlowGraph(doc: MarkdownMetaDocument, lines?: string[]): FlowGraph {
  const diagnostics: FlowDiagnostic[] = [];
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const seenIds = new Set<string>();

  // 提取文档级 flow 配置
  const docFlow = doc.document.namespaces.flow;
  const graphId = docFlow?.id;
  const graphTitle = docFlow?.title;
  const graphDirection = docFlow?.direction;
  const graphEntry = docFlow?.entry;

  // 第一遍：提取节点
  for (const node of doc.nodes) {
    const flow = node.namespaces.flow;
    if (!flow) {
      continue;
    }

    if (!flow.id) {
      diagnostics.push({
        type: "missing-id",
        message: `节点 "${node.title}" 有 flow 配置但缺少 id`,
        line: node.line,
      });
      continue;
    }

    // 检查重复 id
    if (seenIds.has(flow.id)) {
      diagnostics.push({
        type: "duplicate-id",
        message: `节点 id "${flow.id}" 重复`,
        line: node.line,
        nodeId: flow.id,
      });
      continue;
    }
    seenIds.add(flow.id);

    // 推断 kind
    const kind = inferKind(flow);
    if (!flow.kind) {
      diagnostics.push({
        type: "missing-kind",
        message: `节点 "${flow.id}" 未指定 kind，默认为 action`,
        line: node.line,
        nodeId: flow.id,
      });
    }

    nodes.push({
      id: flow.id,
      title: node.title,
      kind,
      line: node.line,
      group: flow.group,
      promptoItems: collectPromptoItems(doc, node),
      hasBody: hasNodeBody(lines, node),
      bodyPreview: buildNodeBodyPreview(lines, node),
    });
  }

  // 第二遍：构建边
  for (const node of doc.nodes) {
    const flow = node.namespaces.flow;
    if (!flow?.id || !seenIds.has(flow.id)) {
      continue;
    }

    // branches 边
    if (flow.branches && flow.branches.length > 0) {
      for (let i = 0; i < flow.branches.length; i++) {
        const branch = flow.branches[i];
        if (!seenIds.has(branch.to) && !willBeSeenLater(doc, branch.to, node.line)) {
          diagnostics.push({
            type: "invalid-branch-target",
            message: `节点 "${flow.id}" 的分支 "${branch.label}" 指向未知节点 "${branch.to}"`,
            line: node.line,
            nodeId: flow.id,
          });
        }
        edges.push({
          from: flow.id,
          to: branch.to,
          label: branch.label,
          branchIndex: i,
          branchCount: flow.branches.length,
        });
      }
    }

    // next 边（branches 优先，next 兜底）
    if (flow.next) {
      if (!seenIds.has(flow.next) && !willBeSeenLater(doc, flow.next, node.line)) {
        diagnostics.push({
          type: "invalid-next",
          message: `节点 "${flow.id}" 的 next 指向未知节点 "${flow.next}"`,
          line: node.line,
          nodeId: flow.id,
        });
      }
      // 如果有 branches，next 作为默认边（无 label）
      // 如果没有 branches，next 作为唯一边
      if (!flow.branches || flow.branches.length === 0) {
        edges.push({
          from: flow.id,
          to: flow.next,
        });
      }
    } else if (!flow.branches || flow.branches.length === 0) {
      // 没有 next 也没有 branches：尝试自动连接到下一个 flow 节点
      const nextFlowNode = findNextFlowNode(doc, node.line);
      if (nextFlowNode) {
        edges.push({
          from: flow.id,
          to: nextFlowNode,
        });
      }
    }
  }

  // 验证 entry
  if (graphEntry) {
    if (!seenIds.has(graphEntry)) {
      diagnostics.push({
        type: "invalid-entry",
        message: `文档级 entry "${graphEntry}" 指向未知节点`,
        nodeId: graphEntry,
      });
    }
  } else if (nodes.length > 0) {
    diagnostics.push({
      type: "no-entry",
      message: "文档级 flow 配置缺少 entry",
    });
  }

  return {
    id: graphId,
    title: graphTitle,
    direction: graphDirection,
    entry: graphEntry,
    nodes,
    edges,
    diagnostics,
  };
}

// ── 辅助函数 ──

function inferKind(flow: FlowMeta): FlowNodeKind {
  if (flow.kind === "start" || flow.kind === "action" || flow.kind === "decision" || flow.kind === "end") {
    return flow.kind;
  }
  return "action";
}

function willBeSeenLater(doc: MarkdownMetaDocument, targetId: string, currentLine: number): boolean {
  return doc.nodes.some((n) => {
    const f = n.namespaces.flow;
    return f?.id === targetId && n.line > currentLine;
  });
}

function findNextFlowNode(doc: MarkdownMetaDocument, currentLine: number): string | undefined {
  // 找到当前行之后最近的有 flow.id 的节点
  let nearest: NodeMeta | undefined;
  let nearestDist = Infinity;

  for (const node of doc.nodes) {
    const flow = node.namespaces.flow;
    if (!flow?.id || node.line <= currentLine) {
      continue;
    }
    const dist = node.line - currentLine;
    if (dist < nearestDist) {
      nearestDist = dist;
      nearest = node;
    }
  }

  return nearest?.namespaces.flow?.id;
}

function collectPromptoItems(doc: MarkdownMetaDocument, node: NodeMeta): FlowNodePrompto[] | undefined {
  const items: FlowNodePrompto[] = [];

  // 主 prompto（节点级）
  const nodePrompto = node.namespaces.prompto;
  if (nodePrompto && (nodePrompto.prompt || nodePrompto.promptContent)) {
    items.push({
      title: node.title,
      line: node.line,
      isAction: false,
      prompt: nodePrompto.prompt,
      promptContent: nodePrompto.promptContent,
      deliveryTarget: nodePrompto.deliveryTarget,
      outputMode: nodePrompto.outputMode,
    });
  }

  // 收集归属此节点的 actions（行号在本 heading 到下一个同级/更高级 heading 之间）
  let rangeEnd = Infinity;
  for (const other of doc.nodes) {
    if (other.line <= node.line) continue;
    if (other.level <= node.level) {
      rangeEnd = other.line;
      break;
    }
  }

  for (const action of doc.actions) {
    if (action.line > node.line && action.line < rangeEnd) {
      const actionPrompto = action.namespaces.prompto;
      if (actionPrompto) {
        items.push({
          title: actionPrompto.title || "Action",
          line: action.line,
          isAction: true,
          prompt: actionPrompto.prompt,
          promptContent: actionPrompto.promptContent,
          deliveryTarget: actionPrompto.deliveryTarget,
          outputMode: actionPrompto.outputMode,
        });
      }
    }
  }

  return items.length > 0 ? items : undefined;
}

function hasNodeBody(lines: string[] | undefined, node: NodeMeta): boolean {
  if (!lines) {
    return false;
  }
  return extractNodeBody(lines, node).length > 0;
}

function buildNodeBodyPreview(lines: string[] | undefined, node: NodeMeta): string | undefined {
  if (!lines) {
    return undefined;
  }
  const body = extractNodeBody(lines, node);
  if (!body) {
    return undefined;
  }

  const bodyLines = body.split("\n");
  const maxLines = 8;
  if (bodyLines.length <= maxLines) {
    return body;
  }

  return bodyLines.slice(0, maxLines).join("\n") + "\n...";
}

function extractNodeBody(lines: string[], node: NodeMeta): string {
  const bodyLines: string[] = [];
  let i = node.line + 1;

  const MD_META_START = /^\s*<!--\s*md-meta(?:\s*-->)?\s*$/;
  const COMMENT_END = /^\s*-->\s*$/;

  while (i < lines.length && !lines[i].trim()) {
    i++;
  }

  if (i < lines.length && /^\s*<!--/.test(lines[i])) {
    while (i < lines.length && !/^\s*-->/.test(lines[i])) {
      i++;
    }
    if (i < lines.length) {
      i++;
    }
  }

  while (i < lines.length && !lines[i].trim()) {
    i++;
  }

  for (; i < lines.length; i++) {
    const line = lines[i];
    const nextHeading = line.match(/^(#{1,6})\s+/);
    if (nextHeading && nextHeading[1].length <= node.level) {
      break;
    }

    // 过滤正文中的所有 md-meta 块（不仅是第一个）
    if (MD_META_START.test(line)) {
      while (i < lines.length && !COMMENT_END.test(lines[i])) {
        i++;
      }
      continue;
    }

    bodyLines.push(line);
  }

  return bodyLines.join("\n").trim();
}
