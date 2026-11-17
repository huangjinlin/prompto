import * as vscode from "vscode";
import { deliverPromptContentWithResult, PromptDeliveryResult } from "./PromptDeliveryService";
import { PromptQueueFileService, PromptQueueSnapshot } from "./PromptQueueFileService";
import { renderPromptQueueItem } from "./PromptQueueRenderService";

export interface PromptQueueExecutionDependencies {
  files: Pick<PromptQueueFileService, "read" | "setStatus">;
  render: typeof renderPromptQueueItem;
  deliver: typeof deliverPromptContentWithResult;
  requestValue: (name: string) => Promise<string | undefined>;
  isTrusted: () => boolean;
}

export interface PromptQueueRunResult {
  readonly state: "waiting" | "cancelled" | "paused" | "complete";
  readonly snapshot: PromptQueueSnapshot;
  readonly itemId?: string;
  readonly delivery?: PromptDeliveryResult;
  readonly detail: string;
}

export class PromptQueueExecutionService {
  private busy = false;
  private paused = false;
  private interruption = 0;
  private readonly dependencies: PromptQueueExecutionDependencies;

  constructor(private readonly uri: vscode.Uri, dependencies?: PromptQueueExecutionDependencies) {
    this.dependencies = dependencies ?? {
      files: new PromptQueueFileService(),
      render: renderPromptQueueItem,
      deliver: deliverPromptContentWithResult,
      requestValue: async name => vscode.window.showInputBox({
        title: `Variable: ${name}`,
        prompt: `Enter a value for {{${name}}}. Used for this queue delivery only.`,
      }),
      isTrusted: () => vscode.workspace.isTrusted,
    };
  }

  get isBusy(): boolean { return this.busy; }
  get isPaused(): boolean { return this.paused; }

  pause(): void {
    this.paused = true;
    this.interruption++;
  }

  resume(): void {
    this.paused = false;
  }

  async runNext(): Promise<PromptQueueRunResult> {
    if (this.busy) throw new Error("A queue operation is already running.");
    if (!this.dependencies.isTrusted()) throw new Error("Trust the workspace before executing a queue.");
    this.busy = true;
    const interruption = this.interruption;
    try {
      const snapshot = await this.dependencies.files.read(this.uri);
      if (this.paused || interruption !== this.interruption) {
        return { state: "paused", snapshot, detail: "Queue is paused; nothing was dispatched." };
      }
      const current = snapshot.queue.items.find(item => item.status === "doing");
      if (current) {
        return { state: "waiting", snapshot, itemId: current.id,
          detail: "An item is already doing. Confirm it or edit its status after manual inspection; it will not be resent." };
      }
      const item = snapshot.queue.items.find(candidate => candidate.status === "await");
      if (!item) return { state: "complete", snapshot, detail: "No pending queue items." };
      const rendered = await this.dependencies.render(snapshot, item.id, this.dependencies.requestValue);
      if (this.paused || interruption !== this.interruption) {
        return { state: "paused", snapshot, itemId: item.id, detail: "Paused before dispatch; queue status was not changed." };
      }
      if (!rendered) return { state: "cancelled", snapshot, itemId: item.id, detail: "Rendering was cancelled; nothing was dispatched." };
      const marked = await this.dependencies.files.setStatus(snapshot, item.id, "doing");
      const latest = await this.dependencies.files.read(this.uri);
      if (latest.version !== marked.version || latest.source !== marked.source) {
        throw new Error("Queue changed before dispatch. Nothing was dispatched; inspect the current status before retrying.");
      }
      if (this.paused || interruption !== this.interruption) {
        return { state: "paused", snapshot: marked, itemId: item.id,
          detail: "Paused before dispatch. The saved doing status remains for manual inspection; nothing was dispatched." };
      }
      let delivery: PromptDeliveryResult;
      try {
        delivery = await this.dependencies.deliver(rendered.item.section, rendered.content, rendered.deliveryOptions);
      } catch (error) {
        delivery = { status: "uncertain", detail: `Delivery outcome is unknown: ${error instanceof Error ? error.message : String(error)}. Inspect manually; no retry.` };
      }
      return { state: "waiting", snapshot: marked, itemId: item.id, delivery,
        detail: "The item remains doing until manual confirmation. No next item was dispatched." };
    } finally {
      this.busy = false;
    }
  }

  async confirm(id: string): Promise<PromptQueueSnapshot> {
    if (this.busy) throw new Error("A queue operation is already running.");
    this.busy = true;
    try {
      const snapshot = await this.dependencies.files.read(this.uri);
      const item = snapshot.queue.items.find(candidate => candidate.id === id);
      if (!item || item.status !== "doing") throw new Error("Only the current doing item can be confirmed.");
      return await this.dependencies.files.setStatus(snapshot, id, "done");
    } finally {
      this.busy = false;
    }
  }
}