import { isScalar, parseDocument, Scalar, stringify } from "yaml";

export type PromptQueueStatus = "await" | "doing" | "done";
export type PromptQueueOutputMode = "chatPrefill" | "chatSubmit" | "clipboard";

export interface PromptQueueItem {
  readonly id: string;
  readonly prompt: string;
  readonly section: string;
  readonly context: string;
  readonly outputMode?: PromptQueueOutputMode;
  readonly status: PromptQueueStatus;
}

export interface PromptQueue {
  readonly items: readonly PromptQueueItem[];
  readonly outputMode: PromptQueueOutputMode;
}

function mapping(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a mapping.`);
  }
  return value as Record<string, unknown>;
}

function allowedKeys(value: Record<string, unknown>, keys: string[], label: string): void {
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) throw new Error(`Unknown ${label} field: ${key}.`);
  }
}

function literal(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${label} must be a non-empty single-line string without surrounding whitespace.`);
  }
  return value;
}

function queueStatus(value: unknown): PromptQueueStatus {
  if (value !== "await" && value !== "doing" && value !== "done") {
    throw new Error("Queue status must be await, doing or done.");
  }
  return value;
}

function queueOutputMode(value: unknown, label: string): PromptQueueOutputMode {
  if (value !== "chatPrefill" && value !== "chatSubmit" && value !== "clipboard") {
    throw new Error(`${label} outputMode must be chatPrefill, chatSubmit or clipboard.`);
  }
  return value;
}

function parseQueueDocument(source: string) {
  const document = parseDocument(source, { uniqueKeys: true, strict: true });
  const problems = [...document.errors, ...document.warnings];
  if (problems.length) throw new Error(`Invalid queue YAML: ${problems[0].message}`);
  const root = mapping(document.toJS({ maxAliasCount: 0 }), "Queue");
  allowedKeys(root, ["items", "outputMode"], "queue");
  if (!Array.isArray(root.items)) throw new Error("Queue items must be a list.");
  const outputMode = root.outputMode === undefined ? "chatPrefill" : queueOutputMode(root.outputMode, "Queue");
  const ids = new Set<string>();
  const items: PromptQueueItem[] = root.items.map((value, index) => {
    const label = `Queue item ${index + 1}`;
    const item = mapping(value, label);
    allowedKeys(item, ["id", "prompt", "section", "context", "outputMode", "status"], label);
    const id = literal(item.id, `${label} id`);
    if (ids.has(id)) throw new Error(`Duplicate queue item id: ${id}.`);
    ids.add(id);
    return {
      id,
      prompt: literal(item.prompt, `${label} prompt`),
      section: literal(item.section, `${label} section`),
      context: literal(item.context, `${label} context`),
      ...(item.outputMode === undefined ? {} : { outputMode: queueOutputMode(item.outputMode, label) }),
      status: queueStatus(item.status),
    };
  });
  if (items.filter(item => item.status === "doing").length > 1) {
    throw new Error("Only one queue item may have status doing.");
  }
  const queue: PromptQueue = { items, outputMode };
  return { document, queue };
}

export function parsePromptQueue(source: string): PromptQueue {
  return parseQueueDocument(source).queue;
}

export function changePromptQueueStatus(source: string, id: string, status: PromptQueueStatus): string {
  queueStatus(status);
  const { document, queue } = parseQueueDocument(source);
  const index = queue.items.findIndex(item => item.id === id);
  if (index < 0) throw new Error(`Queue item not found: ${id}.`);
  if (queue.items[index].status === status) return source;
  const scalar = document.getIn(["items", index, "status"], true);
  if (!isScalar(scalar) || !scalar.range) throw new Error("Queue status source location is unavailable.");
  const style = scalar.type === Scalar.QUOTE_DOUBLE || scalar.type === Scalar.QUOTE_SINGLE
    ? scalar.type : Scalar.PLAIN;
  const replacement = stringify(status, { defaultStringType: style }).trimEnd();
  const updated = source.slice(0, scalar.range[0]) + replacement + source.slice(scalar.range[1]);
  parsePromptQueue(updated);
  return updated;
}