import * as vscode from "vscode";
import { changePromptQueueStatus, parsePromptQueue, PromptQueue, PromptQueueStatus } from "./PromptQueueService";

export interface PromptQueueFileSnapshot {
  readonly uri: vscode.Uri;
  readonly version: number;
  readonly source: string;
}

export interface PromptQueueSnapshot extends PromptQueueFileSnapshot {
  readonly queue: PromptQueue;
}

export class PromptQueueFileService {
  async read(uri: vscode.Uri): Promise<PromptQueueSnapshot> {
    const document = await vscode.workspace.openTextDocument(uri);
    const source = document.getText();
    return { uri, version: document.version, source, queue: parsePromptQueue(source) };
  }

  async save(snapshot: PromptQueueFileSnapshot, source: string): Promise<PromptQueueSnapshot> {
    parsePromptQueue(source);
    const document = await vscode.workspace.openTextDocument(snapshot.uri);
    if (document.version !== snapshot.version || document.getText() !== snapshot.source) {
      throw new Error("Queue changed since it was read. Reload before saving.");
    }
    if (document.isDirty) {
      throw new Error("Queue has unsaved editor changes. Save them before updating the queue.");
    }
    if (source === snapshot.source) return this.read(snapshot.uri);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(snapshot.uri, new vscode.Range(document.positionAt(0), document.positionAt(snapshot.source.length)), source);
    if (!await vscode.workspace.applyEdit(edit)) {
      throw new Error("Queue edit was rejected. Reload before retrying.");
    }
    if (document.getText() !== source) {
      throw new Error("Queue changed during the edit. Reload before saving.");
    }
    if (!await document.save()) {
      throw new Error("Queue could not be saved. Its edit remains in the editor; no task was dispatched.");
    }
    if (document.getText() !== source || document.isDirty) {
      throw new Error("Queue changed during saving. Reload before continuing.");
    }
    return this.read(snapshot.uri);
  }

  async setStatus(snapshot: PromptQueueSnapshot, id: string, status: PromptQueueStatus): Promise<PromptQueueSnapshot> {
    return this.save(snapshot, changePromptQueueStatus(snapshot.source, id, status));
  }
}