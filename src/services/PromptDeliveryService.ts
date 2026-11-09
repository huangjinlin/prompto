import * as vscode from "vscode";
import type { PromptChatSession } from "../models/MarkdownMeta";
import { parseMarkdownMetaDocument } from "./MarkdownMetaParserService";
import {
  createDesktopRunner,
  deliverDesktopChat,
  desktopChatAdapters,
  DesktopDeliveryTarget,
  resolveDesktopExecutable,
} from "./DesktopChatDeliveryService";

export type PromptOutputMode = "chatPrefill" | "chatSubmit" | "clipboard";
export type PromptDeliveryTarget = DesktopDeliveryTarget | "claudeCode";

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

  if (normalizedValue && (normalizedValue === "claudeCode" || Object.prototype.hasOwnProperty.call(desktopChatAdapters, normalizedValue))) {
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

const desktopConsentGranted = new Set<DesktopDeliveryTarget>();
let desktopDeliveryBusy = false;

async function deliverNamedSession(content: string, session: PromptChatSession, submit: boolean, target: DesktopDeliveryTarget): Promise<void> {
  const adapter = desktopChatAdapters[target];
  const targetLabel = target === "githubCopilotChat" ? "Copilot" : "Qoder CN";
  const targetWorkspace = adapter.requiresWorkspace ? session.workspace : vscode.workspace.name;
  if (desktopDeliveryBusy) {
    vscode.window.showWarningMessage("已有桌面投放正在执行，本次请求已忽略，不会排队发送。");
    return;
  }
  if (process.platform !== "win32" || vscode.env.remoteName) {
    vscode.window.showErrorMessage("指定会话投放目前只支持本地 Windows VS Code，未发送任何内容。");
    return;
  }
  if (!vscode.workspace.isTrusted) {
    vscode.window.showErrorMessage("请先信任工作区，再启用桌面投放。未发送任何内容。");
    return;
  }
  const configuration = vscode.workspace.getConfiguration("prompto");
  if (configuration.inspect<boolean>("desktop.enabled")?.globalValue === false) {
    vscode.window.showErrorMessage("桌面投放已在用户设置中关闭。请启用 prompto.desktop.enabled 后重试。");
    return;
  }
  if (!content.trim()) {
    vscode.window.showErrorMessage("投放内容为空，未发送任何内容。");
    return;
  }
  if (!targetWorkspace) {
    vscode.window.showErrorMessage("无法识别当前工作区窗口，未发送任何内容。");
    return;
  }
  desktopDeliveryBusy = true;
  let status: vscode.StatusBarItem | undefined;
  let statusTicker: ReturnType<typeof setInterval> | undefined;
  try {
    status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    status.name = "Prompto 桌面投放";
    const startedAt = Date.now();
    let currentStage = "准备投放";
    let lastCommand = "尚未调用桌面工具";
    const refreshStatus = () => {
      const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
      status!.text = `$(sync~spin) Prompto：${currentStage} (${elapsedSeconds}s)`;
      status!.tooltip = `目标软件：${targetLabel}\n目标工作区：${targetWorkspace}\n目标会话：${session.title}\n当前阶段：${currentStage}\n最近调用：${lastCommand}`;
    };
    const reportProgress = (message: string) => {
      currentStage = message;
      refreshStatus();
    };
    reportProgress("准备投放");
    status.show();
    statusTicker = setInterval(refreshStatus, 1000);
    reportProgress("启动桌面工具");
    const executable = resolveDesktopExecutable(configuration.inspect<string>("desktop.executablePath")?.globalValue ?? "");
    const runner = createDesktopRunner(executable);
    const result = await deliverDesktopChat({ content, title: session.title, submit, workspaceName: targetWorkspace, adapter, run: async (args, input) => {
      const commandStartedAt = Date.now();
      try {
        return await runner(args, input);
      } finally {
        const command = args[0] === "--headed" ? args[1] : args[0];
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
    } : undefined, authorizeDesktop: async () => {
      if (desktopConsentGranted.has(target)) {
        return true;
      }
      reportProgress("等待授权");
      const permission = await vscode.window.showWarningMessage(
        `允许 Prompto 在本次扩展运行期间${adapter.allowBackgroundFocus ? "将目标应用切到前台、" : ""}切换 ${targetLabel} 会话、聚焦聊天框并替换已有草稿吗？目标工作区：${targetWorkspace}，会话：${session.title}。发送仅由发送模式触发。投放期间请勿同时操作目标窗口，失去焦点会停止投放。`,
        { modal: true },
        "允许本窗口本次运行"
      );
      if (permission === "允许本窗口本次运行") desktopConsentGranted.add(target);
      return desktopConsentGranted.has(target);
    } });
    if (result.status === "verified" || result.status === "apiDispatched") {
      vscode.window.showInformationMessage(result.detail);
    } else if (result.status === "uncertain") {
      vscode.window.showWarningMessage(result.detail);
    } else {
      vscode.window.showErrorMessage(result.detail);
    }
  } catch (error) {
    vscode.window.showErrorMessage(`无法开始桌面投放：${error instanceof Error ? error.message : "unknown error"} 未发送任何内容。`);
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

export async function deliverPromptContent(
  promptName: string,
  promptContent: string,
  deliveryOptions: PromptDeliveryOptions = {}
): Promise<void> {
  const outputMode = resolvePromptOutputMode(deliveryOptions);

  if (outputMode === "clipboard") {
    await copyPromptToClipboard(
      promptName, promptContent, undefined, deliveryOptions.clipboardFeedback
    );
    return;
  }

  const deliveryTarget = resolvePromptDeliveryTarget(deliveryOptions);
  if (deliveryTarget === "qoder" && !deliveryOptions.chatSession) {
    vscode.window.showErrorMessage("Qoder 投放需要文档级 chatSession.workspace 和 chatSession.title，未执行桌面操作。");
    return;
  }
  if (deliveryOptions.chatSession) {
    if (deliveryTarget === "claudeCode") {
      vscode.window.showErrorMessage("claudeCode 不支持指定 chatSession，未发送任何内容。");
      return;
    }
    const adapter = desktopChatAdapters[deliveryTarget];
    const workspace = deliveryOptions.chatSession.workspace;
    if (adapter.requiresWorkspace ? !workspace?.trim() : workspace !== undefined) {
      vscode.window.showErrorMessage(adapter.requiresWorkspace
        ? "Qoder chatSession 必须提供工作区 workspace，未执行桌面操作。"
        : "Copilot chatSession 不支持 workspace 字段，请使用当前 VS Code 工作区。未执行桌面操作。");
      return;
    }
    await deliverNamedSession(promptContent, deliveryOptions.chatSession, outputMode === "chatSubmit", deliveryTarget);
    return;
  }
  const submitImmediately = outputMode === "chatSubmit";
  const openedChat =
    deliveryTarget === "claudeCode"
      ? await openClaudeCode(promptContent, submitImmediately)
      : await openCopilotChat(promptContent, submitImmediately);

  if (!openedChat) {
    const fallbackTarget =
      deliveryTarget === "claudeCode"
        ? "Claude Code"
        : "Copilot Chat";
    await copyPromptToClipboard(promptName, promptContent, fallbackTarget);
    return;
  }

  const action = submitImmediately ? "sent to" : "filled in";
  const targetLabel =
    deliveryTarget === "claudeCode"
      ? "Claude Code"
      : "Copilot Chat";
  vscode.window.showInformationMessage(
    `Prompt "${promptName}" ${action} ${targetLabel}.`
  );
}