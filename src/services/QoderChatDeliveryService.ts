import { DesktopDeliveryResult, normalizeText, record } from "./DesktopDriver";
import { QoderCdpConnection, QoderDeliveryError, qoderInputPlan, qoderKeyPair, QODER_READ_NAME, QODER_READ_STATE, QODER_READ_SELECTION, QODER_TASK_NAVIGATION, QODER_TASK_SUBMISSION } from "./QoderCdpConnection";

export interface QoderDeliveryEvent {
  event: string;
  stage: string;
  command?: string;
  elapsedMs?: number;
  inputAttempted: boolean;
  navigationAttempted: boolean;
  submitAttempted: boolean;
}

export interface QoderDeliveryRequest {
  content: string;
  workspace: string;
  title: string;
  submit?: boolean;
  connect(): Promise<QoderCdpConnection>;
  onEvent?(event: QoderDeliveryEvent): void;
}

function fail(code: string, detail: string): never { throw new QoderDeliveryError(code, detail); }
function children(node: Record<string, unknown>): Record<string, unknown>[] { return Array.isArray(node.children) ? node.children.map(record) : []; }
function attributes(node: Record<string, unknown>): Record<string, string> {
  const values = node.attributes;
  if (!Array.isArray(values) || values.length % 2 || values.some(value => typeof value !== "string")) return {};
  return Object.fromEntries(Array.from({ length: values.length / 2 }, (_, index) => [values[index * 2], values[index * 2 + 1]]));
}
function descendants(node: Record<string, unknown>): Record<string, unknown>[] { return [node, ...children(node).flatMap(descendants)]; }
function nodeText(node: Record<string, unknown>): string { return node.nodeType === 3 ? String(node.nodeValue ?? "") : node.nodeName === "BR" ? "\n" : children(node).map(nodeText).join(""); }
function has(node: Record<string, unknown>, key: string): boolean { return Object.prototype.hasOwnProperty.call(attributes(node), key); }

export function qoderEditorContent(editor: Record<string, unknown>): { text: string; raw: string; decorated: boolean } {
  let decorated = false;
  const read = (node: Record<string, unknown>): string => {
    if (node.nodeType === 3) return String(node.nodeValue ?? "");
    const values = attributes(node);
    if (node.nodeName === "SPAN" && values["data-editor-offset-ignored"] === "true" && values["aria-hidden"] === "true" && (values["data-editor-link-start-caret"] === "true" || values["data-editor-link-favicon"] === "true")) { decorated = true; return ""; }
    if (node.nodeName === "A" && values["data-editor-link"] === "true") decorated = true;
    if (node.nodeName === "BR") { decorated = true; return "\n"; }
    return children(node).map(read).join("");
  };
  const text = read(editor);
  const raw = descendants(editor).filter(node => node.nodeType === 3).map(node => String(node.nodeValue ?? "")).join("");
  return { text, raw, decorated };
}

export function qoderDraftMatches(actual: string, expected: string): boolean {
  const value = normalizeText(actual);
  return value === expected || value === "\u200B" + expected || value === expected + "\u200B";
}

export function findQoderTask(sidebar: Record<string, unknown>, workspace: string, title: string): { backendId: number; sessionId: string; href: string; active: boolean } {
  const all = descendants(sidebar);
  const names = all.filter(node => has(node, "data-work-directory-name") && nodeText(node).trim() === workspace);
  if (names.length !== 1) fail("workspace_not_unique", "Qoder 工作区未加载或名称不唯一，请展开正确工作区。");
  const path: Record<string, unknown>[] = [];
  const visit = (node: Record<string, unknown>): boolean => {
    path.push(node);
    if (node === names[0] || children(node).some(visit)) return true;
    path.pop();
    return false;
  };
  visit(sidebar);
  let rows: Record<string, unknown>[] = [];
  for (const ancestor of path.slice(1).reverse()) {
    const nested = descendants(ancestor);
    if (nested.filter(node => has(node, "data-work-directory-name")).length !== 1) break;
    const candidates = nested.filter(node => attributes(node)["data-sidebar-session"] === "work-directory");
    if (candidates.length) { rows = candidates; break; }
  }
  const matches = rows.flatMap(row => descendants(row).filter(link => link.nodeName === "A" && has(link, "data-sidebar-session-link") && descendants(link).some(label => label.nodeName === "SPAN" && nodeText(label).trim() === title)).map(link => ({ row, link })));
  if (matches.length !== 1) fail("task_not_unique", "Qoder 工作区内任务未加载或标题不唯一，请展开任务列表并核对完整标题。");
  const { row, link } = matches[0];
  const values = attributes(row);
  const sessionId = values["data-session-id"];
  const href = attributes(link).href;
  if (!sessionId || !/^[A-Za-z0-9_-]+$/.test(sessionId) || !href || !Number.isInteger(link.backendNodeId) || Number(link.backendNodeId) <= 0) fail("task_identity_missing", "Qoder 任务稳定身份或链接不可核验。");
  const active = values["data-active"] === "true";
  if (active && all.some(node => attributes(node)["data-active"] === "true" && has(node, "data-sidebar-session") && attributes(node)["data-session-id"] !== sessionId)) fail("task_ambiguous", "Qoder 激活任务身份存在歧义。");
  return { backendId: Number(link.backendNodeId), sessionId, href, active };
}

export async function deliverQoderChat(request: QoderDeliveryRequest): Promise<DesktopDeliveryResult> {
  let client: QoderCdpConnection | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let inputAttempted = false;
  let navigationAttempted = false;
  let submitAttempted = false;
  let stage = "准备 Qoder CDP 投放";
  const emit = (event: string, command?: string, elapsedMs?: number) => {
    try { request.onEvent?.({ event, stage, command, elapsedMs, inputAttempted, navigationAttempted, submitAttempted }); } catch {}
  };
  const progress = (value: string) => { stage = value; emit("stage"); };
  try {
    qoderInputPlan(request.content);
    if (![request.workspace, request.title].every(value => typeof value === "string" && value.trim() && !/[\u0000-\u001f\u007f{}]/.test(value))) fail("invalid_session", "Qoder 需要非空、单行字面量工作区名和任务名。");
    const expectedContent = normalizeText(request.content);
    progress("连接 Qoder CDP");
    client = await request.connect();
    const connection = client;
    deadline = setTimeout(() => connection.close(), 120000);
    const command = async (method: string, params: Record<string, unknown> = {}) => {
      if (method.startsWith("Input.")) inputAttempted = true;
      if (params.functionDeclaration === QODER_TASK_NAVIGATION) navigationAttempted = true;
      if (params.functionDeclaration === QODER_TASK_SUBMISSION) submitAttempted = true;
      const started = Date.now();
      emit("command.start", method);
      try { const result = await connection.command(method, params); emit("command.end", method, Date.now() - started); return result; }
      catch (error) { emit("command.error", method, Date.now() - started); throw error; }
    };
    const all = async (nodeId: number, selector: string): Promise<number[]> => {
      const ids = (await command("DOM.querySelectorAll", { nodeId, selector })).nodeIds;
      if (!Array.isArray(ids) || ids.some(id => !Number.isInteger(id) || id <= 0)) fail("invalid_dom", "Qoder DOM 观察不完整。");
      return ids as number[];
    };
    const unique = (ids: number[], detail: string) => { if (ids.length !== 1) fail("invalid_dom", detail); return ids[0]; };
    const readNode = async (nodeId: number, depth = 0) => record((await command("DOM.describeNode", { nodeId, depth })).node);
    const visible = async (nodeId: number) => {
      try { const model = record((await command("DOM.getBoxModel", { nodeId })).model); return Number(model.width) > 0 && Number(model.height) > 0; }
      catch (error) { if (error instanceof QoderDeliveryError && error.code === "protocol_failure") return false; throw error; }
    };
    const protectedRead = async (nodeId: number, declaration: string, values: unknown[] = []) => {
      const object = record((await command("DOM.resolveNode", { nodeId })).object);
      const response = await command("Runtime.callFunctionOn", { objectId: object.objectId, functionDeclaration: declaration, arguments: values.map(value => ({ value })), throwOnSideEffect: true, returnByValue: true, silent: true });
      if (response.exceptionDetails || !Object.prototype.hasOwnProperty.call(record(response.result), "value")) fail("protected_read_rejected", "Qoder 受保护读取失败，未放宽读取限制。");
      return record(response.result).value;
    };
    const nodeIdFor = async (backendId: number) => unique((await command("DOM.pushNodesByBackendIdsToFrontend", { backendNodeIds: [backendId] })).nodeIds as number[] ?? [], "Qoder 节点稳定身份无法解析。");
    let documentRootId: number | undefined;
    const locate = async (refreshDocument = true) => {
      if (refreshDocument || documentRootId === undefined) {
        const root = record((await command("DOM.getDocument", { depth: 1 })).root);
        if (!Number.isInteger(root.nodeId) || Number(root.nodeId) <= 0) fail("invalid_dom", "Qoder 文档不可核验。");
        documentRootId = Number(root.nodeId);
      }
      const rootId = documentRootId;
      const sidebarId = unique(await all(rootId, ".loop-chrome-sidebar"), "Qoder 侧栏缺失或不唯一。");
      const task = findQoderTask(await readNode(sidebarId, -1), request.workspace.trim(), request.title.trim());
      const linkId = await nodeIdFor(task.backendId);
      if (!await visible(linkId)) fail("task_unavailable", "Qoder 目标任务链接不可见，请先展开工作区。");
      return { rootId, linkId, task };
    };
    let target = await locate();
    const boundSession = target.task.sessionId;
    if (!target.task.active) {
      progress("切换 Qoder 目标任务");
      const object = record((await command("DOM.resolveNode", { nodeId: target.linkId })).object);
      const navigated = await command("Runtime.callFunctionOn", { objectId: object.objectId, functionDeclaration: QODER_TASK_NAVIGATION,
        arguments: [boundSession, request.title.trim(), target.task.href].map(value => ({ value })), returnByValue: true });
      if (navigated.exceptionDetails) fail("navigation_unverified", "Qoder 任务切换未确认，不会再次点击。");
      for (let observation = 0; observation < 3; observation++) { target = await locate(); if (target.task.active) break; }
    }
    if (!target.task.active || target.task.sessionId !== boundSession) fail("wrong_task", "Qoder 目标任务尚未激活，未输入。");
    const boundPage = await connection.page();
    const inspect = async (allowGenerating = false, fullIdentity = true) => {
      const page = await connection.page(fullIdentity);
      if (page.id !== boundPage.id || page.url !== boundPage.url) fail("wrong_task", "Qoder 任务路由已变化，已停止。");
      const current = await locate(fullIdentity);
      if (!current.task.active || current.task.sessionId !== boundSession) fail("wrong_task", "Qoder 工作区或激活任务身份已变化。");
      const headings: number[] = [];
      for (const id of await all(current.rootId, "h1")) if (await visible(id)) headings.push(id);
      if (headings.length !== 1 || await protectedRead(headings[0], QODER_READ_NAME, [request.title.trim()]) !== true) fail("wrong_task", "Qoder 当前会话标题无法独立核验。");
      const composerId = unique(await all(current.rootId, '[class~="group/chat-composer"]'), "Qoder 输入区域缺失或不唯一。");
      const editorId = unique(await all(current.rootId, '.loop-rich-editor[contenteditable="true"][role="textbox"]'), "Qoder 编辑器缺失或不唯一。");
      const scoped = await all(composerId, '.loop-rich-editor[contenteditable="true"][role="textbox"]');
      if (scoped.length !== 1 || scoped[0] !== editorId || !await visible(editorId)) fail("editor_unavailable", "Qoder 编辑器不属于当前输入区域或未渲染。");
      const editor = await readNode(editorId, -1);
      const values = attributes(editor);
      if (!Number.isInteger(editor.backendNodeId) || Number(editor.backendNodeId) <= 0 || values.disabled !== undefined || values.readonly !== undefined || values["aria-disabled"] === "true" || values["aria-readonly"] === "true") fail("editor_unavailable", "Qoder 编辑器不可编辑。");
      const state = record(await protectedRead(editorId, QODER_READ_STATE));
      if (state.connected !== true || typeof state.value !== "string" || typeof state.visibleValue !== "string") fail("editor_unavailable", "Qoder 草稿状态不可核验。");
      const logical = qoderEditorContent(editor);
      if (logical.raw !== state.value) fail("draft_changed", "Qoder 草稿在读取期间变化，已停止。");
      const senders: { id: number; enabled: boolean }[] = [];
      const buttons = await all(composerId, "button,[role=button]");
      if (buttons.length > 30) fail("unknown_state", "Qoder 输入区控件过多，已停止。");
      let generating = false;
      for (const id of buttons) {
        if (!await visible(id)) continue;
        const attrs = attributes(await readNode(id));
        const label = `${attrs["aria-label"] ?? ""} ${attrs.title ?? ""}`;
        if (/停止|取消|中止|\bstop\b|\bcancel\b/i.test(label)) generating = true;
        if (/发送|\bsend\b/i.test(label)) senders.push({ id, enabled: attrs.disabled === undefined && attrs["aria-disabled"] !== "true" });
      }
      if (generating && !allowGenerating) fail("task_generating", "Qoder 任务正在生成或处于过渡状态，拒绝投放。");
      if (!allowGenerating && senders.length !== 1) fail("unknown_state", "Qoder 发送控件缺失或不唯一。");
      return { ...current, editorId, backendId: Number(editor.backendNodeId), value: state.value as string, visibleValue: state.visibleValue as string, text: logical.text, decorated: logical.decorated, active: state.active === true,
        sendId: senders[0]?.id, sendEnabled: senders.length === 1 && senders[0].enabled };
    };
    const userMessages = async (rootId: number) => {
      const ids = await all(rootId, '[data-message-kind="user"][data-user-message][data-message-id]');
      if (ids.length > 1000) fail("receipt_unverified", "Qoder 用户消息列表过大，无法完整核验。");
      const messages = new Map<string, number>();
      for (const id of ids) {
        const messageId = attributes(await readNode(id))["data-message-id"];
        if (!messageId || messages.has(messageId)) fail("receipt_unverified", "Qoder 用户消息身份缺失或重复。");
        messages.set(messageId, id);
      }
      return messages;
    };
    progress("核验 Qoder 目标和旧草稿");
    const initial = await inspect(false, false);
    const baseline = request.submit ? await userMessages(initial.rootId) : undefined;
    const check = async (expected: string, mode: "inside" | "all" | "caret", allowGenerating = false, fullIdentity = false) => {
      const current = await inspect(allowGenerating, fullIdentity);
      if (current.backendId !== initial.backendId || !qoderDraftMatches(current.text, expected) || (!current.decorated && (!qoderDraftMatches(current.value, expected) || !qoderDraftMatches(current.visibleValue, expected))) || !current.active || mode === "inside" && (current.value !== initial.value || current.visibleValue !== initial.visibleValue)) fail("draft_unverified", "Qoder 草稿、焦点或编辑器已变化，请人工检查。");
      const selection = record(await protectedRead(current.editorId, QODER_READ_SELECTION));
      if (selection.active !== true || selection.inside !== true || mode === "all" && selection.coversAll !== true || mode === "caret" && (selection.collapsed !== true || expected !== "" && selection.atEnd !== true)) fail("selection_unverified", "Qoder 输入选区不安全，已停止。");
      if (expected === "" && !allowGenerating && current.sendEnabled) fail("draft_unverified", "Qoder 空草稿状态异常。");
      return current;
    };
    const oldDraft = normalizeText(initial.text);
    const focused = await inspect(false, false);
    if (focused.backendId !== initial.backendId || focused.value !== initial.value || focused.visibleValue !== initial.visibleValue || focused.text !== initial.text) fail("draft_changed", "Qoder 聚焦前旧草稿已变化。");
    progress("聚焦 Qoder 输入区");
    await command("DOM.focus", { nodeId: focused.editorId });
    const pair = async (actions: ReturnType<typeof qoderKeyPair>) => {
      try { await command(actions[0].method, actions[0].params); }
      finally { await command(actions[1].method, actions[1].params); }
    };
    await check(oldDraft, "inside");
    progress("全选并核验 Qoder 旧草稿");
    await pair(qoderKeyPair("a", "KeyA", 65, 2));
    const selected = await inspect();
    if (selected.backendId !== initial.backendId || selected.value !== initial.value || selected.visibleValue !== initial.visibleValue || selected.text !== initial.text || !selected.active) fail("draft_changed", "Qoder 全选后旧草稿已变化。");
    const selection = record(await protectedRead(selected.editorId, QODER_READ_SELECTION));
    const emptyDraft = qoderDraftMatches(selected.value, "") && qoderDraftMatches(selected.visibleValue, "") && !selected.sendEnabled;
    if (selection.active !== true || selection.inside !== true || (!emptyDraft && selection.coversAll !== true)) fail("selection_unverified", "Qoder 全选没有覆盖完整旧草稿，未清空。");
    await pair(qoderKeyPair("Backspace", "Backspace", 8, 0));
    await check("", "caret");
    let expected = "";
    const lines = expectedContent.split("\n");
    for (let index = 0; index < lines.length; index++) {
      if (index) {
        progress(`Qoder 换行 ${index}`);
        await check(expected, "caret");
        await pair(qoderKeyPair("Enter", "Enter", 13, 8, "\r"));
        expected += "\n";
        await check(expected, "caret");
      }
      if (lines[index]) {
        progress(`Qoder 预填第 ${index + 1} 行`);
        await check(expected, "caret");
        await command("Input.insertText", { text: lines[index] });
        expected += lines[index];
        await check(expected, "caret");
      }
    }
    progress("精确回读 Qoder 完整草稿");
    const ready = await check(expectedContent, "caret", false, true);
    if (!ready.sendEnabled || ready.sendId === undefined) fail("draft_unverified", "Qoder 尚未识别完整预填草稿。");
    if (request.submit && baseline) {
      progress("核验 Qoder 发送前消息基线");
      const currentMessages = await userMessages(ready.rootId);
      if (currentMessages.size !== baseline.size || [...baseline.keys()].some(id => !currentMessages.has(id))) fail("receipt_unverified", "Qoder 消息历史已变化，未发送。");
      const sending = await check(expectedContent, "caret", false, true);
      if (!sending.sendEnabled || sending.sendId === undefined) fail("send_unavailable", "Qoder 发送状态已变化。");
      const object = record((await command("DOM.resolveNode", { nodeId: sending.sendId })).object);
      progress("单次发送 Qoder");
      const sent = await command("Runtime.callFunctionOn", { objectId: object.objectId, functionDeclaration: QODER_TASK_SUBMISSION,
        arguments: [boundSession, request.title.trim(), boundPage.url, expectedContent].map(value => ({ value })), returnByValue: true });
      if (sent.exceptionDetails) fail("receipt_unverified", "Qoder 发送未完成确认，可能已发送。");
      progress("独立核验 Qoder 用户消息回执");
      for (let observation = 0; observation < 3; observation++) {
        const current = await inspect(true);
        const messages = await userMessages(current.rootId);
        const added = [...messages.keys()].filter(id => !baseline.has(id));
        if ([...baseline.keys()].some(id => !messages.has(id)) || added.length > 1) fail("receipt_unverified", "Qoder 新增用户消息存在歧义。");
        if (added.length === 1) {
          const bodies = await all(messages.get(added[0])!, '[data-chat-message-text][data-part-type="text"]');
          if (bodies.length !== 1 || normalizeText(nodeText(await readNode(bodies[0], -1))) !== expectedContent) fail("receipt_unverified", "Qoder 新增用户消息正文未精确匹配。");
          const finalPage = await connection.page();
          if (qoderDraftMatches(current.text, "") && qoderDraftMatches(current.value, "") && qoderDraftMatches(current.visibleValue, "") && finalPage.id === boundPage.id && finalPage.url === boundPage.url) return { status: "verified", detail: "已通过 CDP 单次发送至 Qoder 指定工作区任务，并核验唯一新增用户消息及空输入框。" };
        }
      }
      fail("receipt_unverified", "Qoder 未观察到完整发送回执，可能已发送，请人工检查。");
    }
    return { status: "verified", detail: "已通过 CDP 精确预填 Qoder 指定工作区任务，保留换行和空行，未发送。" };
  } catch (error) {
    const detail = error instanceof QoderDeliveryError ? error.message : "Qoder CDP 投放异常，请人工检查。";
    return { status: inputAttempted || submitAttempted ? "uncertain" : "notDelivered", detail: `${stage}：${detail}${submitAttempted ? " 可能已发送，不会重发或复制降级。" : inputAttempted ? " 可能已修改草稿，不会重试或复制降级。" : " 未输入或发送，不会自动重试。"}` };
  } finally {
    if (deadline) clearTimeout(deadline);
    try { client?.close(); } catch {}
  }
}