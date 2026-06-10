/**
 * Flow Webview 视图提供者
 * 在侧边栏渲染流程图，支持节点交互
 */

import * as vscode from "vscode";
import * as path from "path";
import { extractFlowGraphs, FlowGraph } from "../services/MarkdownFlowService";
import {
  findPromptoMetaForHeading,
  findPromptoMetaForAction,
  getDocumentLines,
  getHeadingText,
  getNodeBody,
  buildSelectedTextContextFromPrompto,
} from "../services/MarkdownMetaBridgeService";
import {
  deliverPromptContent,
  parsePromptDeliveryTarget,
  parsePromptOutputMode,
  PromptDeliveryOptions,
} from "../services/PromptDeliveryService";

export class PromptFlowWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "prompto.flowView";

  private _view?: vscode.WebviewView;
  private _extensionUri: vscode.Uri;
  private _currentDocument?: vscode.TextDocument;
  private _workspaceState: vscode.Memento;
  private _pinnedFilePath: string | null = null;

  private static readonly PINNED_FILE_KEY = "prompto.flowView.pinnedFile";

  constructor(extensionUri: vscode.Uri, workspaceState: vscode.Memento) {
    this._extensionUri = extensionUri;
    this._workspaceState = workspaceState;
    this._pinnedFilePath = workspaceState.get<string | null>(
      PromptFlowWebviewProvider.PINNED_FILE_KEY,
      null
    );
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.type) {
        case "ready":
          // 恢复 pinned 文件，或等待用户选择
          if (this._pinnedFilePath) {
            await this._restorePinnedFile();
          } else {
            this._sendPinnedFileName(null);
          }
          break;
        case "selectFile":
          await this._selectFile();
          break;
        case "locateNode":
          this._locateNode(msg.line);
          break;
        case "runNode":
          await this._runNode(msg.line, msg.headingLine);
          break;
        case "runPrompto":
          await this._runPromptoAtLine(msg.line, msg.headingLine);
          break;
      }
    });

    // 面板显示时刷新
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible && this._currentDocument) {
        this.updateFlow(this._currentDocument);
      }
    });
  }

  public updateFlow(document: vscode.TextDocument): void {
    this._currentDocument = document;

    if (!this._view?.visible) {
      return;
    }

    this._renderDocument(document);
  }

  /**
   * 外部调用：如果保存的文件是 pinned 文件，刷新侧边栏
   */
  public refreshIfPinned(document: vscode.TextDocument): void {
    if (this._pinnedFilePath && document.uri.fsPath === this._pinnedFilePath) {
      this._currentDocument = document;
      this._renderDocument(document);
    }
  }

  public clearFlow(): void {
    this._currentDocument = undefined;
    if (this._view) {
      this._view.webview.postMessage({
        type: "updateFlow",
        graphs: [],
      });
    }
  }

  private _renderDocument(document: vscode.TextDocument): void {
    if (!this._view?.visible) {
      return;
    }

    const lines = getDocumentLines(document);
    const graphs = extractFlowGraphs(lines);

    this._view.webview.postMessage({
      type: "updateFlow",
      graphs,
    });
  }

  private async _selectFile(): Promise<void> {
    const uris = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: { Markdown: ["md"] },
      title: "Select a markdown file for Flow Graph",
    });

    if (!uris || uris.length === 0) {
      return;
    }

    const filePath = uris[0].fsPath;
    await this._pinFile(filePath);
  }

  private async _pinFile(filePath: string): Promise<void> {
    this._pinnedFilePath = filePath;
    await this._workspaceState.update(
      PromptFlowWebviewProvider.PINNED_FILE_KEY,
      filePath
    );

    try {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
      this._currentDocument = doc;
      this._sendPinnedFileName(filePath);
      this._renderDocument(doc);
    } catch {
      vscode.window.showErrorMessage(`Cannot open file: ${filePath}`);
      this._pinnedFilePath = null;
      await this._workspaceState.update(
        PromptFlowWebviewProvider.PINNED_FILE_KEY,
        null
      );
      this._sendPinnedFileName(null);
    }
  }

  private async _restorePinnedFile(): Promise<void> {
    if (!this._pinnedFilePath) {
      this._sendPinnedFileName(null);
      return;
    }

    try {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(this._pinnedFilePath));
      this._currentDocument = doc;
      this._sendPinnedFileName(this._pinnedFilePath);
      this._renderDocument(doc);
    } catch {
      // 文件不存在，清除 pinned
      this._pinnedFilePath = null;
      await this._workspaceState.update(
        PromptFlowWebviewProvider.PINNED_FILE_KEY,
        null
      );
      this._sendPinnedFileName(null);
    }
  }

  private _sendPinnedFileName(filePath: string | null): void {
    if (!this._view) {
      return;
    }
    const name = filePath ? path.basename(filePath, ".md") : null;
    this._view.webview.postMessage({
      type: "pinnedFileName",
      name,
    });
  }

  private _locateNode(line: number): void {
    if (!this._currentDocument) {
      return;
    }

    const editor = vscode.window.visibleTextEditors.find(
      (e) => e.document.uri.toString() === this._currentDocument?.uri.toString()
    );

    if (editor) {
      const position = new vscode.Position(line, 0);
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(
        new vscode.Range(position, position),
        vscode.TextEditorRevealType.InCenter
      );
    }
  }

  private async _runNode(line: number, headingLine: number): Promise<void> {
    if (!this._currentDocument) {
      return;
    }

    const lines = getDocumentLines(this._currentDocument);

    const prompto = findPromptoMetaForHeading(lines, headingLine);
    if (!prompto) {
      vscode.window.showErrorMessage("No prompt metadata found for this node.");
      return;
    }

    const workspaceFolder =
      vscode.workspace.getWorkspaceFolder(this._currentDocument.uri) ??
      vscode.workspace.workspaceFolders?.[0];

    await this._executePrompt({
      promptName: getHeadingText(lines, headingLine),
      deliveryOptions: {
        outputMode: parsePromptOutputMode(prompto.outputMode),
        deliveryTarget: parsePromptDeliveryTarget(prompto.deliveryTarget),
      },
      selectedTextContext: buildSelectedTextContextFromPrompto(
        prompto,
        getNodeBody(lines, headingLine)
      ),
      workspaceFolder,
    });
  }

  private async _runPromptoAtLine(line: number, headingLine: number): Promise<void> {
    if (!this._currentDocument) {
      return;
    }

    const lines = getDocumentLines(this._currentDocument);
    const workspaceFolder =
      vscode.workspace.getWorkspaceFolder(this._currentDocument.uri) ??
      vscode.workspace.workspaceFolders?.[0];

    // 判断是节点级还是动作级：如果 line === headingLine，是主 prompto
    if (line === headingLine) {
      const prompto = findPromptoMetaForHeading(lines, headingLine);
      if (!prompto) {
        vscode.window.showErrorMessage("No prompt metadata found.");
        return;
      }
      await this._executePrompt({
        promptName: getHeadingText(lines, headingLine),
        deliveryOptions: {
          outputMode: parsePromptOutputMode(prompto.outputMode),
          deliveryTarget: parsePromptDeliveryTarget(prompto.deliveryTarget),
        },
        selectedTextContext: buildSelectedTextContextFromPrompto(prompto, getNodeBody(lines, headingLine)),
        workspaceFolder,
      });
    } else {
      // action 级
      const prompto = findPromptoMetaForAction(lines, line);
      if (!prompto) {
        vscode.window.showErrorMessage("No prompt metadata found for this action.");
        return;
      }
      await this._executePrompt({
        promptName: prompto.title || "Action",
        deliveryOptions: {
          outputMode: parsePromptOutputMode(prompto.outputMode),
          deliveryTarget: parsePromptDeliveryTarget(prompto.deliveryTarget),
        },
        selectedTextContext: buildSelectedTextContextFromPrompto(prompto, getNodeBody(lines, headingLine)),
        workspaceFolder,
      });
    }
  }

  private async _executePrompt(options: {
    promptName: string;
    deliveryOptions: PromptDeliveryOptions;
    selectedTextContext: {
      rawSelectedText: string;
      selectedText: string;
      variables: Record<string, string>;
      promptReference?: string;
      inlinePromptContent?: string;
    };
    workspaceFolder?: vscode.WorkspaceFolder;
  }): Promise<void> {
    const { promptName, deliveryOptions, selectedTextContext } = options;

    // 如果有 prompt 引用，解析文件内容
    if (selectedTextContext.promptReference && options.workspaceFolder) {
      const { resolvePromptFilePath } = await import("../services/PromptDirectoryService");
      const promptPath = resolvePromptFilePath(
        options.workspaceFolder,
        selectedTextContext.promptReference
      );
      if (promptPath) {
        const fs = await import("fs");
        const content = fs.readFileSync(promptPath, "utf-8").replace(/\r\n/g, "\n");
        const processed = this._replacePromptVariables(content, selectedTextContext);
        await deliverPromptContent(promptName, processed, deliveryOptions);
        return;
      }
    }

    // 如果有 inlinePromptContent
    if (selectedTextContext.inlinePromptContent) {
      const processed = this._replacePromptVariables(selectedTextContext.inlinePromptContent, selectedTextContext);
      await deliverPromptContent(promptName, processed, deliveryOptions);
      return;
    }

    vscode.window.showErrorMessage("No prompt content found for this node.");
  }

  private _replacePromptVariables(
    content: string,
    selectedTextContext: {
      selectedText: string;
      variables: Record<string, string>;
    }
  ): string {
    let processed = content;

    // 替换 {{selectedText}}
    if (processed.includes("{{selectedText}}")) {
      processed = processed.replace(/\{\{selectedText\}\}/g, selectedTextContext.selectedText || "");
    }

    // 替换 {{fileName}}
    if (processed.includes("{{fileName}}") && this._currentDocument) {
      const fileName = path.basename(this._currentDocument.fileName);
      processed = processed.replace(/\{\{fileName\}\}/g, fileName);
    }

    // 替换自定义变量
    const customVars = processed.match(/\{\{(\w+)\}\}/g);
    if (customVars) {
      const uniqueVars = new Set(
        customVars
          .map((v) => v.replace(/\{\{|\}\}/g, ""))
          .filter((name) => name !== "selectedText" && name !== "fileName")
      );
      for (const varName of uniqueVars) {
        const value = selectedTextContext.variables[varName];
        if (value !== undefined) {
          processed = processed.replace(new RegExp(`\\{\\{${varName}\\}\\}`, "g"), value);
        }
      }
    }

    return processed;
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "media", "prompt-flow.js")
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "media", "prompt-flow.css")
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src ${webview.cspSource};">
  <link rel="stylesheet" href="${styleUri}">
  <title>Flow Graph</title>
</head>
<body>
  <div id="flow-container"></div>
  <script src="${scriptUri}"></script>
</body>
</html>`;
  }
}
