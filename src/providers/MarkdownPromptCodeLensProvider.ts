import * as vscode from "vscode";
import {
  parseMarkdownPromptActions,
  parseMarkdownPromptBlocks,
} from "../services/MarkdownPromptBlockService";
import { parseMarkdownMetaDocument } from "../services/MarkdownMetaParserService";
import { getDocumentLines } from "../services/MarkdownMetaBridgeService";

export class MarkdownPromptCodeLensProvider implements vscode.CodeLensProvider {
  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    // 旧语法 CodeLens
    const promptBlockCodeLenses = parseMarkdownPromptBlocks(document).map(
      (promptBlock) => {
        const title =
          promptBlock.promptReference || promptBlock.inlinePromptContent
            ? "Run Prompto"
            : "Choose Prompt";

        return new vscode.CodeLens(
          new vscode.Range(
            promptBlock.headingLine,
            0,
            promptBlock.headingLine,
            0
          ),
          {
            title,
            command: "prompto.runMarkdownBlock",
            arguments: [document.uri, promptBlock.headingLine],
          }
        );
      }
    );

    const promptActionCodeLenses = parseMarkdownPromptActions(document).map(
      (promptAction) =>
        new vscode.CodeLens(
          new vscode.Range(promptAction.anchorLine, 0, promptAction.anchorLine, 0),
          {
            title: promptAction.title,
            command: "prompto.runMarkdownAction",
            arguments: [document.uri, promptAction.anchorLine],
          }
        )
    );

    // 旧语法 CodeLens 的行号集合（用于去重）
    const oldBlockLines = new Set(promptBlockCodeLenses.map((c) => c.range.start.line));
    const oldActionLines = new Set(promptActionCodeLenses.map((c) => c.range.start.line));

    // 新语法 CodeLens
    const lines = getDocumentLines(document);
    const metaDoc = parseMarkdownMetaDocument(lines);

    const mdMetaNodeLenses: vscode.CodeLens[] = metaDoc.nodes
      .filter((node) => {
        const prompto = node.namespaces.prompto;
        // 只对有 prompto 命名空间且有 prompt 或 promptContent 的节点生成 CodeLens
        // 排除已经有旧语法 CodeLens 的节点
        return prompto && (prompto.prompt || prompto.promptContent) && !oldBlockLines.has(node.line);
      })
      .map((node) => {
        const prompto = node.namespaces.prompto!;
        const title = prompto.prompt || prompto.promptContent
          ? "Run Prompto"
          : "Choose Prompt";

        return new vscode.CodeLens(
          new vscode.Range(node.line, 0, node.line, 0),
          {
            title,
            command: "prompto.runMarkdownBlock",
            arguments: [document.uri, node.line],
          }
        );
      });

    const mdMetaActionLenses: vscode.CodeLens[] = metaDoc.actions
      .filter((action) => {
        const prompto = action.namespaces.prompto;
        return prompto && prompto.title && !oldActionLines.has(action.line);
      })
      .map((action) => {
        return new vscode.CodeLens(
          new vscode.Range(action.line, 0, action.line, 0),
          {
            title: action.namespaces.prompto!.title!,
            command: "prompto.runMarkdownAction",
            arguments: [document.uri, action.line],
          }
        );
      });

    return [
      ...promptBlockCodeLenses,
      ...promptActionCodeLenses,
      ...mdMetaNodeLenses,
      ...mdMetaActionLenses,
    ].sort((left, right) => left.range.start.line - right.range.start.line);
  }
}