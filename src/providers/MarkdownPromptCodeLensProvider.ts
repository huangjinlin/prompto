import * as vscode from "vscode";
import { parseMarkdownMetaDocument } from "../services/MarkdownMetaParserService";
import { getDocumentLines } from "../services/MarkdownMetaBridgeService";

export class MarkdownPromptCodeLensProvider implements vscode.CodeLensProvider {
  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const lines = getDocumentLines(document);
    const metaDoc = parseMarkdownMetaDocument(lines);

    const mdMetaNodeLenses: vscode.CodeLens[] = metaDoc.nodes
      .filter((node) => {
        const prompto = node.namespaces.prompto;
        return Boolean(prompto && (prompto.prompt || prompto.promptContent));
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
        return Boolean(prompto && prompto.title);
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

    return [...mdMetaNodeLenses, ...mdMetaActionLenses].sort(
      (left, right) => left.range.start.line - right.range.start.line
    );
  }
}