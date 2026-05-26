import * as vscode from "vscode";

const PROMPTO_METADATA_START_REGEX = /^\s*<!--\s*prompto\s*$/;
const PROMPTO_ACTION_METADATA_START_REGEX =
  /^\s*<!--\s*prompto-action\s*$/;
const PROMPTO_METADATA_END_REGEX = /^\s*-->\s*$/;
const TOP_LEVEL_HEADING_REGEX = /^#\s+.+$/;
const METADATA_KEY_REGEX = /^\s*([A-Za-z_][A-Za-z0-9_]*)?\s*$/;
const METADATA_VALUE_REGEX =
  /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-zA-Z-]*)$/;
const PROMPT_CONTENT_BLOCK_REGEX = /^\s*promptContent\s*:\s*\|\s*$/;

type PromptMetadataUsage = "promptFile" | "promptBlock" | "promptAction";

interface PromptMetadataContext {
  usage: PromptMetadataUsage;
  startLine: number;
  startIndent: number;
  inPromptContentBody: boolean;
}

interface PromptMetadataKeyDefinition {
  label: string;
  detail: string;
  documentation: string;
  insertText: string | vscode.SnippetString;
  kind?: vscode.CompletionItemKind;
}

const OUTPUT_MODE_VALUES = [
  {
    label: "chatPrefill",
    detail: "Fill the target without sending",
    documentation: "Pre-fill the configured target but do not send immediately.",
  },
  {
    label: "chatSubmit",
    detail: "Fill and send immediately",
    documentation: "Fill the configured target and submit immediately.",
  },
  {
    label: "clipboard",
    detail: "Copy to clipboard",
    documentation: "Copy the prompt content to the clipboard instead of opening a chat target.",
  },
];

const DELIVERY_TARGET_VALUES = [
  {
    label: "githubCopilotChat",
    detail: "GitHub Copilot Chat",
    documentation: "Deliver the prompt to GitHub Copilot Chat.",
  },
  {
    label: "continue",
    detail: "Continue",
    documentation: "Deliver the prompt through the Continue integration command.",
  },
  {
    label: "claudeCode",
    detail: "Claude Code",
    documentation: "Deliver the prompt to the active terminal, intended for Claude Code.",
  },
];

const PROMPT_FILE_METADATA_KEYS: PromptMetadataKeyDefinition[] = [
  {
    label: "outputMode",
    detail: "Override output behavior",
    documentation:
      "Overrides the workspace-level prompto.outputMode for this prompt file.",
    insertText: "outputMode: ",
  },
  {
    label: "deliveryTarget",
    detail: "Override delivery target",
    documentation:
      "Overrides the workspace-level prompto.deliveryTarget for this prompt file.",
    insertText: "deliveryTarget: ",
  },
  {
    label: "continueSessionId",
    detail: "Target Continue session ID",
    documentation:
      "Delivers the prompt to a specific Continue session by ID when the target is Continue.",
    insertText: "continueSessionId: ",
  },
  {
    label: "continueSessionTitle",
    detail: "Target Continue session title",
    documentation:
      "Delivers the prompt to a specific Continue session by exact title when the target is Continue.",
    insertText: "continueSessionTitle: ",
  },
];

const PROMPT_BLOCK_METADATA_KEYS: PromptMetadataKeyDefinition[] = [
  {
    label: "prompt",
    detail: "Reference a saved prompt file",
    documentation:
      "Resolves a prompt markdown file from the configured prompts directory.",
    insertText: new vscode.SnippetString("prompt: ${1:review/code-review}"),
  },
  {
    label: "promptContent",
    detail: "Inline prompt content",
    documentation:
      "Provides prompt content inline instead of referencing a saved prompt file.",
    insertText: new vscode.SnippetString("promptContent: |\n\t$0"),
  },
  {
    label: "outputMode",
    detail: "Override output behavior",
    documentation:
      "Overrides the workspace-level prompto.outputMode for this markdown block.",
    insertText: "outputMode: ",
  },
  {
    label: "deliveryTarget",
    detail: "Override delivery target",
    documentation:
      "Overrides the workspace-level prompto.deliveryTarget for this markdown block.",
    insertText: "deliveryTarget: ",
  },
  {
    label: "continueSessionId",
    detail: "Target Continue session ID",
    documentation:
      "Delivers the block prompt to a specific Continue session by ID.",
    insertText: "continueSessionId: ",
  },
  {
    label: "continueSessionTitle",
    detail: "Target Continue session title",
    documentation:
      "Delivers the block prompt to a specific Continue session by exact title.",
    insertText: "continueSessionTitle: ",
  },
  {
    label: "customVariable",
    detail: "Example custom variable",
    documentation:
      "Any other key can be used as a custom variable value for placeholders like {{customVariable}}.",
    insertText: new vscode.SnippetString("${1:customVariable}: ${2:value}"),
    kind: vscode.CompletionItemKind.Snippet,
  },
];

const PROMPT_ACTION_METADATA_KEYS: PromptMetadataKeyDefinition[] = [
  {
    label: "title",
    detail: "CodeLens title",
    documentation:
      "Required for prompto-action. The CodeLens text is taken directly from this title.",
    insertText: "title: ",
  },
  {
    label: "prompt",
    detail: "Reference a saved prompt file",
    documentation:
      "Resolves a prompt markdown file from the configured prompts directory.",
    insertText: new vscode.SnippetString("prompt: ${1:review/code-review}"),
  },
  {
    label: "promptContent",
    detail: "Inline prompt content",
    documentation:
      "Provides prompt content inline instead of referencing a saved prompt file.",
    insertText: new vscode.SnippetString("promptContent: |\n\t$0"),
  },
  {
    label: "outputMode",
    detail: "Override output behavior",
    documentation:
      "Overrides the workspace-level prompto.outputMode for this prompto-action.",
    insertText: "outputMode: ",
  },
  {
    label: "deliveryTarget",
    detail: "Override delivery target",
    documentation:
      "Overrides the workspace-level prompto.deliveryTarget for this prompto-action.",
    insertText: "deliveryTarget: ",
  },
  {
    label: "continueSessionId",
    detail: "Target Continue session ID",
    documentation:
      "Delivers this action to a specific Continue session by ID.",
    insertText: "continueSessionId: ",
  },
  {
    label: "continueSessionTitle",
    detail: "Target Continue session title",
    documentation:
      "Delivers this action to a specific Continue session by exact title.",
    insertText: "continueSessionTitle: ",
  },
  {
    label: "customVariable",
    detail: "Example custom variable",
    documentation:
      "Any other key can be used as a custom variable value for placeholders like {{customVariable}}.",
    insertText: new vscode.SnippetString("${1:customVariable}: ${2:value}"),
    kind: vscode.CompletionItemKind.Snippet,
  },
];

export class MarkdownPromptMetadataCompletionProvider
  implements vscode.CompletionItemProvider
{
  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.ProviderResult<vscode.CompletionItem[]> {
    const blockStartItems = getMetadataStartCompletionItems(document, position);
    if (blockStartItems.length > 0) {
      return blockStartItems;
    }

    const metadataContext = getPromptMetadataContext(document, position);
    if (!metadataContext) {
      return undefined;
    }

    if (metadataContext.inPromptContentBody) {
      return getPromptVariableCompletionItems(metadataContext.usage);
    }

    const valueCompletionItems = getMetadataValueCompletionItems(
      document,
      position
    );
    if (valueCompletionItems.length > 0) {
      return valueCompletionItems;
    }

    return getMetadataKeyCompletionItems(document, position, metadataContext);
  }
}

function getMetadataStartCompletionItems(
  document: vscode.TextDocument,
  position: vscode.Position
): vscode.CompletionItem[] {
  const linePrefix = document.lineAt(position.line).text.slice(0, position.character);
  const startMatch = linePrefix.match(/^\s*<!--\s*([A-Za-z-]*)$/);

  if (!startMatch) {
    return [];
  }

  const partialKeyword = startMatch[1] ?? "";
  const replacementRange = new vscode.Range(
    position.line,
    position.character - partialKeyword.length,
    position.line,
    position.character
  );

  const promptoItem = new vscode.CompletionItem(
    "prompto",
    vscode.CompletionItemKind.Keyword
  );
  promptoItem.detail = "Prompto metadata block";
  promptoItem.documentation =
    "Starts a Prompto metadata block for a prompt file or heading-based markdown block.";
  promptoItem.insertText = "prompto";
  promptoItem.range = replacementRange;

  const promptoActionItem = new vscode.CompletionItem(
    "prompto-action",
    vscode.CompletionItemKind.Keyword
  );
  promptoActionItem.detail = "Prompto action metadata block";
  promptoActionItem.documentation =
    "Starts a prompto-action metadata block for a body CodeLens action.";
  promptoActionItem.insertText = "prompto-action";
  promptoActionItem.range = replacementRange;

  return [promptoItem, promptoActionItem];
}

function getPromptMetadataContext(
  document: vscode.TextDocument,
  position: vscode.Position
): PromptMetadataContext | undefined {
  const currentLineText = document.lineAt(position.line).text;
  if (PROMPTO_METADATA_END_REGEX.test(currentLineText.trim())) {
    return undefined;
  }

  let startLine: number | undefined;
  let usage: PromptMetadataUsage | undefined;

  for (let lineIndex = position.line; lineIndex >= 0; lineIndex--) {
    const lineText = document.lineAt(lineIndex).text;

    if (lineIndex < position.line && PROMPTO_METADATA_END_REGEX.test(lineText.trim())) {
      return undefined;
    }

    if (PROMPTO_ACTION_METADATA_START_REGEX.test(lineText)) {
      startLine = lineIndex;
      usage = "promptAction";
      break;
    }

    if (PROMPTO_METADATA_START_REGEX.test(lineText)) {
      startLine = lineIndex;
      usage = inferPromptoMetadataUsage(document, lineIndex);
      break;
    }
  }

  if (startLine === undefined || !usage) {
    return undefined;
  }

  for (let lineIndex = startLine + 1; lineIndex < position.line; lineIndex++) {
    if (PROMPTO_METADATA_END_REGEX.test(document.lineAt(lineIndex).text.trim())) {
      return undefined;
    }
  }

  return {
    usage,
    startLine,
    startIndent: getIndentLength(document.lineAt(startLine).text),
    inPromptContentBody: isInPromptContentBody(document, position, startLine),
  };
}

function inferPromptoMetadataUsage(
  document: vscode.TextDocument,
  startLine: number
): PromptMetadataUsage {
  const nonEmptyLinesBeforeStart: string[] = [];

  for (let lineIndex = 0; lineIndex < startLine; lineIndex++) {
    const lineText = document.lineAt(lineIndex).text.trim();
    if (lineText) {
      nonEmptyLinesBeforeStart.push(lineText);
    }
  }

  if (
    nonEmptyLinesBeforeStart.length === 0 ||
    (nonEmptyLinesBeforeStart.length === 1 &&
      TOP_LEVEL_HEADING_REGEX.test(nonEmptyLinesBeforeStart[0]))
  ) {
    return "promptFile";
  }

  return "promptBlock";
}

function isInPromptContentBody(
  document: vscode.TextDocument,
  position: vscode.Position,
  startLine: number
): boolean {
  for (let lineIndex = position.line; lineIndex > startLine; lineIndex--) {
    const lineText = document.lineAt(lineIndex).text;

    if (!lineText.trim()) {
      continue;
    }

    const promptContentMatch = lineText.match(PROMPT_CONTENT_BLOCK_REGEX);
    if (!promptContentMatch) {
      const metadataKeyMatch = lineText.match(/^\s*[A-Za-z_][A-Za-z0-9_]*\s*:/);
      if (metadataKeyMatch) {
        return false;
      }

      continue;
    }

    const promptContentIndent = getIndentLength(lineText);
    const currentLineIndent = getIndentLength(document.lineAt(position.line).text);
    return position.line > lineIndex && currentLineIndent > promptContentIndent;
  }

  return false;
}

function getMetadataKeyCompletionItems(
  document: vscode.TextDocument,
  position: vscode.Position,
  metadataContext: PromptMetadataContext
): vscode.CompletionItem[] {
  const linePrefix = document.lineAt(position.line).text.slice(0, position.character);
  const keyMatch = linePrefix.match(METADATA_KEY_REGEX);

  if (!keyMatch) {
    return [];
  }

  const partialKey = keyMatch[1] ?? "";
  const replacementRange = new vscode.Range(
    position.line,
    position.character - partialKey.length,
    position.line,
    position.character
  );

  return getMetadataKeysForUsage(metadataContext.usage).map((definition, index) => {
    const item = new vscode.CompletionItem(
      definition.label,
      definition.kind ?? vscode.CompletionItemKind.Property
    );

    item.detail = definition.detail;
    item.documentation = definition.documentation;
    item.insertText = definition.insertText;
    item.range = replacementRange;
    item.sortText = `${index.toString().padStart(2, "0")}-${definition.label}`;
    return item;
  });
}

function getMetadataValueCompletionItems(
  document: vscode.TextDocument,
  position: vscode.Position
): vscode.CompletionItem[] {
  const linePrefix = document.lineAt(position.line).text.slice(0, position.character);
  const valueMatch = linePrefix.match(METADATA_VALUE_REGEX);

  if (!valueMatch) {
    return [];
  }

  const [, key, partialValue] = valueMatch;
  const replacementRange = new vscode.Range(
    position.line,
    position.character - partialValue.length,
    position.line,
    position.character
  );

  if (key === "outputMode") {
    return OUTPUT_MODE_VALUES.map((definition) => {
      const item = new vscode.CompletionItem(
        definition.label,
        vscode.CompletionItemKind.EnumMember
      );
      item.detail = definition.detail;
      item.documentation = definition.documentation;
      item.insertText = definition.label;
      item.range = replacementRange;
      return item;
    });
  }

  if (key === "deliveryTarget") {
    return DELIVERY_TARGET_VALUES.map((definition) => {
      const item = new vscode.CompletionItem(
        definition.label,
        vscode.CompletionItemKind.EnumMember
      );
      item.detail = definition.detail;
      item.documentation = definition.documentation;
      item.insertText = definition.label;
      item.range = replacementRange;
      return item;
    });
  }

  return [];
}

function getPromptVariableCompletionItems(
  usage: PromptMetadataUsage
): vscode.CompletionItem[] {
  const items: vscode.CompletionItem[] = [];

  if (usage !== "promptAction") {
    const selectedTextItem = new vscode.CompletionItem(
      "selectedText",
      vscode.CompletionItemKind.Variable
    );
    selectedTextItem.detail = "Prompt variable";
    selectedTextItem.documentation =
      "Injects the selected text or markdown block body into the prompt.";
    selectedTextItem.insertText = "{{selectedText}}";
    items.push(selectedTextItem);
  }

  const fileNameItem = new vscode.CompletionItem(
    "fileName",
    vscode.CompletionItemKind.Variable
  );
  fileNameItem.detail = "Prompt variable";
  fileNameItem.documentation =
    "Injects the current file name into the prompt.";
  fileNameItem.insertText = "{{fileName}}";
  items.push(fileNameItem);

  const customVariableItem = new vscode.CompletionItem(
    "customVariable",
    vscode.CompletionItemKind.Snippet
  );
  customVariableItem.detail = "Prompt variable template";
  customVariableItem.documentation =
    "Custom variables will prompt for input unless a value is provided in metadata or selected-text headers.";
  customVariableItem.insertText = new vscode.SnippetString("{{${1:customVariable}}}");
  items.push(customVariableItem);

  return items;
}

function getMetadataKeysForUsage(
  usage: PromptMetadataUsage
): PromptMetadataKeyDefinition[] {
  if (usage === "promptFile") {
    return PROMPT_FILE_METADATA_KEYS;
  }

  if (usage === "promptAction") {
    return PROMPT_ACTION_METADATA_KEYS;
  }

  return PROMPT_BLOCK_METADATA_KEYS;
}

function getIndentLength(lineText: string): number {
  return lineText.match(/^\s*/)?.[0].length ?? 0;
}