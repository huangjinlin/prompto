/**
 * Flow 提取服务
 * 从 MarkdownMetaDocument 中提取 flow 命名空间，构建稳定图模型
 */

import { parseMarkdownMetaDocument } from "./MarkdownMetaParserService";
import type { MarkdownMetaDocument, NodeMeta, FlowMeta } from "../models/MarkdownMeta";

// ── 图模型类型 ──

export type FlowNodeKind = "start" | "action" | "decision" | "end";

export interface FlowNode {
  id: string;
  title: string;
  kind: FlowNodeKind;
  line: number;
  group?: string;
}

export interface FlowEdge {
  from: string;
  to: string;
  label?: string;
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
  return buildFlowGraph(doc);
}

export function buildFlowGraph(doc: MarkdownMetaDocument): FlowGraph {
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
      for (const branch of flow.branches) {
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
