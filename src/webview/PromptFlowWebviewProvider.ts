/**
 * Flow Webview 视图提供者
 * 在侧边栏渲染流程图，支持节点交互
 */

import * as vscode from "vscode";
import * as path from "path";
import { extractFlowGraph, FlowGraph } from "../services/MarkdownFlowService";
import {
  findPromptoMetaForHeading,
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
import {
  getMarkdownPromptBlockAtHeadingLine,
  getSelectedTextContextForMarkdownPromptBlock,
} from "../services/MarkdownPromptBlockService";

export class PromptFlowWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "prompto.flowView";

  private _view?: vscode.WebviewView;
  private _extensionUri: vscode.Uri;
  private _currentDocument?: vscode.TextDocument;

  constructor(extensionUri: vscode.Uri) {
    this._extensionUri = extensionUri;
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
          // 如果已有活跃文档，立即发送 flow 数据
          if (this._currentDocument) {
            this.updateFlow(this._currentDocument);
          }
          break;
        case "locateNode":
          this._locateNode(msg.line);
          break;
        case "runNode":
          await this._runNode(msg.line, msg.headingLine);
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

    const lines = getDocumentLines(document);
    const graph = extractFlowGraph(lines);

    this._view.webview.postMessage({
      type: "updateFlow",
      graph,
    });
  }

  public clearFlow(): void {
    this._currentDocument = undefined;
    if (this._view) {
      this._view.webview.postMessage({
        type: "updateFlow",
        graph: { nodes: [], edges: [], diagnostics: [] },
      });
    }
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

    // 尝试旧路径
    const promptBlock = getMarkdownPromptBlockAtHeadingLine(
      this._currentDocument,
      headingLine
    );

    if (promptBlock) {
      const workspaceFolder =
        vscode.workspace.getWorkspaceFolder(this._currentDocument.uri) ??
        vscode.workspace.workspaceFolders?.[0];

      await this._executePrompt({
        promptName: promptBlock.headingText,
        deliveryOptions: {
          outputMode: parsePromptOutputMode(
            promptBlock.variables.outputMode
          ),
          deliveryTarget: parsePromptDeliveryTarget(
            promptBlock.variables.deliveryTarget
          ),
        },
        selectedTextContext: getSelectedTextContextForMarkdownPromptBlock(promptBlock),
        workspaceFolder,
      });
      return;
    }

    // 新路径
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
        await deliverPromptContent(promptName, content, deliveryOptions);
        return;
      }
    }

    // 如果有 inlinePromptContent
    if (selectedTextContext.inlinePromptContent) {
      let content = selectedTextContext.inlinePromptContent;
      // 替换变量
      if (selectedTextContext.selectedText) {
        content = content.replace(/\{\{selectedText\}\}/g, selectedTextContext.selectedText);
      }
      await deliverPromptContent(promptName, content, deliveryOptions);
      return;
    }

    vscode.window.showErrorMessage("No prompt content found for this node.");
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
  <div id="flow-container">
    <div class="empty-state">
      <div class="icon">⊞</div>
      <div>Open a markdown file with flow metadata</div>
    </div>
  </div>
  <script src="${scriptUri}"></script>
</body>
</html>`;
  }
}
