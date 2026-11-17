import { basename, dirname, isAbsolute, resolve } from "path";
import * as vscode from "vscode";
import { getMarkdownSections } from "./MarkdownSectionService";
import { getDocumentPromptDeliveryOptions, PromptDeliveryOptions } from "./PromptDeliveryService";
import type { PromptQueueSnapshot } from "./PromptQueueFileService";
import { parsePromptQueue, PromptQueueItem } from "./PromptQueueService";
import { resolveSelectionPathTemplates } from "./SelectionPathTemplateService";
import { resolveSelectionVariables } from "./SelectionVariableService";
import { createMarkdownFragmentLoader } from "./MarkdownFragmentService";

export interface RenderedPromptQueueItem {
  readonly item: PromptQueueItem;
  readonly content: string;
  readonly promptUri: vscode.Uri;
  readonly contextUri: vscode.Uri;
  readonly deliveryOptions: PromptDeliveryOptions;
}

function resolveQueueFile(queueUri: vscode.Uri, reference: string): vscode.Uri {
  if (/\{\{|\}\}/.test(reference) || /^~(?:[\\/]|$)/.test(reference) ||
      (/^[a-z][a-z\d+.-]*:/i.test(reference) && !/^[a-z]:[\\/]/i.test(reference))) {
    throw new Error("Queue file references must be literal paths, not templates, URLs or home shortcuts.");
  }
  return vscode.Uri.file(resolve(dirname(queueUri.fsPath), reference));
}

export async function renderPromptQueueItem(
  snapshot: PromptQueueSnapshot,
  id: string,
  requestValue: (name: string) => Promise<string | undefined>
): Promise<RenderedPromptQueueItem | null> {
  if (snapshot.uri.scheme !== "file" || !isAbsolute(snapshot.uri.fsPath)) {
    throw new Error("Queue rendering requires a saved local queue file.");
  }
  const queue = parsePromptQueue(snapshot.source);
  const item = queue.items.find(candidate => candidate.id === id);
  if (!item) throw new Error(`Queue item not found: ${id}.`);
  try {
    const promptUri = resolveQueueFile(snapshot.uri, item.prompt);
    const contextUri = resolveQueueFile(snapshot.uri, item.context);
    const promptDocument = await vscode.workspace.openTextDocument(promptUri);
    const documentContent = promptDocument.getText();
    const lines = documentContent.split(/\r?\n/);
    const deliveryOptions: PromptDeliveryOptions = { ...getDocumentPromptDeliveryOptions(lines), outputMode: item.outputMode ?? queue.outputMode };
    const sections = getMarkdownSections(lines).filter(section => section.title === item.section);
    if (sections.length !== 1) {
      throw new Error(`Section "${item.section}" must match exactly one enabled Markdown section; found ${sections.length}.`);
    }
    const section = sections[0];
    if (!section.content.trim()) throw new Error("The selected section has no content to render.");
    const content = await resolveSelectionVariables(
      section.content,
      documentContent,
      basename(promptUri.fsPath),
      requestValue,
      text => resolveSelectionPathTemplates(text, promptUri.fsPath,
        vscode.workspace.getWorkspaceFolder(promptUri)?.uri.fsPath),
      async reference => (await vscode.workspace.openTextDocument(vscode.Uri.file(reference))).getText(),
      contextUri.fsPath,
      createMarkdownFragmentLoader(promptUri.fsPath,
        async filePath => (await vscode.workspace.openTextDocument(vscode.Uri.file(filePath))).getText(),
        filePath => vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath))?.uri.fsPath)
    );
    if (content === null) return null;
    if (!content.trim()) throw new Error("The selected section renders to empty content.");
    return { item, content, promptUri, contextUri, deliveryOptions };
  } catch (error) {
    throw new Error(`Cannot render queue item "${id}": ${error instanceof Error ? error.message : String(error)}`);
  }
}