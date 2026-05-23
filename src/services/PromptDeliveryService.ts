import * as vscode from "vscode";

type PromptOutputMode = "chatPrefill" | "chatSubmit" | "clipboard";
type PromptDeliveryTarget = "githubCopilotChat" | "continue";

export interface PromptDeliveryOptions {
  continueSessionId?: string;
  continueSessionTitle?: string;
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

  if (
    configuredMode === "chatPrefill" ||
    configuredMode === "chatSubmit" ||
    configuredMode === "clipboard"
  ) {
    return configuredMode;
  }

  return DEFAULT_PROMPT_OUTPUT_MODE;
}

function getPromptDeliveryTarget(): PromptDeliveryTarget {
  const configuredTarget = vscode.workspace
    .getConfiguration("prompto")
    .get<string>("deliveryTarget", DEFAULT_PROMPT_DELIVERY_TARGET);

  if (
    configuredTarget === "githubCopilotChat" ||
    configuredTarget === "continue"
  ) {
    return configuredTarget;
  }

  return DEFAULT_PROMPT_DELIVERY_TARGET;
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
  const outputMode = getPromptOutputMode();
  const deliveryTarget = getPromptDeliveryTarget();

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
      : await openCopilotChat(promptContent, submitImmediately);

  if (!openedChat) {
    const fallbackTarget =
      deliveryTarget === "continue" ? "Continue" : "Copilot Chat";
    await copyPromptToClipboard(promptName, promptContent, fallbackTarget);
    return;
  }

  const action = submitImmediately ? "sent to" : "filled in";
  const targetLabel =
    deliveryTarget === "continue" ? "Continue" : "Copilot Chat";
  vscode.window.showInformationMessage(
    `Prompt "${promptName}" ${action} ${targetLabel}.`
  );
}