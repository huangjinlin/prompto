import * as vscode from "vscode";
import { parseMarkdownPromptBlocks } from "../services/MarkdownPromptBlockService";

export class MarkdownPromptCodeLensProvider implements vscode.CodeLensProvider {
  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    return parseMarkdownPromptBlocks(document).map((promptBlock) => {
      const title = promptBlock.promptReference
        ? "Run Prompto"
        : "Choose Prompt";

      return new vscode.CodeLens(
        new vscode.Range(promptBlock.headingLine, 0, promptBlock.headingLine, 0),
        {
          title,
          command: "prompto.runMarkdownBlock",
          arguments: [document.uri, promptBlock.headingLine],
        }
      );
    });
  }
}