import * as vscode from "vscode";
import { randomUUID } from "crypto";
import * as path from "path";
import { createLingxiCdpConnection } from "./LingxiCdpConnection";
import { deliverLingxiChat } from "./LingxiChatDeliveryService";
import { createQoderCdpConnection } from "./QoderCdpConnection";
import { deliverQoderChat } from "./QoderChatDeliveryService";
import type { PromptChatSession } from "../models/MarkdownMeta";
import type { DesktopDeliveryResult } from "./DesktopDriver";
import { parseMarkdownMetaDocument } from "./MarkdownMetaParserService";
import {
  createDesktopRunner,
  deliverDesktopChat,
  desktopChatAdapters,
  DesktopDeliveryTarget,
  resolveDesktopExecutable,
} from "./DesktopChatDeliveryService";

export type PromptOutputMode = "chatPrefill" | "chatSubmit" | "clipboard";
export type PromptDeliveryTarget = DesktopDeliveryTarget | "claudeCode" | "lingxi" | "qoder";
export type PromptDeliveryResult = DesktopDeliveryResult | { status: "copied"; detail: string };

export interface PromptDeliveryOptions {
  outputMode?: PromptOutputMode;
  deliveryTarget?: PromptDeliveryTarget;
  clipboardFeedback?: "notification" | "statusBar";
  chatSession?: PromptChatSession;
}

export function getDocumentPromptDeliveryOptions(lines: string[]): PromptDeliveryOptions {
  const meta = parseMarkdownMetaDocument(lines).document.namespaces.prompto;
  const deliveryTarget = parsePromptDeliveryTarget(meta?.deliveryTarget);
  const outputMode = parsePromptOutputMode(meta?.outputMode);
  if (meta?.deliveryTarget?.trim() && !deliveryTarget) {
    throw new Error("Invalid document Prompto deliveryTarget.");
  }
  if (meta?.outputMode?.trim() && !outputMode) {
    throw new Error("Invalid document Prompto outputMode.");
  }
  return { deliveryTarget, outputMode, ...(meta?.chatSession ? { chatSession: meta.chatSession } : {}) };
}

export function parsePromptOutputMode(
  value: string | undefined
): PromptOutputMode | undefined {
  const normalizedValue = normalizeOptionalValue(value);

  if (
    normalizedValue === "chatPrefill" ||
    normalizedValue === "chatSubmit" ||
    normalizedValue === "clipboard"
  ) {
    return normalizedValue;
  }

  return undefined;
}

export function parsePromptDeliveryTarget(
  value: string | undefined
): PromptDeliveryTarget | undefined {
  const normalizedValue = normalizeOptionalValue(value);

  if (normalizedValue && (normalizedValue === "claudeCode" || normalizedValue === "lingxi" || normalizedValue === "qoder" || Object.prototype.hasOwnProperty.call(desktopChatAdapters, normalizedValue))) {
    return normalizedValue as PromptDeliveryTarget;
  }

  return undefined;
}

async function pasteIntoActiveTerminal(
  promptContent: string,
  submitImmediately: boolean
): Promise<boolean> {
  const activeTerminal = vscode.window.activeTerminal;

  if (!activeTerminal) {
    return false;
  }

  const previousClipboardText = await vscode.env.clipboard.readText();

  try {
    await vscode.env.clipboard.writeText(promptContent);
    activeTerminal.show(false);
    await vscode.commands.executeCommand("workbench.action.terminal.paste");

    if (submitImmediately) {
      activeTerminal.sendText("", true);
    }

    return true;
  } catch (error) {
    console.warn("Failed to paste prompt into active terminal", error);
    return false;
  } finally {
    await vscode.env.clipboard.writeText(previousClipboardText);
  }
}

export async function prefillActiveTerminal(
  promptName: string,
  promptContent: string,
  _deliveryOptions: PromptDeliveryOptions = {}
): Promise<void> {
  const pasted = await pasteIntoActiveTerminal(promptContent, false);

  if (!pasted) {
    vscode.window.showErrorMessage(
      "No active terminal found. Focus a terminal and try again."
    );
    return;
  }

  vscode.window.showInformationMessage(
    `Prompt "${promptName}" pasted into the active terminal without sending.`
  );
}

const DEFAULT_PROMPT_OUTPUT_MODE: PromptOutputMode = "chatPrefill";
const DEFAULT_PROMPT_DELIVERY_TARGET: PromptDeliveryTarget =
  "githubCopilotChat";

let desktopDeliveryBusy = false;
let desktopLog: vscode.LogOutputChannel | undefined;

function writeDesktopLog(event: Record<string, unknown>, failed = false): void {
  try {
    desktopLog ??= vscode.window.createOutputChannel("Prompto Desktop", { log: true });
    const line = JSON.stringify(event);
    if (failed) desktopLog.error(line);
    else desktopLog.info(line);
  } catch {}
}

function desktopFailureReason(message: unknown): string | undefined {
  if (typeof message !== "string") return undefined;
  if (/private\s*file DACL grants an untrusted principal/.test(message)) return "private_state_permissions";
  if (message.includes("Target window did not become foreground before headed delivery")) return "window_not_foreground";
  if (message.includes("Window focus did not settle on the requested window")) return "window_focus_not_settled";
  if (message.includes("generating a response") || message.includes("正在生成")) return "task_generating";
  if (/timeout|timed out/i.test(message)) return "timeout";
  return undefined;
}

function rejectDelivery(detail: string): DesktopDeliveryResult {
  vscode.window.showErrorMessage(detail);
  return { status: "notDelivered", detail };
}

async function deliverLingxiSession(content: string, session: PromptChatSession, submit: boolean): Promise<DesktopDeliveryResult> {
  if (desktopDeliveryBusy) {
    const detail = "已有桌面投放正在执行，本次灵犀请求已忽略，不会排队发送。";
    vscode.window.showWarningMessage(detail);
    return { status: "notDelivered", detail };
  }
  if (process.platform !== "win32" || vscode.env.remoteName || !vscode.workspace.isTrusted) return rejectDelivery("灵犀投放只支持已信任工作区的本地 Windows VS Code，未操作灵犀。");
  const configuration = vscode.workspace.getConfiguration("prompto");
  if (configuration.inspect<boolean>("desktop.enabled")?.globalValue === false) return rejectDelivery("桌面投放已在用户设置中关闭，未操作灵犀。");
  const port = configuration.inspect<number>("lingxi.cdpPort")?.globalValue ?? 9347;
  const executable = configuration.inspect<string>("lingxi.executablePath")?.globalValue?.trim() || path.join(process.env?.LOCALAPPDATA ?? "", "Programs", "lingxi-desktop", "WPS 灵犀.exe");
  const requestId = randomUUID();
  const started = Date.now();
  let inputAttempted = false;
  let submitCommandIssued = false;
  let status: vscode.StatusBarItem | undefined;
  const log = (event: Record<string, unknown>, failed = false) => writeDesktopLog({ requestId, target: "lingxi", ...event }, failed);
  const logHint = `诊断日志：输出 → Prompto Desktop（请求 ${requestId}）。`;
  desktopDeliveryBusy = true;
  try {
    log({ event: "start", submit, contentBytes: Buffer.byteLength(content, "utf8") });
    status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    status.name = submit ? "Prompto 灵犀发送" : "Prompto 灵犀预填";
    status.text = `$(sync~spin) Prompto：准备灵犀${submit ? "发送" : "预填"}`;
    status.show();
    const result = await deliverLingxiChat({
      content, project: session.project!, title: session.title, submit,
      connect: () => createLingxiCdpConnection(port, executable),
      onEvent: event => {
        inputAttempted = event.inputAttempted;
        submitCommandIssued = event.submitAttempted;
        log({ ...event, submitCommandIssued }, event.event === "command.error");
        if (status) status.text = `$(sync~spin) Prompto：${event.stage}`;
      },
    });
    log({ event: "result", status: result.status, elapsedMs: Date.now() - started, inputAttempted, submitCommandIssued }, result.status !== "verified");
    if (result.status === "verified") vscode.window.showInformationMessage(result.detail);
    else if (result.status === "uncertain") vscode.window.showWarningMessage(`${result.detail} ${logHint}`);
    else vscode.window.showErrorMessage(`${result.detail} ${logHint}`);
    return result;
  } catch {
    log({ event: "exception", inputAttempted, submitCommandIssued }, true);
    const result: DesktopDeliveryResult = { status: inputAttempted || submitCommandIssued ? "uncertain" : "notDelivered", detail: `灵犀投放未完成确认，${submitCommandIssued ? "可能已发送，" : ""}请人工检查，不会重试或复制降级。 ${logHint}` };
    vscode.window.showErrorMessage(result.detail);
    return result;
  } finally {
    try { status?.dispose(); } catch {}
    desktopDeliveryBusy = false;
  }
}

async function deliverQoderSession(content: string, session: PromptChatSession, submit: boolean): Promise<DesktopDeliveryResult> {
  if (desktopDeliveryBusy) {
    const detail = "已有桌面投放正在执行，本次 Qoder 请求已忽略，不会排队发送。";
    vscode.window.showWarningMessage(detail);
    return { status: "notDelivered", detail };
  }
  if (process.platform !== "win32" || vscode.env.remoteName || !vscode.workspace.isTrusted) return rejectDelivery("Qoder CDP 投放只支持已信任工作区的本地 Windows VS Code，未操作 Qoder。");
  const configuration = vscode.workspace.getConfiguration("prompto");
  if (configuration.inspect<boolean>("desktop.enabled")?.globalValue === false) return rejectDelivery("桌面投放已在用户设置中关闭，未操作 Qoder。");
  const port = configuration.inspect<number>("qoder.cdpPort")?.globalValue ?? 9348;
  const executable = configuration.inspect<string>("qoder.executablePath")?.globalValue?.trim() ?? "";
  const requestId = randomUUID();
  const started = Date.now();
  let inputAttempted = false;
  let submitCommandIssued = false;
  let status: vscode.StatusBarItem | undefined;
  let ticker: ReturnType<typeof setInterval> | undefined;
  let currentStage = "准备 Qoder CDP 投放";
  const log = (event: Record<string, unknown>, failed = false) => writeDesktopLog({ requestId, target: "qoder", transport: "cdp", ...event }, failed);
  const logHint = `诊断日志：输出 → Prompto Desktop（请求 ${requestId}）。`;
  desktopDeliveryBusy = true;
  try {
    log({ event: "start", submit, contentBytes: Buffer.byteLength(content, "utf8") });
    status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    status.name = submit ? "Prompto Qoder 发送" : "Prompto Qoder 预填";
    const refresh = () => { if (status) { status.text = `$(sync~spin) Prompto：${currentStage} (${Math.floor((Date.now() - started) / 1000)}s)`; status.tooltip = "Qoder CN · CDP · 不会自动重试或回退桌面输入"; } };
    refresh();
    status.show();
    ticker = setInterval(refresh, 1000);
    const result = await deliverQoderChat({ content, workspace: session.workspace!, title: session.title, submit,
      connect: () => createQoderCdpConnection(port, executable, content),
      onEvent: event => {
        inputAttempted = event.inputAttempted;
        submitCommandIssued = event.submitAttempted;
        currentStage = event.stage;
        log({ ...event, inputCommandIssued: inputAttempted, submitCommandIssued }, event.event === "command.error");
        refresh();
      },
    });
    log({ event: "result", status: result.status, elapsedMs: Date.now() - started, reason: desktopFailureReason(result.detail), inputCommandIssued: inputAttempted, submitCommandIssued }, result.status !== "verified");
    if (result.status === "verified") vscode.window.showInformationMessage(result.detail);
    else if (result.status === "uncertain") vscode.window.showWarningMessage(`${result.detail} ${logHint}`);
    else vscode.window.showErrorMessage(`${result.detail} ${logHint}`);
    return result;
  } catch {
    log({ event: "exception", inputCommandIssued: inputAttempted, submitCommandIssued }, true);
    const result: DesktopDeliveryResult = { status: inputAttempted || submitCommandIssued ? "uncertain" : "notDelivered", detail: `Qoder CDP 投放未完成确认，${submitCommandIssued ? "可能已发送，" : ""}请人工检查，不会重试、回退旧桌面投放或复制降级。 ${logHint}` };
    vscode.window.showErrorMessage(result.detail);
    return result;
  } finally {
    if (ticker) clearInterval(ticker);
    try { status?.dispose(); } catch {}
    desktopDeliveryBusy = false;
  }
}

async function deliverNamedSession(content: string, session: PromptChatSession, submit: boolean, target: DesktopDeliveryTarget): Promise<DesktopDeliveryResult> {
  const adapter = desktopChatAdapters[target];
  const targetLabel = target === "githubCopilotChat" ? "Copilot" : "Qoder CN";
  const targetWorkspace = adapter.requiresWorkspace ? session.workspace : vscode.workspace.name;
  if (desktopDeliveryBusy) {
    const detail = "已有桌面投放正在执行，本次请求已忽略，不会排队发送。";
    vscode.window.showWarningMessage(detail);
    return { status: "notDelivered", detail };
  }
  if (process.platform !== "win32" || vscode.env.remoteName) {
    return rejectDelivery("指定会话投放目前只支持本地 Windows VS Code，未发送任何内容。");
  }
  if (!vscode.workspace.isTrusted) {
    return rejectDelivery("请先信任工作区，再启用桌面投放。未发送任何内容。");
  }
  const configuration = vscode.workspace.getConfiguration("prompto");
  if (configuration.inspect<boolean>("desktop.enabled")?.globalValue === false) {
    return rejectDelivery("桌面投放已在用户设置中关闭。请启用 prompto.desktop.enabled 后重试。");
  }
  if (!content.trim()) {
    return rejectDelivery("投放内容为空，未发送任何内容。");
  }
  if (!targetWorkspace) {
    return rejectDelivery("无法识别当前工作区窗口，未发送任何内容。");
  }
  desktopDeliveryBusy = true;
  let status: vscode.StatusBarItem | undefined;
  let statusTicker: ReturnType<typeof setInterval> | undefined;
  const requestId = randomUUID();
  const startedAt = Date.now();
  let currentStage = "准备投放";
  let inputCommandIssued = false;
  let submitCommandIssued = false;
  let observedWindowId: string | undefined;
  const log = (event: Record<string, unknown>, failed = false) =>
    writeDesktopLog({ requestId, ...event }, failed);
  const logHint = `诊断日志：输出 → Prompto Desktop（请求 ${requestId}）。`;
  try {
    const version: unknown = vscode.extensions?.getExtension("dpw.prompto")?.packageJSON?.version;
    log({ event: "start", target, submit, contentBytes: Buffer.byteLength(content, "utf8"),
      extensionVersion: typeof version === "string" && /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version) ? version : undefined });
    status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    status.name = "Prompto 桌面投放";
    let lastCommand = "尚未调用桌面工具";
    const refreshStatus = () => {
      const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
      status!.text = `$(sync~spin) Prompto：${currentStage} (${elapsedSeconds}s)`;
      status!.tooltip = `目标软件：${targetLabel}\n目标工作区：${targetWorkspace}\n目标会话：${session.title}\n当前阶段：${currentStage}\n最近调用：${lastCommand}`;
    };
    const reportProgress = (message: string) => {
      currentStage = message;
      log({ event: "stage", stage: currentStage });
      refreshStatus();
    };
    reportProgress("准备投放");
    status.show();
    statusTicker = setInterval(refreshStatus, 1000);
    reportProgress("启动桌面工具");
    const executable = resolveDesktopExecutable(configuration.inspect<string>("desktop.executablePath")?.globalValue ?? "");
    const runner = createDesktopRunner(executable);
    const result = await deliverDesktopChat({ content, title: session.title, submit, workspaceName: targetWorkspace, adapter, run: async (args, input) => {
      const command = args[0] === "--headed" ? args[1] : args[0];
      const commandStartedAt = Date.now();
      if (command === "type" || command === "press" && args[2] === "ctrl+v") inputCommandIssued = true;
      if (command === "click" && currentStage === "提交一次") submitCommandIssued = true;
      log({ event: "command.start", stage: currentStage, command, inputCommandIssued, submitCommandIssued });
      try {
        const reply = await runner(args, input);
        const code = reply.error?.code;
        const disposition = reply.ok
          ? (reply.data as { disposition?: { delivery?: string; retry?: string } } | undefined)?.disposition
          : reply.error?.disposition;
        const delivery = disposition?.delivery;
        const retry = disposition?.retry;
        const physicalDeliveryStarted = reply.error?.details?.physical_delivery_started;
        const observation: Record<string, unknown> = {};
        if (command === "list-windows" && Array.isArray(reply.data)) {
          observation.windowCount = reply.data.length;
          if (reply.data.length === 1) {
            const window = reply.data[0];
            if (typeof window?.id === "string") {
              observedWindowId ??= window.id;
              observation.sameWindow = window.id === observedWindowId;
            }
            for (const key of ["visible", "minimized", "is_focused", "accessible"]) {
              if (typeof window?.[key] === "boolean") observation[key] = window[key];
            }
          }
        }
        if (command === "snapshot" && typeof (reply.data as { complete?: unknown } | undefined)?.complete === "boolean") {
          observation.complete = (reply.data as { complete: boolean }).complete;
        }
        log({ event: "command.end", stage: currentStage, command, elapsedMs: Date.now() - commandStartedAt, ok: reply.ok,
          errorCode: typeof code === "string" && /^[A-Z][A-Z_]{0,47}$/.test(code) ? code : undefined,
          reason: desktopFailureReason(reply.error?.message),
          physicalDeliveryStarted: typeof physicalDeliveryStarted === "boolean" ? physicalDeliveryStarted : undefined,
          delivery: ["not_delivered", "delivered_unverified", "delivered_verified", "unknown"].includes(delivery ?? "") ? delivery : undefined,
          retry: ["safe", "unsafe", "unknown"].includes(retry ?? "") ? retry : undefined,
          ...observation }, !reply.ok);
        return reply;
      } catch (error) {
        log({ event: "command.error", stage: currentStage, command, elapsedMs: Date.now() - commandStartedAt,
          reason: desktopFailureReason(error instanceof Error ? error.message : undefined) ?? "runner_exception" }, true);
        throw error;
      } finally {
        lastCommand = `${command}${command === "snapshot" ? args.includes("--root") ? " (局部)" : " (窗口)" : ""}：${Date.now() - commandStartedAt}ms`;
        refreshStatus();
      }
    }, reportProgress, deliverActiveSession: target === "githubCopilotChat" ? async () => {
      reportProgress("通过 VS Code API 投放");
      try {
        await vscode.commands.executeCommand("workbench.action.chat.open", {
          query: content,
          isPartialQuery: !submit,
        });
        return { status: "apiDispatched", detail: `已通过 VS Code API ${submit ? "提交" : "预填"}当前会话「${session.title}」。` };
      } catch {
        return { status: "uncertain", detail: "VS Code API 投放未完成确认，请检查当前会话；不会自动重发或转用桌面输入。" };
      }
    } : undefined, authorizeDesktop: async () => true });
    log({ event: "result", stage: currentStage, status: result.status, elapsedMs: Date.now() - startedAt,
      reason: desktopFailureReason(result.detail), inputCommandIssued, submitCommandIssued }, result.status === "uncertain" || result.status === "notDelivered");
    if (result.status === "verified" || result.status === "apiDispatched") {
      vscode.window.showInformationMessage(result.detail);
    } else if (result.status === "uncertain") {
      vscode.window.showWarningMessage(`${result.detail} ${logHint}`);
    } else {
      vscode.window.showErrorMessage(`${result.detail} ${logHint}`);
    }
    return result;
  } catch (error) {
    log({ event: "exception", stage: currentStage, elapsedMs: Date.now() - startedAt,
      reason: desktopFailureReason(error instanceof Error ? error.message : undefined) ?? "unexpected_exception",
      inputCommandIssued, submitCommandIssued }, true);
    return rejectDelivery(`无法开始桌面投放：${error instanceof Error ? error.message : "unknown error"} 未发送任何内容。 ${logHint}`);
  } finally {
    if (statusTicker) {
      clearInterval(statusTicker);
    }
    status?.dispose();
    desktopDeliveryBusy = false;
  }
}

function normalizeOptionalValue(value: string | undefined): string | undefined {
  const trimmedValue = value?.trim();
  return trimmedValue ? trimmedValue : undefined;
}

function getPromptOutputMode(): PromptOutputMode {
  const configuredMode = vscode.workspace
    .getConfiguration("prompto")
    .get<string>("outputMode", DEFAULT_PROMPT_OUTPUT_MODE);

  return parsePromptOutputMode(configuredMode) ?? DEFAULT_PROMPT_OUTPUT_MODE;
}

function getPromptDeliveryTarget(): PromptDeliveryTarget {
  const configuredTarget = vscode.workspace
    .getConfiguration("prompto")
    .get<string>("deliveryTarget", DEFAULT_PROMPT_DELIVERY_TARGET);

  return (
    parsePromptDeliveryTarget(configuredTarget) ??
    DEFAULT_PROMPT_DELIVERY_TARGET
  );
}

function resolvePromptDeliveryTarget(
  deliveryOptions: PromptDeliveryOptions = {}
): PromptDeliveryTarget {
  return deliveryOptions.deliveryTarget ?? getPromptDeliveryTarget();
}

function resolvePromptOutputMode(
  deliveryOptions: PromptDeliveryOptions = {}
): PromptOutputMode {
  return deliveryOptions.outputMode ?? getPromptOutputMode();
}

async function openCopilotChat(
  promptContent: string,
  submitImmediately: boolean
): Promise<boolean> {
  try {
    await vscode.commands.executeCommand("workbench.action.chat.open", {
      query: promptContent,
      isPartialQuery: !submitImmediately,
    });

    return true;
  } catch (error) {
    console.warn("Failed to open Copilot Chat", error);
    return false;
  }
}

async function openClaudeCode(
  promptContent: string,
  submitImmediately: boolean
): Promise<boolean> {
  return await pasteIntoActiveTerminal(promptContent, submitImmediately);
}

async function copyPromptToClipboard(
  promptName: string,
  promptContent: string,
  fallbackTarget: string | undefined = undefined,
  feedback: "notification" | "statusBar" = "notification"
): Promise<void> {
  await vscode.env.clipboard.writeText(promptContent);

  if (fallbackTarget) {
    vscode.window.showWarningMessage(
      `Could not deliver prompt "${promptName}" to ${fallbackTarget}. Prompt copied to clipboard instead.`
    );
    return;
  }

  if (feedback === "statusBar") {
    vscode.window.setStatusBarMessage("已复制", 3000);
    return;
  }

  vscode.window.showInformationMessage(
    `Prompt "${promptName}" copied to clipboard.`
  );
}

async function deliverPromptContentInternal(
  promptName: string,
  promptContent: string,
  deliveryOptions: PromptDeliveryOptions,
  allowClipboardFallback: boolean
): Promise<PromptDeliveryResult> {
  const outputMode = resolvePromptOutputMode(deliveryOptions);

  if (outputMode === "clipboard") {
    await copyPromptToClipboard(
      promptName, promptContent, undefined, deliveryOptions.clipboardFeedback
    );
    return { status: "copied", detail: `Prompt "${promptName}" copied to clipboard.` };
  }

  const deliveryTarget = resolvePromptDeliveryTarget(deliveryOptions);
  if (deliveryTarget === "lingxi") {
    const session = deliveryOptions.chatSession;
    if (!session || typeof session.project !== "string" || !session.project.trim() || typeof session.title !== "string" || !session.title.trim() || session.workspace !== undefined) return rejectDelivery("灵犀需要 chatSession.project 和 title，且不支持 workspace，未操作灵犀。");
    return deliverLingxiSession(promptContent, session, outputMode === "chatSubmit");
  }
  if (deliveryOptions.chatSession?.project !== undefined) return rejectDelivery("chatSession.project 只支持灵犀，未执行投放。");
  if (deliveryTarget === "qoder") {
    const session = deliveryOptions.chatSession;
    if (!session || typeof session.workspace !== "string" || !session.workspace.trim() || typeof session.title !== "string" || !session.title.trim()) return rejectDelivery("Qoder 投放需要文档级 chatSession.workspace 和 chatSession.title，未操作 Qoder。");
    return deliverQoderSession(promptContent, session, outputMode === "chatSubmit");
  }
  if (deliveryOptions.chatSession) {
    if (deliveryTarget === "claudeCode") {
      return rejectDelivery("claudeCode 不支持指定 chatSession，未发送任何内容。");
    }
    const adapter = desktopChatAdapters[deliveryTarget];
    const workspace = deliveryOptions.chatSession.workspace;
    if (adapter.requiresWorkspace ? !workspace?.trim() : workspace !== undefined) {
      return rejectDelivery(adapter.requiresWorkspace
        ? "Qoder chatSession 必须提供工作区 workspace，未执行桌面操作。"
        : "Copilot chatSession 不支持 workspace 字段，请使用当前 VS Code 工作区。未执行桌面操作。");
    }
    return deliverNamedSession(promptContent, deliveryOptions.chatSession, outputMode === "chatSubmit", deliveryTarget);
  }
  const submitImmediately = outputMode === "chatSubmit";
  const openedChat =
    deliveryTarget === "claudeCode"
      ? await openClaudeCode(promptContent, submitImmediately)
      : await openCopilotChat(promptContent, submitImmediately);

  if (!openedChat) {
    if (!allowClipboardFallback) {
      const detail = "投放未完成确认，请人工检查；不会自动重发或降级到复制。";
      vscode.window.showWarningMessage(detail);
      return { status: "uncertain", detail };
    }
    const fallbackTarget =
      deliveryTarget === "claudeCode"
        ? "Claude Code"
        : "Copilot Chat";
    await copyPromptToClipboard(promptName, promptContent, fallbackTarget);
    return { status: "copied", detail: `Prompt "${promptName}" copied to clipboard after delivery failed.` };
  }

  const action = submitImmediately ? "sent to" : "filled in";
  const targetLabel =
    deliveryTarget === "claudeCode"
      ? "Claude Code"
      : "Copilot Chat";
  const detail = `Prompt "${promptName}" ${action} ${targetLabel}.`;
  vscode.window.showInformationMessage(detail);
  return { status: "apiDispatched", detail };
}

export async function deliverPromptContent(
  promptName: string,
  promptContent: string,
  deliveryOptions: PromptDeliveryOptions = {}
): Promise<void> {
  await deliverPromptContentInternal(promptName, promptContent, deliveryOptions, true);
}

export async function deliverPromptContentWithResult(
  promptName: string,
  promptContent: string,
  deliveryOptions: PromptDeliveryOptions = {}
): Promise<PromptDeliveryResult> {
  return deliverPromptContentInternal(promptName, promptContent, deliveryOptions, false);
}