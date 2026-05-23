import * as vscode from "vscode";
import {
  parseMarkdownPromptActions,
  parseMarkdownPromptBlocks,
} from "../services/MarkdownPromptBlockService";

export class MarkdownPromptCodeLensProvider implements vscode.CodeLensProvider {
  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
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

    return [...promptBlockCodeLenses, ...promptActionCodeLenses].sort(
      (left, right) => left.range.start.line - right.range.start.line
    );
  }
}