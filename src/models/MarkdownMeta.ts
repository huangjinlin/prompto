// 统一 Markdown 元信息归一化模型 v1
// 与 python/markdown_meta.py 字段对齐

// ── 作用域 ──

export type MetaScope = "document" | "node" | "action";

// ── 标准命名空间类型 ──

export interface PromptoMeta {
  prompt?: string;
  promptContent?: string;
  deliveryTarget?: string;
  outputMode?: string;
  title?: string;
  _resolved?: PromptoConflictResolution;
}

export interface PromptoConflictResolution {
  conflict: string;
  chosen: string;
}

export interface FlowBranch {
  label: string;
  to: string;
}

export interface FlowMeta {
  id?: string;
  title?: string;
  direction?: string;
  entry?: string;
  kind?: string;
  next?: string;
  group?: string;
  branches?: FlowBranch[];
}

export interface OutlineMeta {
  status?: string | null;
}

// ── 命名空间容器 ──

export interface NamespaceBag {
  prompto?: PromptoMeta;
  flow?: FlowMeta;
  outline?: OutlineMeta;
  custom?: Record<string, unknown>;
}

// ── 文档级结构 ──

export interface DocumentMeta {
  defaults: NamespaceBag;
  namespaces: NamespaceBag;
}

// ── 节点级结构 ──

export interface NodeMeta {
  title: string;
  level: number;
  line: number;
  scope: "node";
  namespaces: NamespaceBag;
}

// ── 动作级结构 ──

export interface ActionMeta {
  line: number;
  scope: "action";
  namespaces: NamespaceBag;
}

// ── 顶层文档结构 ──

export interface MarkdownMetaDocument {
  version: number;
  document: DocumentMeta;
  nodes: NodeMeta[];
  actions: ActionMeta[];
}
