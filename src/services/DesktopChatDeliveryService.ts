import { DesktopReply, DesktopRunner, DesktopDeliveryResult, DesktopNode, DesktopWindow, DesktopChatAdapter, DESKTOP_INPUT_BYTE_LIMIT, record, ref, success, normalizeText } from "./DesktopDriver";
import { copilotDesktopAdapter } from "./CopilotDesktopAdapter";
export { createDesktopRunner, resolveDesktopExecutable, DesktopReply, DesktopRunner, DesktopDeliveryResult, DESKTOP_INPUT_BYTE_LIMIT } from "./DesktopDriver";

export const desktopChatAdapters = { githubCopilotChat: copilotDesktopAdapter };
export type DesktopDeliveryTarget = keyof typeof desktopChatAdapters;

export interface DesktopDeliveryRequest {
  content: string;
  title: string;
  submit: boolean;
  workspaceName: string;
  adapter: DesktopChatAdapter;
  run: DesktopRunner;
  reportProgress?: (message: string) => void;
  deliverActiveSession?: () => Promise<DesktopDeliveryResult>;
  authorizeDesktop?: () => Promise<boolean>;
}

export async function deliverDesktopChat(request: DesktopDeliveryRequest): Promise<DesktopDeliveryResult> {
  const { content, title, submit, workspaceName, adapter, run: execute, deliverActiveSession,
    reportProgress: onProgress = () => undefined, authorizeDesktop = async () => true } = request;
  let stage = "初始化桌面投放";
  let command = "";
  const reportProgress = (message: string) => { stage = message; onProgress(message); };
  const run: DesktopRunner = (args, input) => {
    command = args[0] === "--headed" ? args[1] : args[0];
    return execute(args, input);
  };
  const assertSession = (chat: DesktopNode) => adapter.assertTarget(chat, title, workspaceName);
  const assertIdle = (chat: DesktopNode) => adapter.assertIdle(chat);
  const inputField = (chat: DesktopNode) => adapter.inputField(chat);
  const assertInputSize = () => {
    if (Buffer.byteLength(content, "utf8") > DESKTOP_INPUT_BYTE_LIMIT) {
      throw new Error(`Desktop input supports at most ${DESKTOP_INPUT_BYTE_LIMIT} UTF-8 bytes. It will not be split.`);
    }
  };
  let inputAttempted = false;
  let submitAttempted = false;
  let desktopAuthorized = false;
  const result = (status: DesktopDeliveryResult["status"], detail: string): DesktopDeliveryResult => {
    return { status, detail };
  };
  try {
    if (!content.trim()) {
      throw new Error("Prompt content must be non-empty.");
    }
    if (!title.trim() || /[\u0000-\u001f\u007f{}]/.test(title)) {
      throw new Error("A literal session title is required.");
    }
    reportProgress(`定位 ${adapter.appName} 窗口`);
    const windowsReply = success(await run(["list-windows", "--app", adapter.appName]));
    if (!workspaceName || !Array.isArray(windowsReply.data)) {
      throw new Error("The local VS Code workspace window cannot be identified.");
    }
    const window = adapter.findWindow(windowsReply.data as DesktopWindow[], workspaceName);
    const restoreMinimized = window.minimized && adapter.minimizedWindowPolicy === "restoreAndMaximize";
    if ((!window.visible || window.minimized) && !restoreMinimized) {
      throw new Error(`${adapter.appName} 目标窗口不可见或已最小化，请先恢复窗口。`);
    }
    if (!window.accessible || typeof window.id !== "string" || !window.id) {
      throw new Error(`${adapter.appName} 目标窗口不可访问或无法确认身份。`);
    }
    if (!window.is_focused && !adapter.allowBackgroundFocus) {
      throw new Error(`${adapter.appName} 目标窗口不在前台，请先切回目标窗口。`);
    }
    const assertWindowState = async (requireFocus = true) => {
      const reply = success(await run(["list-windows", "--app", adapter.appName]));
      if (!Array.isArray(reply.data)) throw new Error("Window identity is unavailable.");
      const current = adapter.findWindow(reply.data as DesktopWindow[], workspaceName);
      if (current.id !== window.id || !current.visible || current.minimized || !current.accessible) {
        throw new Error("目标应用窗口身份或可见状态已变化，已停止投放。");
      }
      if (requireFocus && !current.is_focused) throw new Error("目标应用未能获得前台焦点或焦点已变化，已停止投放；不会自动重试聚焦。");
      return current;
    };
    reportProgress("检查桌面权限");
    const permissions = record(success(await run(["permissions"])).data);
    if (record(permissions.accessibility).state !== "granted") {
      throw new Error("Desktop accessibility permission is not granted.");
    }
    if (restoreMinimized) {
      assertInputSize();
      if (!await authorizeDesktop()) {
        return result("notDelivered", "已取消桌面投放，未恢复窗口、切换或输入内容。");
      }
      desktopAuthorized = true;
      const currentReply = success(await run(["list-windows", "--app", adapter.appName]));
      if (!Array.isArray(currentReply.data)) throw new Error("Window identity is unavailable.");
      const current = adapter.findWindow(currentReply.data as DesktopWindow[], workspaceName);
      if (current.id !== window.id || !current.accessible) {
        throw new Error("目标应用窗口身份或可访问状态已变化，已停止投放。");
      }
      if (current.minimized) {
        reportProgress(`恢复 ${adapter.appName} 窗口`);
        success(await run(["--headed", "restore", "--app", adapter.appName, "--window-id", window.id]));
        await assertWindowState(false);
        reportProgress(`最大化 ${adapter.appName} 窗口`);
        const maximized = success(await run(["--headed", "maximize", "--app", adapter.appName, "--window-id", window.id]));
        await assertWindowState(false);
        if (record(record(maximized.data).disposition).delivery !== "delivered_verified") {
          throw new Error("目标窗口最大化结果未经确认，已停止投放；不会自动重试。");
        }
        reportProgress(`激活 ${adapter.appName} 窗口`);
        success(await run(["--headed", "focus-window", "--app", adapter.appName, "--window-id", window.id]));
        await assertWindowState();
      } else {
        await assertWindowState(false);
      }
    }
    let chatRef: string | undefined;
    const snapshot = async (): Promise<DesktopNode> => {
      const readPanel = (reply: DesktopReply): DesktopNode => {
        const data = record(success(reply).data);
        if (!data.tree || data.complete !== true) {
          throw new Error("The desktop observation is incomplete.");
        }
        const chat = adapter.observationRoot(data.tree as DesktopNode);
        chatRef = adapter.scopedSnapshots && chat.ref_id?.startsWith("@") ? chat.ref_id : undefined;
        return chat;
      };
      const options = ["--compact", "--max-depth", "24", "--timeout-ms", "30000"];
      if (chatRef) {
        try {
          return readPanel(await run(["snapshot", "--root", chatRef, ...options]));
        } catch {
          chatRef = undefined;
        }
      }
      return readPanel(await run(["snapshot", "--app", adapter.appName, "--window-id", window.id, ...options]));
    };
    reportProgress("读取会话列表");
    let chat = await snapshot();
    const dispatchActiveSession = async (): Promise<DesktopDeliveryResult> => {
      reportProgress("通过 VS Code API 投放");
      try {
        return await deliverActiveSession!();
      } catch {
        return result("uncertain", "当前会话的 API 投放结果不确定，请人工检查；不会自动转用桌面输入或重发。");
      }
    };
    if (deliverActiveSession && adapter.activeTitle(chat) === title) {
      assertSession(chat);
      assertIdle(chat);
      return dispatchActiveSession();
    }
    if (!deliverActiveSession) assertInputSize();
    if (!desktopAuthorized && !await authorizeDesktop()) {
      return result("notDelivered", "已取消桌面投放，未切换或输入内容。");
    }
    chat = await adapter.navigate(chat, title, workspaceName, { run, snapshot, reportProgress });
    assertSession(chat);
    if (adapter.allowBackgroundFocus) {
      const current = await assertWindowState(false);
      if (!current.is_focused) {
        reportProgress(`激活 ${adapter.appName} 窗口`);
        success(await run(["--headed", "focus-window", "--app", adapter.appName, "--window-id", window.id]));
        await assertWindowState();
        chat = await snapshot();
        assertSession(chat);
      }
    }
    assertIdle(chat);
    if (deliverActiveSession) {
      await assertWindowState();
      return dispatchActiveSession();
    }
    reportProgress("聚焦并读取草稿");
    await assertWindowState(!adapter.allowBackgroundFocus);
    success(await run(["--headed", "focus", ref(inputField(chat)), "--timeout-ms", "30000"]));
    await assertWindowState();
    chat = await snapshot();
    assertSession(chat);
    assertIdle(chat);
    let field = inputField(chat);
    if (!field.states?.includes("focused")) {
      throw new Error("Chat input focus could not be verified.");
    }
    const readValue = async (target: DesktopNode): Promise<string> => {
      const value = record(success(await run(["get", ref(target), "--property", "value"])).data).value;
      if (typeof value !== "string") {
        throw new Error("Chat draft cannot be read safely.");
      }
      return value;
    };
    const inputPlan = adapter.inputPlan(content);
    if ((await readValue(field)).length) {
      await assertWindowState();
      success(await run(["--headed", "press", "ctrl+a", "--app", adapter.appName, "--window-id", window.id]));
      chat = await snapshot();
      assertSession(chat);
      assertIdle(chat);
      field = inputField(chat);
      if (!field.states?.includes("focused")) {
        throw new Error("Chat input focus changed before replacing the draft.");
      }
    }
    let beforeCount = submit ? adapter.requestCount(chat, content) : 0;
    reportProgress("填入提示词");
    let prefix = "";
    for (const step of inputPlan) {
      await assertWindowState();
      const previouslyAttempted: boolean = inputAttempted;
      if ("paste" in step) {
        reportProgress("准备完整文本粘贴");
        success(await run(["clipboard-set", "--stdin"], step.paste));
        if (record(success(await run(["clipboard-get", "--format", "text"])).data).text !== step.paste) {
          throw new Error("粘贴前的剪贴板内容未经确认。");
        }
        await assertWindowState();
        chat = await snapshot();
        assertSession(chat);
        assertIdle(chat);
        field = inputField(chat);
        if (!field.states?.includes("focused")) throw new Error("Chat input focus changed before pasting.");
      }
      inputAttempted = true;
      const typed = "paste" in step
        ? await run(["--headed", "press", "ctrl+v", "--app", adapter.appName, "--window-id", window.id])
        : "text" in step
          ? await run(["--headed", "type", ref(field), "--stdin", "--timeout-ms", "120000"], step.text)
          : await run(["--headed", "press", step.key, "--app", adapter.appName, "--window-id", window.id]);
      if (!typed.ok && typed.error?.disposition?.delivery === "not_delivered") inputAttempted = previouslyAttempted;
      success(typed);
      prefix += "paste" in step ? step.paste : "text" in step ? step.text : "\n";
      if ("paste" in step) await assertWindowState();
      reportProgress(adapter.requiresExactDraft ? "校验完整草稿" : "检查输入焦点");
      chat = await snapshot();
      assertSession(chat);
      assertIdle(chat);
      field = inputField(chat);
      if (!field.states?.includes("focused")) {
        throw new Error("Chat input focus changed after input.");
      }
      if (adapter.requiresExactDraft && normalizeText(await readValue(field)) !== normalizeText(prefix)) {
        throw new Error("The filled draft does not exactly match the rendered prompt.");
      }
      if ("paste" in step) adapter.sendButton(chat);
    }
    if (normalizeText(prefix) !== normalizeText(content)) throw new Error("The input plan does not preserve the full prompt.");
    if (!submit) {
      return result("verified", adapter.requiresExactDraft
        ? `已预填并校验会话「${title}」，未发送。`
        : `已预填会话「${title}」，未发送；正文请人工核对。`);
    }
    reportProgress("发送前核验");
    chat = await snapshot();
    assertSession(chat);
    assertIdle(chat);
    field = inputField(chat);
    if (!field.states?.includes("focused")) {
      throw new Error("Chat input focus changed before submission.");
    }
    const draft = await readValue(field);
    if (adapter.requiresExactDraft && normalizeText(draft) !== normalizeText(content)) {
      throw new Error("The draft changed before submission.");
    }
    const receiptContent = adapter.requiresExactDraft ? content : draft;
    if (!adapter.requiresExactDraft) {
      beforeCount = adapter.requestCount(chat, receiptContent);
    }
    const button = adapter.sendButton(chat);
    await assertWindowState();
    reportProgress("提交一次");
    submitAttempted = true;
    const clicked = await run(["click", ref(button), "--timeout-ms", "30000"]);
    if (!clicked.ok && clicked.error?.disposition?.delivery === "not_delivered") {
      submitAttempted = false;
      return result("notDelivered", "发送动作未投放；草稿可能保留在目标会话中。不会自动重试。");
    }
    reportProgress("核验发送结果");
    chat = await snapshot();
    assertSession(chat);
    field = inputField(chat);
    if ((adapter.requiresReceiptFocus && !field.states?.includes("focused")) || (await readValue(field)).trim() || adapter.requestCount(chat, receiptContent) !== beforeCount + 1) {
      throw new Error("The new user message and cleared draft could not be independently verified.");
    }
    return result("verified", `已发送一次并核验会话「${title}」中的新增消息。${adapter.requiresExactDraft ? "" : "正文请人工核对。"}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Desktop delivery could not be verified.";
    const reason = `${adapter.appName} 在「${stage}」阶段${/timeout|timed out|超时/i.test(message) ? "超时" : "失败"}${command ? `（${command}）` : ""}：${message}`;
    if (inputAttempted || submitAttempted) {
      return result("uncertain", `${reason} ${submitAttempted ? "发送可能已发生。" : "尚未执行发送，草稿可能已填入。"}请人工检查；不会自动重试。`);
    }
    return result("notDelivered", `${reason} 未输入或发送新内容。`);
  }
}

export function deliverToDesktopSession(
  content: string, title: string, submit: boolean, workspaceName: string, run: DesktopRunner,
  reportProgress?: (message: string) => void, deliverActiveSession?: () => Promise<DesktopDeliveryResult>,
  authorizeDesktop?: () => Promise<boolean>
): Promise<DesktopDeliveryResult> {
  return deliverDesktopChat({ content, title, submit, workspaceName, run, reportProgress, deliverActiveSession, authorizeDesktop, adapter: copilotDesktopAdapter });
}