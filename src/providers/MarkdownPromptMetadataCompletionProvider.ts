import * as vscode from "vscode";

const MD_META_START_REGEX = /^\s*<!--\s*md-meta\s*$/;
const PROMPTO_METADATA_END_REGEX = /^\s*-->\s*$/;
const METADATA_KEY_REGEX = /^\s*([A-Za-z_][A-Za-z0-9_]*)?\s*$/;
const METADATA_VALUE_REGEX =
  /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-zA-Z-]*)$/;
const PROMPT_CONTENT_BLOCK_REGEX = /^\s*promptContent\s*:\s*\|\s*$/;

type PromptMetadataUsage = "mdMeta";

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
    label: "claudeCode",
    detail: "Claude Code",
    documentation: "Deliver the prompt to the active terminal, intended for Claude Code.",
  },
];

// ── md-meta 补全定义 ──

const MD_META_ROOT_KEYS: PromptMetadataKeyDefinition[] = [
  {
    label: "version",
    detail: "Spec version (required)",
    documentation: "Specification version number. Must be 1 for v1.",
    insertText: "version: 1",
  },
  {
    label: "scope",
    detail: "Scope override",
    documentation: "Explicitly set scope: document, node, or action. Usually auto-detected.",
    insertText: new vscode.SnippetString("scope: ${1|document,node,action|}"),
  },
  {
    label: "defaults",
    detail: "Default namespace values",
    documentation: "Default values inherited by lower-scope blocks.",
    insertText: new vscode.SnippetString("defaults:\n\t$0"),
  },
  {
    label: "prompto",
    detail: "Prompto namespace",
    documentation: "Prompt assembly and delivery configuration.",
    insertText: new vscode.SnippetString("prompto:\n\t$0"),
  },
  {
    label: "flow",
    detail: "Flow namespace",
    documentation: "Flow graph structure for visualization.",
    insertText: new vscode.SnippetString("flow:\n\t$0"),
  },
  {
    label: "outline",
    detail: "Outline namespace",
    documentation: "Outline panel display metadata.",
    insertText: new vscode.SnippetString("outline:\n\t$0"),
  },
];

const MD_META_PROMPTO_KEYS: PromptMetadataKeyDefinition[] = [
  {
    label: "prompt",
    detail: "Reference a saved prompt file",
    documentation: "Resolves a prompt markdown file from the configured prompts directory.",
    insertText: new vscode.SnippetString("prompt: ${1:review/code-review}"),
  },
  {
    label: "promptContent",
    detail: "Inline prompt content",
    documentation: "Provides prompt content inline instead of referencing a saved prompt file.",
    insertText: new vscode.SnippetString("promptContent: |\n\t$0"),
  },
  {
    label: "deliveryTarget",
    detail: "Override delivery target",
    documentation: "Overrides the workspace-level prompto.deliveryTarget.",
    insertText: "deliveryTarget: ",
  },
  {
    label: "outputMode",
    detail: "Override output behavior",
    documentation: "Overrides the workspace-level prompto.outputMode.",
    insertText: "outputMode: ",
  },
  {
    label: "title",
    detail: "Action title",
    documentation: "Display title for action-scope prompts.",
    insertText: new vscode.SnippetString("title: ${1:Action Title}"),
  },
];

const MD_META_FLOW_KEYS: PromptMetadataKeyDefinition[] = [
  {
    label: "id",
    detail: "Node/flow id (required for graph nodes)",
    documentation: "Stable identifier for this node or flow.",
    insertText: new vscode.SnippetString("id: ${1:node.id}"),
  },
  {
    label: "title",
    detail: "Flow title",
    documentation: "Display title for the flow graph.",
    insertText: new vscode.SnippetString("title: ${1:Flow Title}"),
  },
  {
    label: "direction",
    detail: "Graph direction",
    documentation: "Layout direction: TB, LR, BT, or RL.",
    insertText: new vscode.SnippetString("direction: ${1|TB,LR,BT,RL|}"),
  },
  {
    label: "entry",
    detail: "Entry node id",
    documentation: "The starting node id for the flow graph.",
    insertText: new vscode.SnippetString("entry: ${1:start.node}"),
  },
  {
    label: "kind",
    detail: "Node kind",
    documentation: "Node type: start, action, decision, or end.",
    insertText: new vscode.SnippetString("kind: ${1|start,action,decision,end|}"),
  },
  {
    label: "next",
    detail: "Default next node",
    documentation: "The default next node id.",
    insertText: new vscode.SnippetString("next: ${1:next.node}"),
  },
  {
    label: "group",
    detail: "Logical group",
    documentation: "Optional logical grouping for this node.",
    insertText: new vscode.SnippetString("group: ${1:group-name}"),
  },
  {
    label: "branches",
    detail: "Decision branches",
    documentation: "Explicit branch definitions for decision nodes.",
    insertText: new vscode.SnippetString("branches:\n\t- label: ${1:Branch Label}\n\t  to: ${2:target.node}"),
  },
];

const MD_META_OUTLINE_KEYS: PromptMetadataKeyDefinition[] = [
  {
    label: "status",
    detail: "Node status",
    documentation: "Status shown in outline panel. Recommended: todo, doing, done, blocked, cancelled.",
    insertText: new vscode.SnippetString("status: ${1|todo,doing,done,blocked,cancelled|}"),
  },
];

const FLOW_KIND_VALUES = [
  { label: "start", detail: "Start node", documentation: "Entry point of the flow." },
  { label: "action", detail: "Action node", documentation: "Executable action step." },
  { label: "decision", detail: "Decision node", documentation: "Branch point with conditions." },
  { label: "end", detail: "End node", documentation: "Terminal point of the flow." },
];

const FLOW_DIRECTION_VALUES = [
  { label: "TB", detail: "Top to bottom", documentation: "Vertical layout, top to bottom." },
  { label: "LR", detail: "Left to right", documentation: "Horizontal layout, left to right." },
  { label: "BT", detail: "Bottom to top", documentation: "Vertical layout, bottom to top." },
  { label: "RL", detail: "Right to left", documentation: "Horizontal layout, right to left." },
];

const OUTLINE_STATUS_VALUES = [
  { label: "todo", detail: "To do", documentation: "Not yet started." },
  { label: "doing", detail: "In progress", documentation: "Currently being worked on." },
  { label: "done", detail: "Done", documentation: "Completed." },
  { label: "blocked", detail: "Blocked", documentation: "Blocked by dependency or issue." },
  { label: "cancelled", detail: "Cancelled", documentation: "No longer needed." },
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

  const mdMetaItem = new vscode.CompletionItem(
    "md-meta",
    vscode.CompletionItemKind.Keyword
  );
  mdMetaItem.detail = "Unified metadata block (v1)";
  mdMetaItem.documentation =
    "Starts a unified metadata block with namespace support (prompto, flow, outline). Recommended for new documents.";
  mdMetaItem.insertText = new vscode.SnippetString(
    "md-meta\nversion: 1\n$0\n-->"
  );
  mdMetaItem.range = replacementRange;

  return [mdMetaItem];
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

    if (MD_META_START_REGEX.test(lineText)) {
      startLine = lineIndex;
      usage = "mdMeta";
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

  return getMetadataKeysForUsage(metadataContext.usage, document, position, metadataContext.startLine).map((definition, index) => {
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

  if (key === "kind") {
    return FLOW_KIND_VALUES.map((definition) => {
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

  if (key === "direction") {
    return FLOW_DIRECTION_VALUES.map((definition) => {
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

  if (key === "status") {
    return OUTLINE_STATUS_VALUES.map((definition) => {
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

  const selectedTextItem = new vscode.CompletionItem(
    "selectedText",
    vscode.CompletionItemKind.Variable
  );
  selectedTextItem.detail = "Prompt variable";
  selectedTextItem.documentation =
    "Injects the selected text or markdown block body into the prompt.";
  selectedTextItem.insertText = "{{selectedText}}";
  items.push(selectedTextItem);

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
  usage: PromptMetadataUsage,
  document?: vscode.TextDocument,
  position?: vscode.Position,
  startLine?: number
): PromptMetadataKeyDefinition[] {
  if (usage === "mdMeta" && document && position && startLine !== undefined) {
    return getMdMetaKeysForIndent(document, position, startLine);
  }

  return MD_META_ROOT_KEYS;
}

function getMdMetaKeysForIndent(
  document: vscode.TextDocument,
  position: vscode.Position,
  startLine: number
): PromptMetadataKeyDefinition[] {
  const startIndent = getIndentLength(document.lineAt(startLine).text);
  const currentIndent = getIndentLength(document.lineAt(position.line).text);

  // 根级：与 md-meta 同缩进
  if (currentIndent <= startIndent) {
    return MD_META_ROOT_KEYS;
  }

  // 命名空间内：向上找到最近的 key，判断属于哪个命名空间
  for (let i = position.line - 1; i > startLine; i--) {
    const line = document.lineAt(i).text;
    const trimmed = line.trimStart();
    const lineIndent = getIndentLength(line);

    // 找到父级缩进的 key
    if (lineIndent < currentIndent && trimmed) {
      const nsMatch = trimmed.match(/^(prompto|flow|outline|defaults)\s*:/);
      if (nsMatch) {
        const ns = nsMatch[1];
        if (ns === "prompto" || ns === "defaults") {
          return MD_META_PROMPTO_KEYS;
        }
        if (ns === "flow") {
          return MD_META_FLOW_KEYS;
        }
        if (ns === "outline") {
          return MD_META_OUTLINE_KEYS;
        }
      }
      break;
    }
  }

  return MD_META_ROOT_KEYS;
}

function getIndentLength(lineText: string): number {
  return lineText.match(/^\s*/)?.[0].length ?? 0;
}