import { DESKTOP_INPUT_BYTE_LIMIT, DesktopDeliveryResult, normalizeText, record } from "./DesktopDriver";
import { LingxiCdpConnection, LingxiDeliveryError, LINGXI_TASK_NAVIGATION, LINGXI_TASK_SUBMISSION, LINGXI_EDITOR_SELECTION } from "./LingxiCdpConnection";

export interface LingxiDeliveryEvent {
  event: string;
  stage: string;
  command?: string;
  elapsedMs?: number;
  inputAttempted: boolean;
  navigationAttempted: boolean;
  submitAttempted: boolean;
}

export interface LingxiDeliveryRequest {
  content: string;
  project: string;
  title: string;
  submit?: boolean;
  connect(): Promise<LingxiCdpConnection>;
  onEvent?(event: LingxiDeliveryEvent): void;
}

function fail(code: string, message: string): never { throw new LingxiDeliveryError(code, message); }
function nodeAttributes(node: Record<string, unknown>): Record<string, string> {
  const values = node.attributes;
  if (!Array.isArray(values) || values.length % 2 || values.some(value => typeof value !== "string")) return {};
  return Object.fromEntries(Array.from({ length: values.length / 2 }, (_, index) => [values[index * 2], values[index * 2 + 1]]));
}
function children(node: Record<string, unknown>): Record<string, unknown>[] { return Array.isArray(node.children) ? node.children.map(record) : []; }
function inlineText(node: Record<string, unknown>): string {
  if (node.nodeName === "BR") return "\n";
  if (node.nodeType === 3) return typeof node.nodeValue === "string" ? node.nodeValue : "";
  return children(node).map(inlineText).join("");
}
export function lingxiDraftText(node: Record<string, unknown>): string {
  const paragraphs = children(node);
  if (paragraphs.length && paragraphs.every(child => child.nodeName === "P")) {
    return paragraphs.map(paragraph => {
      const value = inlineText(paragraph);
      const nested = children(paragraph);
      return nested[nested.length - 1]?.nodeName === "BR" ? value.replace(/\n$/, "") : value;
    }).join("\n");
  }
  return inlineText(node);
}

export async function deliverLingxiChat(request: LingxiDeliveryRequest): Promise<DesktopDeliveryResult> {
  let connection: LingxiCdpConnection | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let inputAttempted = false;
  let navigationAttempted = false;
  let submitAttempted = false;
  let stage = "准备灵犀预填";
  const emit = (event: string, command?: string, elapsedMs?: number) => {
    try { request.onEvent?.({ event, stage, command, elapsedMs, inputAttempted, navigationAttempted, submitAttempted }); } catch {}
  };
  const progress = (value: string) => { stage = value; emit("stage"); };
  try {
    if (!request.content.trim() || Buffer.byteLength(request.content, "utf8") > DESKTOP_INPUT_BYTE_LIMIT) fail("invalid_content", "灵犀内容为空或超过 10000 UTF-8 字节，不拆分投放。");
    if (![request.project, request.title].every(value => typeof value === "string" && value.trim() && !/[\u0000-\u001f\u007f{}]/.test(value))) fail("invalid_session", "灵犀需要非空、单行字面量项目名和任务名。");
    progress("连接灵犀 CDP");
    connection = await request.connect();
    const client = connection;
    deadline = setTimeout(() => client.close(), 60000);
    const command = async (method: string, params: Record<string, unknown> = {}) => {
      if (method === "Input.insertText") inputAttempted = true;
      if (method === "Runtime.callFunctionOn" && params.functionDeclaration === LINGXI_TASK_NAVIGATION) navigationAttempted = true;
      if (method === "Runtime.callFunctionOn" && params.functionDeclaration === LINGXI_TASK_SUBMISSION) submitAttempted = true;
      const started = Date.now();
      emit("command.start", method);
      try { const result = await client.command(method, params); emit("command.end", method, Date.now() - started); return result; }
      catch (error) { emit("command.error", method, Date.now() - started); throw error; }
    };
    const all = async (nodeId: number, selector: string): Promise<number[]> => {
      const ids = (await command("DOM.querySelectorAll", { nodeId, selector })).nodeIds;
      if (!Array.isArray(ids) || ids.some(value => !Number.isInteger(value) || value <= 0)) fail("invalid_dom", "灵犀 DOM 观察不完整。");
      return ids as number[];
    };
    const read = async (nodeId: number, depth = 0) => {
      const node = record((await command("DOM.describeNode", { nodeId, depth })).node);
      if (typeof node.nodeName !== "string") fail("invalid_dom", "灵犀 DOM 节点不可核验。");
      return node;
    };
    const root = async () => {
      const document = record((await command("DOM.getDocument", { depth: 0 })).root);
      if (!Number.isInteger(document.nodeId) || Number(document.nodeId) <= 0) fail("invalid_dom", "灵犀文档不可核验。");
      const roots = await all(Number(document.nodeId), "#copilot__root");
      if (roots.length !== 1) fail("invalid_dom", "灵犀内容根节点不唯一。");
      return roots[0];
    };
    const literal = async (nodeId: number) => inlineText(await read(nodeId, -1)).trim();
    const locate = async () => {
      const rootId = await root();
      const projects: number[] = [];
      for (const entry of await all(rootId, ".claw-aside .project-entry")) {
        const labels = await all(entry, ".project-item__name");
        if (labels.length === 1 && await literal(labels[0]) === request.project.trim()) projects.push(entry);
      }
      if (projects.length !== 1) fail("project_not_unique", "目标灵犀项目未加载或不唯一，请先展开正确项目。");
      const tasks: number[] = [];
      for (const button of await all(projects[0], "button.project-session")) {
        const labels = await all(button, ".project-session__title");
        if (labels.length === 1 && await literal(labels[0]) === request.title.trim()) tasks.push(button);
      }
      if (tasks.length !== 1) fail("task_not_unique", "项目内目标任务未加载或不唯一，请先展开项目并核对完整标题。");
      const attributes = nodeAttributes(await read(tasks[0]));
      if (attributes.disabled !== undefined || attributes["aria-disabled"] === "true") fail("task_unavailable", "目标灵犀任务不可访问。");
      return { rootId, taskId: tasks[0], active: (attributes.class ?? "").split(/\s+/).includes("project-session--active") };
    };
    const editor = async (rootId: number) => {
      const ids = await all(rootId, '[contenteditable="true"][data-lexical-editor="true"]');
      if (ids.length !== 1) fail("editor_not_unique", "灵犀编辑器缺失或不唯一。");
      const node = await read(ids[0], -1);
      const attributes = nodeAttributes(node);
      if (!Number.isInteger(node.backendNodeId) || Number(node.backendNodeId) <= 0) fail("editor_unavailable", "灵犀编辑器稳定身份不可核验。");
      if (attributes.contenteditable !== "true" || attributes["data-lexical-editor"] !== "true" || attributes["aria-disabled"] === "true" || attributes["aria-readonly"] === "true") fail("editor_unavailable", "灵犀编辑器不可编辑。");
      const value = lingxiDraftText(node);
      const model = record((await command("DOM.getBoxModel", { nodeId: ids[0] })).model);
      if (!(Number(model.width) > 0 && Number(model.height) > 0)) fail("editor_unavailable", "灵犀编辑器未渲染。");
      return { id: ids[0], backendId: Number(node.backendNodeId), value };
    };
    const controls = async (rootId: number, requireEnabled: boolean) => {
      const composers = await all(rootId, ".voice-send-actions");
      if (composers.length !== 1) fail("unknown_state", "灵犀输入区状态不可识别，已停止。");
      const senders: { id: number; enabled: boolean; label: string }[] = [];
      for (const button of await all(composers[0], "button,[role=button]")) {
        const attributes = nodeAttributes(await read(button, -1));
        const classes = (attributes.class ?? "").split(/\s+/);
        const label = [attributes["aria-label"], attributes.title].filter(Boolean).join(" ");
        const disabled = attributes.disabled !== undefined || attributes["aria-disabled"] === "true";
        if (classes.includes("voice-send-btn--stop") || /停止|取消|中止|\bstop\b|\bcancel\b/i.test(label)) {
          fail(disabled ? "unknown_state" : "task_generating", disabled ? "灵犀停止控件处于过渡状态，已停止。" : "灵犀任务正在生成回复，拒绝投放。");
        }
        if (classes.includes("voice-send-btn--voice")) continue;
        if (!classes.includes("voice-send-btn") || !/发送|\bsend\b/i.test(label)) fail("unknown_state", "灵犀输入控件处于未知状态，已停止。");
        const model = record((await command("DOM.getBoxModel", { nodeId: button })).model);
        if (!(Number(model.width) > 0 && Number(model.height) > 0)) fail("unknown_state", "灵犀发送控件未渲染。");
        senders.push({ id: button, enabled: !disabled, label });
      }
      if (senders.length !== 1) fail("unknown_state", "灵犀发送控件缺失或不唯一。");
      if (requireEnabled && !senders[0].enabled) fail("receipt_unverified", "灵犀尚未识别预填草稿。");
      if (!requireEnabled && !senders[0].enabled && !senders[0].label.includes("暂不可发送")) fail("unknown_state", "灵犀可能仍在请求或状态切换中，已停止。");
      return senders[0].id;
    };
    const userMessages = async (rootId: number) => {
      const lists = await all(rootId, ".message__list");
      if (lists.length !== 1) fail("receipt_unverified", "灵犀消息列表不可独立核验。");
      const messages = new Map<string, number>();
      for (const id of await all(lists[0], ".message-item--user .claw-user-message")) {
        const group = nodeAttributes(await read(id))["data-groupid"];
        if (!group || messages.has(group)) fail("receipt_unverified", "灵犀用户消息身份缺失或重复。");
        messages.set(group, id);
      }
      return messages;
    };
    progress("定位项目和任务");
    let target = await locate();
    if (!target.active) {
      const existingEditors = await all(target.rootId, '[contenteditable="true"][data-lexical-editor="true"]');
      if (existingEditors.length) { await editor(target.rootId); await controls(target.rootId, false); }
      progress("导航到指定灵犀任务");
      const object = record((await command("DOM.resolveNode", { nodeId: target.taskId })).object);
      const result = await command("Runtime.callFunctionOn", { objectId: object.objectId, functionDeclaration: LINGXI_TASK_NAVIGATION, arguments: [{ value: request.project.trim() }, { value: request.title.trim() }], returnByValue: true });
      if (result.exceptionDetails) fail("navigation_unverified", "灵犀任务导航未确认，未输入；不会自动再点击。");
      target = await locate();
    }
    if (!target.active) fail("navigation_unverified", "目标灵犀任务未激活，未输入。");
    const boundPage = await client.page();
    if (!/^\/_desktop\/lingxi\/chat\/[0-9]+$/.test(new URL(boundPage.url).pathname)) fail("wrong_task", "当前灵犀页面不是已核验任务。");
    const fresh = async (requireEnabled = false) => {
      const page = await client.page();
      if (page.id !== boundPage.id || page.url !== boundPage.url) fail("wrong_task", "灵犀任务路由已变化，已停止。");
      const current = await locate();
      if (!current.active) fail("wrong_task", "灵犀项目或激活任务已变化，已停止。");
      const field = await editor(current.rootId);
      const sendId = await controls(current.rootId, requireEnabled);
      return { ...field, rootId: current.rootId, sendId };
    };
    progress("检查草稿和生成控件");
    const field = await fresh();
    const baseline = request.submit ? await userMessages(field.rootId) : undefined;
    progress("重新核验任务和输入焦点");
    await command("DOM.focus", { nodeId: field.id });
    const focused = await fresh();
    if (focused.backendId !== field.backendId) fail("editor_changed", "灵犀编辑器身份已变化。");
    const object = record((await command("DOM.resolveNode", { nodeId: focused.id })).object);
    const focus = await command("Runtime.callFunctionOn", { objectId: object.objectId, functionDeclaration: "function() { return this.ownerDocument.activeElement === this; }", throwOnSideEffect: true, returnByValue: true });
    if (focus.exceptionDetails || record(focus.result).value !== true) fail("focus_unverified", "灵犀输入焦点无法核验，未输入。");
    if (focused.value !== "") {
      progress("全选灵犀旧草稿");
      const selected = await command("Runtime.callFunctionOn", { objectId: object.objectId, functionDeclaration: LINGXI_EDITOR_SELECTION, arguments: [{ value: request.project.trim() }, { value: request.title.trim() }, { value: boundPage.url }, { value: normalizeText(focused.value) }], returnByValue: true });
      if (selected.exceptionDetails || record(selected.result).value !== true) fail("selection_unverified", "灵犀旧草稿全选未确认，未覆盖。");
      const current = await fresh();
      if (current.backendId !== field.backendId || normalizeText(current.value) !== normalizeText(focused.value)) fail("editor_changed", "灵犀全选后编辑器或旧草稿已变化，未覆盖。");
      const selectedObject = record((await command("DOM.resolveNode", { nodeId: current.id })).object);
      const selection = await command("Runtime.callFunctionOn", { objectId: selectedObject.objectId, functionDeclaration: "function() { const selection = this.ownerDocument.getSelection(); return this.ownerDocument.activeElement === this && selection && selection.rangeCount === 1 && selection.anchorNode === this && selection.anchorOffset === 0 && selection.focusNode === this && selection.focusOffset === this.childNodes.length; }", throwOnSideEffect: true, returnByValue: true });
      if (selection.exceptionDetails || record(selection.result).value !== true) fail("selection_unverified", "灵犀完整草稿选区或焦点已变化，未覆盖。");
    }
    progress("单次预填灵犀");
    await command("Input.insertText", { text: normalizeText(request.content) });
    progress("独立核验灵犀草稿");
    const receipt = await fresh(true);
    if (receipt.backendId !== field.backendId || normalizeText(receipt.value) !== normalizeText(request.content)) fail("receipt_unverified", "灵犀草稿与预期不一致，请人工检查，不会自动重填。");
    if (request.submit && baseline) {
      progress("核验灵犀发送前状态");
      const ready = await fresh(true);
      if (ready.backendId !== field.backendId || normalizeText(ready.value) !== normalizeText(request.content)) fail("receipt_unverified", "灵犀发送前草稿已变化，已停止。");
      const currentMessages = await userMessages(ready.rootId);
      if (currentMessages.size !== baseline.size || [...baseline.keys()].some(id => !currentMessages.has(id))) fail("receipt_unverified", "灵犀消息历史已变化，已停止发送。");
      const sender = record((await command("DOM.resolveNode", { nodeId: ready.sendId })).object);
      progress("单次发送灵犀");
      const sent = await command("Runtime.callFunctionOn", { objectId: sender.objectId, functionDeclaration: LINGXI_TASK_SUBMISSION, arguments: [{ value: request.project.trim() }, { value: request.title.trim() }, { value: boundPage.url }, { value: normalizeText(request.content) }], returnByValue: true });
      if (sent.exceptionDetails) fail("receipt_unverified", "灵犀发送未完成确认，可能已发送。");
      progress("独立核验灵犀发送回执");
      for (let observation = 0; observation < 3; observation++) {
        const page = await client.page();
        if (page.id !== boundPage.id || page.url !== boundPage.url) fail("wrong_task", "灵犀发送后任务路由已变化。");
        const current = await locate();
        if (!current.active) fail("wrong_task", "灵犀发送后激活任务已变化。");
        const draft = await editor(current.rootId);
        const messages = await userMessages(current.rootId);
        const added = [...messages.keys()].filter(id => !baseline.has(id));
        if ([...baseline.keys()].some(id => !messages.has(id)) || added.length > 1) fail("receipt_unverified", "灵犀用户消息回执存在歧义。");
        if (added.length === 1) {
          const values = await all(messages.get(added[0])!, ".item__value");
          if (values.length !== 1 || normalizeText(inlineText(await read(values[0], -1))) !== normalizeText(request.content)) fail("receipt_unverified", "灵犀新增用户消息正文未匹配。");
          const finalPage = await client.page();
          if (draft.value === "" && finalPage.id === boundPage.id && finalPage.url === boundPage.url) return { status: "verified", detail: "已发送至灵犀指定项目任务，并核验新增用户消息及空输入框。" };
        }
      }
      fail("receipt_unverified", "灵犀未观察到完整发送回执，可能已发送，请人工检查。");
    }
    return { status: "verified", detail: "已精确预填灵犀指定项目任务，未发送。" };
  } catch (error) {
    const reason = error instanceof LingxiDeliveryError ? error.message : "灵犀投放异常，请人工检查。";
    return { status: inputAttempted || submitAttempted ? "uncertain" : "notDelivered", detail: `${stage}：${reason}${submitAttempted ? " 可能已发送，不会自动重发或复制降级。" : inputAttempted ? " 可能已有草稿，不会自动重试或复制降级。" : " 未输入或发送，不会自动重试。"}` };
  } finally {
    if (deadline) clearTimeout(deadline);
    try { connection?.close(); } catch {}
  }
}