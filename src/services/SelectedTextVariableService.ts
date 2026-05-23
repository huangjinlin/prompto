import * as vscode from "vscode";

export interface SelectedTextVariableContext {
  rawSelectedText: string;
  selectedText: string;
  variables: Record<string, string>;
  promptReference?: string;
  inlinePromptContent?: string;
}

export function getSelectedTextVariableContext(
  editor: vscode.TextEditor | undefined = vscode.window.activeTextEditor
): SelectedTextVariableContext {
  const rawSelectedText =
    editor?.selection && !editor.selection.isEmpty
      ? editor.document.getText(editor.selection)
      : "";

  return parseSelectedTextVariableContext(rawSelectedText);
}

export function parseSelectedTextVariableContext(
  rawSelectedText: string
): SelectedTextVariableContext {
  const normalizedSelection = rawSelectedText.replace(/\r\n/g, "\n");
  const lines = normalizedSelection.split("\n");

  if (lines[0]?.trim() !== "---") {
    return {
      rawSelectedText,
      selectedText: normalizedSelection,
      variables: {},
      promptReference: undefined,
      inlinePromptContent: undefined,
    };
  }

  const closingLineIndex = lines.findIndex(
    (line, index) => index > 0 && line.trim() === "---"
  );

  if (closingLineIndex === -1) {
    return {
      rawSelectedText,
      selectedText: normalizedSelection,
      variables: {},
      promptReference: undefined,
      inlinePromptContent: undefined,
    };
  }

  const variables: Record<string, string> = {};
  const variableLines = lines.slice(1, closingLineIndex);

  for (const line of variableLines) {
    if (!line.trim()) {
      continue;
    }

    const variableMatch = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)\s*$/);
    if (!variableMatch) {
      return {
        rawSelectedText,
        selectedText: normalizedSelection,
        variables: {},
        promptReference: undefined,
        inlinePromptContent: undefined,
      };
    }

    const [, variableName, variableValue] = variableMatch;
    variables[variableName] = variableValue;
  }

  let selectedText = lines.slice(closingLineIndex + 1).join("\n");
  if (selectedText.startsWith("\n")) {
    selectedText = selectedText.slice(1);
  }

  const promptReference = variables.prompt?.trim() || undefined;
  if (promptReference) {
    delete variables.prompt;
  }

  return {
    rawSelectedText,
    selectedText,
    variables,
    promptReference,
    inlinePromptContent: undefined,
  };
}