import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { MarkdownPromptCodeLensProvider } from "./providers/MarkdownPromptCodeLensProvider";
import { MarkdownPromptMetadataCompletionProvider } from "./providers/MarkdownPromptMetadataCompletionProvider";
import { PromptTreeProvider } from "./providers/PromptTreeProvider";
import {
  deliverPromptContent,
  getDocumentPromptDeliveryOptions,
  parsePromptDeliveryTarget,
  parsePromptOutputMode,
  prefillActiveTerminal,
  PromptDeliveryOptions,
  PromptDeliveryTarget,
  PromptOutputMode,
} from "./services/PromptDeliveryService";
import {
  getPromptDirectoryPath,
  getPromptDirectorySetting,
} from "./services/PromptDirectoryService";
import {
  getSelectedTextVariableContext,
  SelectedTextVariableContext,
} from "./services/SelectedTextVariableService";
import {
  findPromptoMetaForHeading,
  findPromptoMetaForAction,
  getDocumentLines,
  getHeadingText,
  getNodeBody,
  buildSelectedTextContextFromPrompto,
} from "./services/MarkdownMetaBridgeService";
import { parseMarkdownMetaDocument } from "./services/MarkdownMetaParserService";
import { PromptFlowWebviewProvider } from "./webview/PromptFlowWebviewProvider";
import { resolveSelectionPathTemplates } from "./services/SelectionPathTemplateService";
import { resolveSelectionVariables } from "./services/SelectionVariableService";
import { getMarkdownSections } from "./services/MarkdownSectionService";

let treeProvider: PromptTreeProvider;

const MD_META_FILE_METADATA_START_REGEX = /^\s*<!--\s*md-meta\s*$/;
const COMMENT_END_REGEX = /^\s*-->\s*$/;

interface PromptExecutionContext {
  promptName?: string;
  sourceDocument?: vscode.TextDocument;
  selectedTextContext?: SelectedTextVariableContext;
  deliveryOptions?: PromptDeliveryOptions;
  promptHandler?: PromptHandler;
  suppressNoSelectedTextPrompt?: boolean;
  workspaceFolder?: vscode.WorkspaceFolder;
}

interface ParsedPromptFile {
  content: string;
  deliveryOptions: PromptDeliveryOptions;
}

type PromptHandler = (
  promptName: string,
  promptContent: string,
  deliveryOptions?: PromptDeliveryOptions
) => Promise<void>;

function getPromptDocumentContent(
  filePath: string,
  sourceDocument?: vscode.TextDocument
): string {
  const matchingDocument =
    sourceDocument?.uri.fsPath === filePath
      ? sourceDocument
      : vscode.workspace.textDocuments.find(
          (document) => document.uri.fsPath === filePath
        );

  if (matchingDocument) {
    return matchingDocument.getText().replace(/\r\n/g, "\n");
  }

  return fs.readFileSync(filePath, "utf8").replace(/\r\n/g, "\n");
}

function normalizePromptMetadataValue(
  value: string | undefined
): string | undefined {
  const trimmedValue = value?.trim();
  return trimmedValue ? trimmedValue : undefined;
}

function parsePromptMetadataDeliveryTarget(
  value: string | undefined
): PromptDeliveryTarget | undefined {
  const normalizedValue = normalizePromptMetadataValue(value);
  const deliveryTarget = parsePromptDeliveryTarget(normalizedValue);

  if (!deliveryTarget && normalizedValue) {
    throw new Error(
      `Invalid Prompto deliveryTarget: ${normalizedValue}. Use githubCopilotChat, qoder or claudeCode.`
    );
  }

  return deliveryTarget;
}

function parsePromptMetadataOutputMode(
  value: string | undefined
): PromptOutputMode | undefined {
  const normalizedValue = normalizePromptMetadataValue(value);
  const outputMode = parsePromptOutputMode(normalizedValue);

  if (!outputMode && normalizedValue) {
    throw new Error(
      `Invalid Prompto outputMode: ${normalizedValue}. Use chatPrefill, chatSubmit, or clipboard.`
    );
  }

  return outputMode;
}

function mergePromptDeliveryOptions(
  promptFileDeliveryOptions: PromptDeliveryOptions,
  executionContextDeliveryOptions: PromptDeliveryOptions = {}
): PromptDeliveryOptions {
  const outputMode =
    executionContextDeliveryOptions.outputMode ??
    promptFileDeliveryOptions.outputMode;

  const deliveryTarget =
    executionContextDeliveryOptions.deliveryTarget ??
    promptFileDeliveryOptions.deliveryTarget;
  const chatSession = executionContextDeliveryOptions.chatSession ?? promptFileDeliveryOptions.chatSession;

  return {
    outputMode,
    deliveryTarget,
    ...(chatSession ? { chatSession } : {}),
  };
}

export function activate(context: vscode.ExtensionContext) {
  console.log("🚀 Prompto extension is now active!");

  treeProvider = new PromptTreeProvider();
  vscode.window.registerTreeDataProvider("promptoTree", treeProvider);
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      { language: "markdown" },
      new MarkdownPromptCodeLensProvider()
    )
  );
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      { language: "markdown" },
      new MarkdownPromptMetadataCompletionProvider(),
      " ",
      ":",
      "p",
      "d",
      "o",
      "c",
      "t",
      "-"
    )
  );
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("prompto.promptsDirectory")) {
        treeProvider.refresh();
      }
    })
  );

  // 注册 Flow 面板
  const flowProvider = new PromptFlowWebviewProvider(context.extensionUri, context.workspaceState);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      PromptFlowWebviewProvider.viewType,
      flowProvider
    )
  );

  // 监听文档保存，如果保存的是 pinned 文件则刷新侧边栏
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((document) => {
      flowProvider.refreshIfPinned(document);
    })
  );

  registerCommands(context);

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(updateSectionContext),
    vscode.window.onDidChangeTextEditorSelection(event => updateSectionContext(event.textEditor)),
    vscode.workspace.onDidChangeTextDocument(event => {
      const editor = vscode.window.activeTextEditor;
      if (editor?.document === event.document) {
        updateSectionContext(editor);
      }
    })
  );
  updateSectionContext(vscode.window.activeTextEditor);
}

function updateSectionContext(editor: vscode.TextEditor | undefined): void {
  if (editor !== vscode.window.activeTextEditor) {
    return;
  }
  let available = false;
  try {
    if (editor?.document.languageId === "markdown" && editor.selection.isEmpty) {
      const line = editor.selection.active.line;
      available = getMarkdownSections(getDocumentLines(editor.document)).some(section =>
        line >= section.line && line < section.endLine);
    }
  } catch {
    available = false;
  }
  void vscode.commands.executeCommand("setContext", "prompto.sectionAvailable", available);
}

export function deactivate() {
  console.log("👋 Prompto extension is now deactivated!");
}

function registerCommands(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "prompto.usePrompt",
      async (promptPath?: string) => {
        if (promptPath) {
          await usePrompt(promptPath);
        } else {
          await showPromptPicker();
        }
      }
    ),

    vscode.commands.registerCommand(
      "prompto.prefillActiveTerminal",
      async (promptPath?: string) => {
        if (promptPath) {
          await usePrompt(promptPath, {
            promptHandler: prefillActiveTerminal,
          });
        } else {
          await showPromptPicker({
            promptHandler: prefillActiveTerminal,
          });
        }
      }
    ),

    vscode.commands.registerCommand(
      "prompto.runMarkdownBlock",
      async (documentUri: vscode.Uri, headingLine: number) => {
        await runMarkdownPromptBlock(documentUri, headingLine);
      }
    ),

    vscode.commands.registerCommand(
      "prompto.runMarkdownAction",
      async (documentUri: vscode.Uri, anchorLine: number) => {
        await runMarkdownPromptAction(documentUri, anchorLine);
      }
    ),

    vscode.commands.registerCommand(
      "prompto.runMarkdownSection",
      async (documentUri: vscode.Uri, headingLine: number, outputMode: PromptOutputMode) => {
        try {
          if (!parsePromptOutputMode(outputMode)) {
            throw new Error("Invalid section output mode.");
          }
          const document = await vscode.workspace.openTextDocument(documentUri);
          await sendSelectionToChat(outputMode, { document, headingLine });
        } catch (error) {
          vscode.window.showErrorMessage(`Cannot run section: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    ),

    vscode.commands.registerCommand(
      "prompto.addPrompt",
      async (categoryPath?: string) => {
        await showAddPromptDialog(categoryPath);
      }
    ),

    vscode.commands.registerCommand("prompto.showFlow", async () => {
      await vscode.commands.executeCommand("prompto.flowView.focus");
    }),

    vscode.commands.registerCommand(
      "prompto.sendSelectionToChat",
      async () => {
        await sendSelectionToChat("chatSubmit");
      }
    ),

    vscode.commands.registerCommand(
      "prompto.prefillSelectionToChat",
      async () => {
        await sendSelectionToChat("chatPrefill");
      }
    ),

    vscode.commands.registerCommand(
      "prompto.copySelectionToClipboard",
      async () => {
        await sendSelectionToChat("clipboard");
      }
    )
  );
}

async function showPromptPicker(
  executionContext: PromptExecutionContext = {}
): Promise<void> {
  try {
    const selectedTextContext =
      executionContext.selectedTextContext ?? getSelectedTextVariableContext();

    if (selectedTextContext.inlinePromptContent) {
      await executePromptContent(
        executionContext.promptName ?? "Markdown Block",
        selectedTextContext.inlinePromptContent,
        {},
        executionContext
      );
      return;
    }

    const workspaceFolder =
      executionContext.workspaceFolder ??
      (executionContext.sourceDocument
        ? vscode.workspace.getWorkspaceFolder(executionContext.sourceDocument.uri)
        : undefined) ??
      vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      vscode.window.showErrorMessage("No workspace folder found");
      return;
    }

    const promptoDir = getPromptDirectoryPath(workspaceFolder);
    if (!fs.existsSync(promptoDir)) {
      const action = await vscode.window.showInformationMessage(
        `Prompt directory not found: ${getPromptDirectorySetting()} (${promptoDir})`,
        "Create Directory",
        "Open Settings"
      );

      if (action === "Create Directory") {
        fs.mkdirSync(promptoDir, { recursive: true });
        treeProvider.refresh();
        vscode.window.showInformationMessage(
          "Prompt directory created. Use 'Prompto: Add New Prompt' to create your first prompt."
        );
      } else if (action === "Open Settings") {
        await vscode.commands.executeCommand(
          "workbench.action.openSettings",
          "prompto.promptsDirectory"
        );
      }

      return;
    }

    await navigatePromptDirectoryWithGlobalSearch(
      promptoDir,
      "",
      executionContext
    );
  } catch (error) {
    vscode.window.showErrorMessage(`Error showing prompt picker: ${error}`);
  }
}

function getAllPromptsRecursive(
  dir: string,
  relativeBase: string = ""
): Array<{ label: string; detail: string; promptPath: string }> {
  let results: Array<{ label: string; detail: string; promptPath: string }> =
    [];
  const items = fs.readdirSync(dir);
  for (const item of items) {
    const itemPath = path.join(dir, item);
    const relPath = relativeBase ? path.join(relativeBase, item) : item;
    if (fs.statSync(itemPath).isDirectory()) {
      results = results.concat(getAllPromptsRecursive(itemPath, relPath));
    } else if (item.endsWith(".md")) {
      results.push({
        label: path.basename(item, ".md"),
        detail: relPath,
        promptPath: itemPath,
      });
    }
  }
  return results;
}

async function navigatePromptDirectoryWithGlobalSearch(
  currentPath: string,
  relativePath: string,
  executionContext: PromptExecutionContext = {}
): Promise<void> {
  try {
    const allPrompts = getAllPromptsRecursive(currentPath, relativePath).map(
      (p) => ({
        label: `$(file-text) ${p.label}`,
        description: undefined,
        detail: p.detail,
        promptPath: p.promptPath,
        isDirectory: false,
        isBack: false,
      })
    );

    const items = fs.readdirSync(currentPath);
    const quickPickItems: Array<{
      label: string;
      description?: string;
      detail?: string;
      isDirectory?: boolean;
      promptPath?: string;
      directoryPath?: string;
      isBack?: boolean;
    }> = [];

    if (relativePath !== "") {
      quickPickItems.push({
        label: "$(arrow-left) Back",
        description: "Go back to parent directory",
        detail: "Navigate back",
        isBack: true,
      });
    }

    const directories = items
      .filter((item) => {
        const itemPath = path.join(currentPath, item);
        return fs.statSync(itemPath).isDirectory();
      })
      .sort();

    directories.forEach((dir) => {
      quickPickItems.push({
        label: `$(folder) ${dir}`,
        description: "Directory",
        detail: `Navigate to ${path.join(relativePath, dir) || dir}`,
        isDirectory: true,
        directoryPath: path.join(currentPath, dir),
      });
    });

    const files = items
      .filter((item) => {
        const itemPath = path.join(currentPath, item);
        return fs.statSync(itemPath).isFile() && item.endsWith(".md");
      })
      .sort();

    files.forEach((file) => {
      const name = path.basename(file, ".md");
      const fileRelativePath = relativePath
        ? path.join(relativePath, file)
        : file;
      quickPickItems.push({
        label: `$(file-text) ${name}`,
        description: "Prompt",
        detail: `Use prompt: ${fileRelativePath}`,
        promptPath: path.join(currentPath, file),
      });
    });

    const breadcrumb = relativePath ? `/${relativePath}` : "/";
    const title = `Prompto Navigator${breadcrumb}`;

    const quickPick = vscode.window.createQuickPick();
    quickPick.title = title;
    quickPick.placeholder = "Select a prompt to use or navigate to a directory";
    quickPick.matchOnDescription = true;
    quickPick.matchOnDetail = true;
    quickPick.items = quickPickItems;

    quickPick.onDidChangeValue((value) => {
      if (value.trim() === "") {
        quickPick.items = quickPickItems;
      } else {
        const filter = value.toLowerCase();
        quickPick.items = allPrompts.filter(
          (item) =>
            item.label.toLowerCase().includes(filter) ||
            (item.detail && item.detail.toLowerCase().includes(filter))
        );
      }
    });

    quickPick.onDidAccept(async () => {
      const selected = quickPick.selectedItems[0];
      quickPick.hide();
      if (!selected) return;
      if ((selected as any).isBack) {
        const parentPath = path.dirname(currentPath);
        const parentRelativePath = path.dirname(relativePath);
        await navigatePromptDirectoryWithGlobalSearch(
          parentPath,
          parentRelativePath === "." ? "" : parentRelativePath,
          executionContext
        );
      } else if (
        (selected as any).isDirectory &&
        (selected as any).directoryPath
      ) {
        const newRelativePath = relativePath
          ? path.join(
              relativePath,
              path.basename((selected as any).directoryPath)
            )
          : path.basename((selected as any).directoryPath);
        await navigatePromptDirectoryWithGlobalSearch(
          (selected as any).directoryPath,
          newRelativePath,
          executionContext
        );
      } else if ((selected as any).promptPath) {
        await usePrompt((selected as any).promptPath, executionContext);
      }
    });

    quickPick.onDidHide(() => quickPick.dispose());
    quickPick.show();
  } catch (error) {
    vscode.window.showErrorMessage(`Error navigating directory: ${error}`);
  }
}

function parsePromptFileMetadata(lines: string[]):
  | {
      startLine: number;
      endLine: number;
      outputMode?: string;
      deliveryTarget?: string;
      chatSession?: PromptDeliveryOptions["chatSession"];
    }
  | undefined {
  let metadataStartLine = 0;

  if (lines[metadataStartLine]?.startsWith("# ")) {
    metadataStartLine += 1;
  }

  while (
    metadataStartLine < lines.length &&
    !lines[metadataStartLine].trim()
  ) {
    metadataStartLine += 1;
  }

  if (metadataStartLine >= lines.length) {
    return undefined;
  }

  if (!MD_META_FILE_METADATA_START_REGEX.test(lines[metadataStartLine])) {
    return undefined;
  }

  let metadataEndLine = -1;
  for (let i = metadataStartLine + 1; i < lines.length; i++) {
    if (COMMENT_END_REGEX.test(lines[i])) {
      metadataEndLine = i;
      break;
    }
  }

  if (metadataEndLine < 0) {
    throw new Error("Unterminated md-meta metadata block. Add --> to close it.");
  }

  const parsed = parseMarkdownMetaDocument(lines);
  const prompto = parsed.document.namespaces.prompto;

  return {
    startLine: metadataStartLine,
    endLine: metadataEndLine,
    outputMode: prompto?.outputMode,
    deliveryTarget: prompto?.deliveryTarget,
    chatSession: prompto?.chatSession,
  };
}

function getPromptFile(
  filePath: string,
  sourceDocument?: vscode.TextDocument
): ParsedPromptFile {
  const content = getPromptDocumentContent(filePath, sourceDocument);
  const lines = content.split("\n");
  const metadata = parsePromptFileMetadata(lines);
  let promptContent = "";
  let inComment = false;

  for (const [lineIndex, line] of lines.entries()) {
    if (line.startsWith("# ")) {
      continue;
    }

    if (
      metadata &&
      lineIndex >= metadata.startLine &&
      lineIndex <= metadata.endLine
    ) {
      continue;
    }

    if (line.includes("<!--")) {
      inComment = true;
    }
    if (line.includes("-->")) {
      inComment = false;
      continue;
    }

    if (!inComment && !line.startsWith("Write your prompt content here...")) {
      promptContent += line + "\n";
    }
  }

  return {
    content: promptContent.trim(),
    deliveryOptions: {
      outputMode: parsePromptMetadataOutputMode(metadata?.outputMode),
      deliveryTarget: parsePromptMetadataDeliveryTarget(metadata?.deliveryTarget),
      ...(metadata?.chatSession ? { chatSession: metadata.chatSession } : {}),
    },
  };
}

async function processPromptVariables(
  content: string,
  executionContext: PromptExecutionContext = {}
): Promise<string | null> {
  try {
    let processedContent: string = content;
    const editor = vscode.window.activeTextEditor;
    const selectedTextContext =
      executionContext.selectedTextContext ?? getSelectedTextVariableContext(editor);
    const sourceDocument = executionContext.sourceDocument ?? editor?.document;

    // Handle selectedText
    if (content.includes("{{selectedText}}")) {
      const selectedText = selectedTextContext.selectedText;

      if (!selectedText && !executionContext.suppressNoSelectedTextPrompt) {
        const useEmpty = await vscode.window.showQuickPick(
          ["Use empty value", "Cancel"],
          {
            title: "No text selected",
            placeHolder:
              "The prompt contains {{selectedText}} but no text is selected",
          }
        );

        if (useEmpty !== "Use empty value") {
          return null;
        }
      }

      processedContent = processedContent.replace(
        /\{\{selectedText\}\}/g,
        selectedText
      );
    }

    // Handle fileName
    if (content.includes("{{fileName}}")) {
      const fileName = sourceDocument?.fileName
        ? path.basename(sourceDocument.fileName)
        : "";
      processedContent = processedContent.replace(
        /\{\{fileName\}\}/g,
        fileName
      );
    }

    // Find all custom variables (excluding selectedText and fileName)
    const customVariables = content.match(/\{\{(\w+)\}\}/g);
    if (customVariables) {
      // Deduplicate variable names
      const uniqueVars = Array.from(
        new Set(
          customVariables
            .map((variable) => variable.replace(/\{\{|\}\}/g, ""))
            .filter(
              (varName) => varName !== "selectedText" && varName !== "fileName"
            )
        )
      );

      // Prompt for each unique variable
      for (const varName of uniqueVars) {
        const providedValue = selectedTextContext.variables[varName];
        if (providedValue !== undefined) {
          processedContent = processedContent.replace(
            new RegExp(`\\{\\{${varName}\\}\\}`, "g"),
            providedValue
          );
          continue;
        }

        const value = await vscode.window.showInputBox({
          title: `Variable: ${varName}`,
          placeHolder: `Enter value for ${varName}`,
          prompt: `The prompt contains a variable {{${varName}}}. What value should be used?`,
        });

        if (value === undefined) {
          return null;
        }

        processedContent = processedContent.replace(
          new RegExp(`\\{\\{${varName}\\}\\}`, "g"),
          value || ""
        );
      }
    }

    return processedContent;
  } catch (error) {
    vscode.window.showErrorMessage(`Error processing variables: ${error}`);
    return null;
  }
}

async function executePromptContent(
  promptName: string,
  content: string,
  promptDeliveryOptions: PromptDeliveryOptions = {},
  executionContext: PromptExecutionContext = {}
): Promise<void> {
  if (!content) {
    vscode.window.showErrorMessage("Prompt is empty");
    return;
  }

  let processedContent: string = content;
  if (content.includes("{{")) {
    const result = await processPromptVariables(content, executionContext);
    if (result === null) {
      return;
    }
    processedContent = result;
  }

  const promptHandler = executionContext.promptHandler ?? deliverPromptContent;

  await promptHandler(
    promptName,
    processedContent,
    mergePromptDeliveryOptions(
      promptDeliveryOptions,
      executionContext.deliveryOptions
    )
  );
}

async function usePrompt(
  promptPath: string,
  executionContext: PromptExecutionContext = {}
): Promise<void> {
  try {
    const promptName = path.basename(promptPath, ".md");
    const promptFile = getPromptFile(
      promptPath,
      executionContext.sourceDocument
    );
    await executePromptContent(
      promptName,
      promptFile.content,
      promptFile.deliveryOptions,
      executionContext
    );
  } catch (error) {
    vscode.window.showErrorMessage(`Error using prompt: ${error}`);
  }
}

async function showAddPromptDialog(categoryPath?: string): Promise<void> {
  try {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      vscode.window.showErrorMessage(
        "No workspace folder found. Please open a project first."
      );
      return;
    }

    const promptName = await vscode.window.showInputBox({
      title: "New Prompt",
      placeHolder: "Enter prompt name",
      prompt: "What would you like to name this prompt?",
      validateInput: (input: string) => {
        return input.trim() ? null : "Prompt name is required";
      },
    });

    if (!promptName) return;

    const promptoDir = getPromptDirectoryPath(workspaceFolder);
    let targetDir = promptoDir;

    if (categoryPath) {
      const relativePath = path.relative(promptoDir, categoryPath);
      targetDir = path.join(promptoDir, relativePath);
    }

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const fileName = `${promptName
      .replace(/[^a-zA-Z0-9\s]/g, "")
      .replace(/\s+/g, "-")
      .toLowerCase()}.md`;
    const filePath = path.join(targetDir, fileName);

    if (fs.existsSync(filePath)) {
      const overwrite = await vscode.window.showWarningMessage(
        `A prompt named "${promptName}" already exists. Do you want to overwrite it?`,
        { modal: true },
        "Overwrite"
      );
      if (!overwrite) return;
    }

    const templateContent = `# ${promptName}

Write your prompt content here...

<!-- Instructions (will be ignored when using the prompt):
- Use multiple lines naturally
- Optional prompt-level metadata can be added above the body like:
- <!-- md-meta
-   version: 1
-   prompto:
-     outputMode: chatSubmit
-     deliveryTarget: githubCopilotChat
- -->
  - outputMode overrides User Settings for this prompt only
  - deliveryTarget overrides User Settings for this prompt only
- Add {{selectedText}} for dynamic content
- You can define selected-text variables with a header block like:
- ---
- codeAspect: performance
- ---
- Be specific and detailed
- Save the file when finished
-->
`;

    fs.writeFileSync(filePath, templateContent, "utf8");

    const doc = await vscode.workspace.openTextDocument(filePath);
    const editor = await vscode.window.showTextDocument(doc, {
      preview: false,
      viewColumn: vscode.ViewColumn.One,
    });

    const position = new vscode.Position(2, 0);
    editor.selection = new vscode.Selection(position, position);

    treeProvider.refresh();
  } catch (error) {
    vscode.window.showErrorMessage(`Error creating prompt: ${error}`);
  }
}

async function runMarkdownPromptBlock(
  documentUri: vscode.Uri,
  headingLine: number
): Promise<void> {
  try {
    const sourceDocument = await vscode.workspace.openTextDocument(documentUri);

    const workspaceFolder =
      vscode.workspace.getWorkspaceFolder(sourceDocument.uri) ??
      vscode.workspace.workspaceFolders?.[0];

    const lines = getDocumentLines(sourceDocument);
    const prompto = findPromptoMetaForHeading(lines, headingLine);
    const documentDelivery = getDocumentPromptDeliveryOptions(lines);

    if (!prompto?.promptContent) {
      vscode.window.showErrorMessage(
        "Inline promptContent not found for this md-meta block."
      );
      return;
    }

    await showPromptPicker({
      promptName: getHeadingText(lines, headingLine),
      sourceDocument,
      deliveryOptions: {
        ...documentDelivery,
        outputMode: parsePromptMetadataOutputMode(prompto.outputMode) ?? documentDelivery.outputMode,
        deliveryTarget: parsePromptMetadataDeliveryTarget(
          prompto.deliveryTarget
        ) ?? documentDelivery.deliveryTarget,
      },
      workspaceFolder,
      selectedTextContext: buildSelectedTextContextFromPrompto(
        prompto,
        getNodeBody(lines, headingLine)
      ),
    });
  } catch (error) {
    vscode.window.showErrorMessage(`Error running Prompto block: ${error}`);
  }
}

async function runMarkdownPromptAction(
  documentUri: vscode.Uri,
  anchorLine: number
): Promise<void> {
  try {
    const sourceDocument = await vscode.workspace.openTextDocument(documentUri);

    const workspaceFolder =
      vscode.workspace.getWorkspaceFolder(sourceDocument.uri) ??
      vscode.workspace.workspaceFolders?.[0];

    const lines = getDocumentLines(sourceDocument);
    const prompto = findPromptoMetaForAction(lines, anchorLine);
    const documentDelivery = getDocumentPromptDeliveryOptions(lines);

    if (!prompto?.promptContent) {
      vscode.window.showErrorMessage(
        "Inline promptContent not found for this md-meta action."
      );
      return;
    }

    await showPromptPicker({
      promptName: prompto.title || "Prompto Action",
      sourceDocument,
      deliveryOptions: {
        ...documentDelivery,
        outputMode: parsePromptMetadataOutputMode(prompto.outputMode) ?? documentDelivery.outputMode,
        deliveryTarget: parsePromptMetadataDeliveryTarget(
          prompto.deliveryTarget
        ) ?? documentDelivery.deliveryTarget,
      },
      suppressNoSelectedTextPrompt: true,
      workspaceFolder,
      selectedTextContext: buildSelectedTextContextFromPrompto(prompto),
    });
  } catch (error) {
    vscode.window.showErrorMessage(`Error running Prompto action: ${error}`);
  }
}

async function sendSelectionToChat(
  outputMode: PromptOutputMode,
  sectionSource?: { document: vscode.TextDocument; headingLine: number }
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  const document = sectionSource?.document ?? editor?.document;
  if (!document) {
    vscode.window.showErrorMessage("No active editor found.");
    return;
  }

  let promptName = "Selection";
  let processedText: string;
  let deliveryOptions: PromptDeliveryOptions = { outputMode };
  try {
    deliveryOptions = {
      ...(document.languageId === "markdown" ? getDocumentPromptDeliveryOptions(getDocumentLines(document)) : {}),
      outputMode,
    };
    let selectedText: string;
    if (sectionSource || editor!.selection.isEmpty) {
      const sections = document.languageId === "markdown"
        ? getMarkdownSections(getDocumentLines(document))
        : [];
      const line = sectionSource?.headingLine ?? editor!.selection.active.line;
      const section = sectionSource
        ? sections.find(item => item.line === line)
        : sections.filter(item => line >= item.line && line < item.endLine).pop();
      if (!section) {
        vscode.window.showErrorMessage("No executable section here. Enable document-level prompto.sectionLevels or select text.");
        return;
      }
      selectedText = section.content;
      promptName = section.title;
    } else {
      selectedText = document.getText(editor!.selection).trim();
    }
    if (!selectedText) {
      vscode.window.showErrorMessage(sectionSource || editor?.selection.isEmpty ? "This section has no content to deliver." : "No text selected.");
      return;
    }
    const renderedText = await resolveSelectionVariables(
      selectedText,
      document.getText(),
      path.basename(document.fileName),
      async name => vscode.window.showInputBox({
        title: `Variable: ${name}`,
        prompt: `Enter a value for {{${name}}}. Used for this delivery only.`,
      }),
      content => resolveSelectionPathTemplates(
        content,
        document.isUntitled ? undefined : document.uri.fsPath,
        document.isUntitled
          ? undefined
          : vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath
      ),
      async reference => {
        if (document.isUntitled) {
          throw new Error("Save the source document before loading a shared context.");
        }
        const contextPath = resolveSelectionPathTemplates(
          `{{path:${reference}}}`,
          document.uri.fsPath,
          vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath
        );
        const contextDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(contextPath));
        return contextDocument.getText();
      }
    );
    if (renderedText === null) {
      return;
    }
    processedText = renderedText;
    if (!processedText.trim()) {
      vscode.window.showInformationMessage("No content to deliver after evaluating the template.");
      return;
    }
  } catch (error) {
    vscode.window.showErrorMessage(
      `Cannot process selection: ${error instanceof Error ? error.message : String(error)}`
    );
    return;
  }

  if (outputMode === "clipboard") {
    deliveryOptions.clipboardFeedback = "statusBar";
  } else {
    const deliveryTarget =
      deliveryOptions.deliveryTarget ?? vscode.workspace.getConfiguration("prompto").get<string>("deliveryTarget") ??
      "githubCopilotChat";
    deliveryOptions.deliveryTarget = parsePromptDeliveryTarget(deliveryTarget);
  }

  await deliverPromptContent(promptName, processedText, deliveryOptions);
}
