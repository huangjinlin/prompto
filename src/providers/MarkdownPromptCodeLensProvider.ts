import * as vscode from "vscode";
import { parseMarkdownMetaDocument } from "../services/MarkdownMetaParserService";
import { getDocumentLines } from "../services/MarkdownMetaBridgeService";
import { getMarkdownSections } from "../services/MarkdownSectionService";

export class MarkdownPromptCodeLensProvider implements vscode.CodeLensProvider {
  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const lines = getDocumentLines(document);
    const metaDoc = parseMarkdownMetaDocument(lines);

    const mdMetaNodeLenses: vscode.CodeLens[] = metaDoc.nodes
      .filter((node) => {
        const prompto = node.namespaces.prompto;
        return Boolean(prompto?.promptContent);
      })
      .map((node) => {
        return new vscode.CodeLens(
          new vscode.Range(node.line, 0, node.line, 0),
          {
            title: "Run Prompto",
            command: "prompto.runMarkdownBlock",
            arguments: [document.uri, node.line],
          }
        );
      });

    const mdMetaActionLenses: vscode.CodeLens[] = metaDoc.actions
      .filter((action) => {
        const prompto = action.namespaces.prompto;
        return Boolean(prompto?.title && prompto.promptContent);
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

    const sectionLenses = getMarkdownSections(lines, metaDoc).flatMap(section =>
      [
        { title: "发送到聊天", mode: "chatSubmit" },
        { title: "预填到聊天", mode: "chatPrefill" },
        { title: "复制", mode: "clipboard" },
      ].map(action => new vscode.CodeLens(
        new vscode.Range(section.line, 0, section.line, 0),
        {
          title: action.title,
          command: "prompto.runMarkdownSection",
          arguments: [document.uri, section.line, action.mode],
        }
      ))
    );

    return [...mdMetaNodeLenses, ...mdMetaActionLenses, ...sectionLenses].sort(
      (left, right) => left.range.start.line - right.range.start.line
    );
  }
}