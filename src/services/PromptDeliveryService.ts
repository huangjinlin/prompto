import * as vscode from "vscode";

type PromptOutputMode = "chatPrefill" | "chatSubmit" | "clipboard";

const DEFAULT_PROMPT_OUTPUT_MODE: PromptOutputMode = "chatPrefill";

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

async function copyPromptToClipboard(
  promptName: string,
  promptContent: string,
  fallback: boolean = false
): Promise<void> {
  await vscode.env.clipboard.writeText(promptContent);

  if (fallback) {
    vscode.window.showWarningMessage(
      `Could not open Copilot Chat. Prompt "${promptName}" copied to clipboard instead.`
    );
    return;
  }

  vscode.window.showInformationMessage(
    `Prompt "${promptName}" copied to clipboard.`
  );
}

export async function deliverPromptContent(
  promptName: string,
  promptContent: string
): Promise<void> {
  const outputMode = getPromptOutputMode();

  if (outputMode === "clipboard") {
    await copyPromptToClipboard(promptName, promptContent);
    return;
  }

  const submitImmediately = outputMode === "chatSubmit";
  const openedChat = await openCopilotChat(promptContent, submitImmediately);

  if (!openedChat) {
    await copyPromptToClipboard(promptName, promptContent, true);
    return;
  }

  const action = submitImmediately ? "sent to" : "filled in";
  vscode.window.showInformationMessage(
    `Prompt "${promptName}" ${action} Copilot Chat.`
  );
}