import * as vscode from "vscode";

export type PromptOutputMode = "chatPrefill" | "chatSubmit" | "clipboard";
export type PromptDeliveryTarget =
  | "githubCopilotChat"
  | "continue"
  | "claudeCode";

export interface PromptDeliveryOptions {
  outputMode?: PromptOutputMode;
  deliveryTarget?: PromptDeliveryTarget;
  continueSessionId?: string;
  continueSessionTitle?: string;
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

  if (
    normalizedValue === "githubCopilotChat" ||
    normalizedValue === "continue" ||
    normalizedValue === "claudeCode"
  ) {
    return normalizedValue;
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

function getContinueSessionId(): string | undefined {
  const configuredSessionId = vscode.workspace
    .getConfiguration("prompto")
    .get<string>("continueSessionId", "");

  return normalizeOptionalValue(configuredSessionId);
}

function getContinueSessionTitle(): string | undefined {
  const configuredSessionTitle = vscode.workspace
    .getConfiguration("prompto")
    .get<string>("continueSessionTitle", "");

  return normalizeOptionalValue(configuredSessionTitle);
}

function resolveContinueDeliveryOptions(
  deliveryOptions: PromptDeliveryOptions = {}
): PromptDeliveryOptions {
  const overriddenSessionId = normalizeOptionalValue(
    deliveryOptions.continueSessionId
  );
  if (overriddenSessionId) {
    return {
      continueSessionId: overriddenSessionId,
    };
  }

  const overriddenSessionTitle = normalizeOptionalValue(
    deliveryOptions.continueSessionTitle
  );
  if (overriddenSessionTitle) {
    return {
      continueSessionTitle: overriddenSessionTitle,
    };
  }

  const configuredSessionId = getContinueSessionId();
  if (configuredSessionId) {
    return {
      continueSessionId: configuredSessionId,
    };
  }

  const configuredSessionTitle = getContinueSessionTitle();
  return {
    continueSessionTitle: configuredSessionTitle,
  };
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

async function openContinueChat(
  promptContent: string,
  submitImmediately: boolean,
  deliveryOptions: PromptDeliveryOptions = {}
): Promise<boolean> {
  try {
    const resolvedDeliveryOptions = resolveContinueDeliveryOptions(
      deliveryOptions
    );

    await vscode.commands.executeCommand("continue.promptoDeliverPrompt", {
      sessionId: resolvedDeliveryOptions.continueSessionId,
      sessionTitle: resolvedDeliveryOptions.continueSessionTitle,
      input: promptContent,
      submit: submitImmediately,
    });

    return true;
  } catch (error) {
    console.warn("Failed to deliver prompt to Continue", error);
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
  fallbackTarget: string | undefined = undefined
): Promise<void> {
  await vscode.env.clipboard.writeText(promptContent);

  if (fallbackTarget) {
    vscode.window.showWarningMessage(
      `Could not deliver prompt "${promptName}" to ${fallbackTarget}. Prompt copied to clipboard instead.`
    );
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
  const deliveryTarget = resolvePromptDeliveryTarget(deliveryOptions);

  if (outputMode === "clipboard") {
    await copyPromptToClipboard(promptName, promptContent);
    return;
  }

  const submitImmediately = outputMode === "chatSubmit";
  const openedChat =
    deliveryTarget === "continue"
      ? await openContinueChat(
          promptContent,
          submitImmediately,
          deliveryOptions
        )
      : deliveryTarget === "claudeCode"
      ? await openClaudeCode(promptContent, submitImmediately)
      : await openCopilotChat(promptContent, submitImmediately);

  if (!openedChat) {
    const fallbackTarget =
      deliveryTarget === "continue"
        ? "Continue"
        : deliveryTarget === "claudeCode"
        ? "Claude Code"
        : "Copilot Chat";
    await copyPromptToClipboard(promptName, promptContent, fallbackTarget);
    return;
  }

  const action = submitImmediately ? "sent to" : "filled in";
  const targetLabel =
    deliveryTarget === "continue"
      ? "Continue"
      : deliveryTarget === "claudeCode"
      ? "Claude Code"
      : "Copilot Chat";
  vscode.window.showInformationMessage(
    `Prompt "${promptName}" ${action} ${targetLabel}.`
  );
}