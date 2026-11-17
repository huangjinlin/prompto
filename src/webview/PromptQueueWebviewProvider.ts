import { randomBytes } from "crypto";
import { basename, dirname, normalize, sep } from "path";
import * as vscode from "vscode";
import { PromptQueueExecutionService } from "../services/PromptQueueExecutionService";
import { parsePromptQueue } from "../services/PromptQueueService";

type QueueExecution = Pick<PromptQueueExecutionService, "isBusy" | "isPaused" | "runNext" | "confirm" | "pause" | "resume">;

interface QueueWorkflow {
  uri: vscode.Uri;
  execution: QueueExecution;
  operation: boolean;
  deleted: boolean;
  message: string;
  error: string;
  subscriptions: vscode.Disposable[];
}

export interface PromptQueueViewDependencies {
  createExecution: (uri: vscode.Uri) => QueueExecution;
}

export function getPromptQueueWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const resource = (...parts: string[]) => webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, ...parts)).toString();
  const nonce = randomBytes(18).toString("hex");
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${resource("node_modules", "@vscode", "codicons", "dist", "codicon.css")}">
<link rel="stylesheet" href="${resource("resources", "queue.css")}"><title>Prompto 队列</title></head>
<body>
<section id="workflow-panel" aria-label="工作流列表"><header class="workflow-bar"><span>工作流</span><button id="select-file" class="icon-button" title="添加工作流文件（可多选）" aria-label="添加工作流文件"><i class="codicon codicon-folder-opened" aria-hidden="true"></i></button></header>
<ul id="workflows" aria-label="已添加的工作流"></ul><p id="workflow-empty" class="empty">未添加工作流</p></section>
<header class="file-bar">
<button id="open-source" class="file-name" title="在编辑器打开队列文件">未选择队列文件</button>
<button id="reload" class="icon-button" title="重新读取队列文件" aria-label="重新加载队列"><i class="codicon codicon-refresh" aria-hidden="true"></i></button>
<button id="remove-workflow" class="icon-button" title="从列表移除工作流，不删除文件或取消已派发任务" aria-label="从列表移除工作流"><i class="codicon codicon-close" aria-hidden="true"></i></button></header>
<section id="status-panel" aria-label="队列状态">
<div class="summary"><span id="progress-label">已确认 0 / 0</span><span id="mode-label"></span></div><progress id="progress" value="0" max="1" aria-label="队列进度"></progress>
<div class="toolbar"><button id="run" class="command-button" title="投放第一个待执行项"><i class="codicon codicon-play" aria-hidden="true"></i><span>投放下一项</span></button>
<button id="confirm" class="icon-button" title="人工确认当前项完成，不自动投放下一项" aria-label="确认当前项完成"><i class="codicon codicon-check" aria-hidden="true"></i></button>
<button id="pause" class="icon-button" title="暂停队列" aria-label="暂停队列"><i class="codicon codicon-debug-pause" aria-hidden="true"></i></button></div>
<ul id="items" aria-label="队列项"></ul><p id="empty" class="empty">未选择队列文件</p></section>
<p id="error" class="error" role="alert" hidden></p><p id="message" class="message" role="status"></p>
<script nonce="${nonce}" src="${resource("resources", "queue.js")}"></script></body></html>`;
}

export class PromptQueueWebviewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewType = "prompto.queueView";
  private static readonly fileKey = "prompto.queueView.file";
  private static readonly workflowsKey = "prompto.queueView.workflows";
  private view?: vscode.WebviewView;
  private readonly workflows = new Map<string, QueueWorkflow>();
  private activeKey?: string;
  private selecting = false;
  private disposed = false;
  private loadRevision = 0;
  private actionError = "";
  private readonly subscriptions: vscode.Disposable[] = [];
  private readonly dependencies: PromptQueueViewDependencies;

  constructor(private readonly extensionUri: vscode.Uri, private readonly workspaceState: vscode.Memento,
    dependencies?: PromptQueueViewDependencies) {
    this.dependencies = dependencies ?? { createExecution: uri => new PromptQueueExecutionService(uri) };
    const stored = workspaceState.get<{ uris?: unknown; active?: unknown; paused?: unknown }>(PromptQueueWebviewProvider.workflowsKey);
    const legacy = workspaceState.get<string>(PromptQueueWebviewProvider.fileKey);
    const storedUris = stored?.uris;
    const uris = Array.isArray(storedUris) ? storedUris : legacy ? [legacy] : [];
    for (const value of uris) {
      try { if (typeof value === "string") this.attach(vscode.Uri.parse(value)); } catch {}
    }
    const active = [...this.workflows.entries()].find(([, entry]) => entry.uri.toString() === stored?.active);
    this.activeKey = active?.[0] ?? this.workflows.keys().next().value;
    const paused = stored?.paused;
    if (Array.isArray(paused)) for (const entry of this.workflows.values()) if (paused.includes(entry.uri.toString())) entry.execution.pause();
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [this.extensionUri] };
    view.webview.html = getPromptQueueWebviewHtml(view.webview, this.extensionUri);
    this.subscriptions.push(
      view.webview.onDidReceiveMessage(message => { void this.receive(message).catch(problem => {
        this.actionError = problem instanceof Error ? problem.message : String(problem);
        void this.refresh();
      }); }),
      view.onDidChangeVisibility(() => { if (view.visible) void this.refresh(); }),
      vscode.workspace.onDidChangeTextDocument(event => { if (this.matches(event.document.uri)) void this.refresh(); }),
      vscode.workspace.onDidSaveTextDocument(document => { if (this.matches(document.uri)) void this.refresh(); })
    );
  }

  dispose(): void {
    this.disposed = true;
    for (const entry of this.workflows.values()) {
      entry.execution.pause();
      entry.subscriptions.forEach(subscription => subscription.dispose());
    }
    this.workflows.clear();
    this.subscriptions.forEach(subscription => subscription.dispose());
  }

  private key(uri: vscode.Uri): string {
    const value = normalize(uri.fsPath);
    return sep === "\\" ? value.toLowerCase() : value;
  }

  private matches(uri: vscode.Uri): boolean { return this.workflows.has(this.key(uri)); }

  private active(): QueueWorkflow | undefined { return this.activeKey ? this.workflows.get(this.activeKey) : undefined; }

  private busy(entry: QueueWorkflow): boolean { return entry.operation || entry.execution.isBusy; }

  private attach(uri: vscode.Uri): void {
    if (uri.scheme !== "file" || uri.authority || uri.query || uri.fragment || !/\.ya?ml$/i.test(uri.fsPath)) throw new Error("请选择本地 YAML 工作流文件。");
    const key = this.key(uri);
    if (this.workflows.has(key)) return;
    const entry: QueueWorkflow = { uri, execution: this.dependencies.createExecution(uri), operation: false, deleted: false, message: "", error: "", subscriptions: [] };
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(dirname(uri.fsPath), basename(uri.fsPath)));
    entry.subscriptions.push(watcher,
      watcher.onDidChange(() => { void this.refresh(); }),
      watcher.onDidCreate(() => { entry.deleted = false; entry.error = ""; void this.refresh(); }),
      watcher.onDidDelete(() => { entry.deleted = true; void this.refresh(); })
    );
    this.workflows.set(key, entry);
    this.activeKey ??= key;
  }

  private post(message: object): void { void this.view?.webview.postMessage(message); }

  private async persist(): Promise<void> {
    const entries = [...this.workflows.values()];
    await this.workspaceState.update(PromptQueueWebviewProvider.workflowsKey, { uris: entries.map(entry => entry.uri.toString()), active: this.active()?.uri.toString() ?? "", paused: entries.filter(entry => entry.execution.isPaused).map(entry => entry.uri.toString()) });
    await this.workspaceState.update(PromptQueueWebviewProvider.fileKey, undefined);
  }

  async refresh(): Promise<void> {
    if (this.disposed) return;
    const revision = ++this.loadRevision;
    const results = await Promise.all([...this.workflows.entries()].map(async ([key, entry]) => {
      let dirty = false;
      let queue;
      let error = entry.error;
      try {
        if (entry.deleted) throw new Error("工作流文件已删除，请恢复文件或从列表移除。");
        const document = await vscode.workspace.openTextDocument(entry.uri);
        dirty = document.isDirty;
        queue = parsePromptQueue(document.getText());
      } catch (problem) {
        error = problem instanceof Error ? problem.message : String(problem);
      }
      return { key, entry, dirty, queue, error };
    }));
    if (this.disposed || revision !== this.loadRevision) return;
    const selected = results.find(result => result.key === this.activeKey);
    const entry = selected?.entry;
    const workflows = results.map(result => {
      const { entry, queue, dirty, error } = result;
      const busy = this.busy(entry);
      const current = queue?.items.find(item => item.status === "doing");
      const status = entry.deleted ? "deleted" : dirty ? "dirty" : !queue || error ? "error" : busy ? "busy" : entry.execution.isPaused ? "paused" : current ? "waiting" : queue.items.some(item => item.status === "await") ? "ready" : "complete";
      return { uri: entry.uri.toString(), fileName: basename(entry.uri.fsPath), directory: dirname(entry.uri.fsPath), status, busy, paused: entry.execution.isPaused, done: queue?.items.filter(item => item.status === "done").length ?? 0, total: queue?.items.length ?? 0, current: current?.section ?? "", error: dirty ? "工作流文件有未保存修改。" : error };
    });
    this.post({ type: "state", state: {
      workflows, selecting: this.selecting, dispatchBusy: [...this.workflows.values()].some(entry => this.busy(entry)),
      uri: entry?.uri.toString() ?? "", fileName: entry ? basename(entry.uri.fsPath) : "", dirty: selected?.dirty ?? false,
      items: selected?.queue?.items ?? [], outputMode: selected?.queue?.outputMode ?? "chatPrefill", valid: Boolean(selected?.queue),
      busy: entry ? this.busy(entry) : false, paused: entry?.execution.isPaused ?? false,
      error: this.actionError || selected?.error || "", message: entry?.message ?? "",
    } });
  }

  private async perform(entry: QueueWorkflow, action: () => Promise<void>, dispatch = false): Promise<void> {
    try {
      if (this.busy(entry) || dispatch && [...this.workflows.values()].some(candidate => this.busy(candidate))) throw new Error("已有工作流操作正在执行，本次请求未投放、未改变进度，请稍后手动执行。");
      entry.operation = true;
      entry.error = "";
      this.actionError = "";
      try {
        await this.refresh();
        if (entry.deleted) throw new Error("工作流文件已删除，未执行操作。");
        const document = await vscode.workspace.openTextDocument(entry.uri);
        if (document.isDirty) throw new Error("工作流文件有未保存修改，请先保存。");
        parsePromptQueue(document.getText());
        await action();
      } finally { entry.operation = false; }
    } catch (problem) {
      entry.error = problem instanceof Error ? problem.message : String(problem);
    }
    await this.refresh();
  }

  async selectFile(): Promise<void> {
    if (this.selecting) return;
    this.selecting = true;
    this.actionError = "";
    try {
      await this.refresh();
      const selected = await vscode.window.showOpenDialog({ canSelectFiles: true, canSelectFolders: false,
        canSelectMany: true, filters: { YAML: ["yaml", "yml"] } });
      if (selected?.length) {
        for (const uri of selected) this.attach(uri);
        this.activeKey = this.key(selected[0]);
        await this.persist();
      }
    } catch (problem) { this.actionError = problem instanceof Error ? problem.message : String(problem); }
    finally { this.selecting = false; }
    await this.refresh();
  }

  private async receive(value: unknown): Promise<void> {
    if (!value || typeof value !== "object") return;
    const message = value as Record<string, unknown>;
    const selected = this.active();
    const entry = [...this.workflows.values()].find(entry => entry.uri.toString() === message.uri);
    switch (message.type) {
      case "ready": await this.refresh(); break;
      case "selectFile": await this.selectFile(); break;
      case "selectWorkflow":
        if (!entry) break;
        this.activeKey = this.key(entry.uri);
        this.actionError = "";
        await this.persist();
        await this.refresh();
        break;
      case "removeWorkflow":
        if (!entry || this.busy(entry)) break;
        this.workflows.delete(this.key(entry.uri));
        entry.subscriptions.forEach(subscription => subscription.dispose());
        if (entry === selected) this.activeKey = this.workflows.keys().next().value;
        this.actionError = "";
        await this.persist();
        await this.refresh();
        break;
      case "reload":
        if (!entry || entry !== selected || this.busy(entry)) break;
        entry.error = "";
        this.actionError = "";
        await this.refresh();
        break;
      case "openSource": if (entry) await vscode.window.showTextDocument(entry.uri); break;
      case "runNext":
        if (!entry || entry !== selected) break;
        await this.perform(entry, async () => {
          entry.message = "正在处理工作流项…";
          const result = await entry.execution.runNext();
          entry.message = result.delivery ? result.delivery.detail :
            ({ waiting: "当前项等待人工确认，不会重发。", cancelled: "已取消，未投放。", paused: "已暂停，未开始新的投放。", complete: "队列没有待执行项。" })[result.state];
        }, true);
        break;
      case "confirm":
        if (!entry || entry !== selected) break;
        await this.perform(entry, async () => {
          if (typeof message.id !== "string") throw new Error("没有可确认的当前项。");
          await entry.execution.confirm(message.id);
          entry.message = "已人工确认完成，未投放下一项。";
        });
        break;
      case "togglePause":
        if (!entry || entry !== selected) break;
        if (entry.execution.isPaused && this.busy(entry)) break;
        if (entry.execution.isPaused) { entry.execution.resume(); entry.message = "已恢复，尚未投放下一项。"; }
        else { entry.execution.pause(); entry.message = "已暂停；已经派发的操作不会被取消。"; }
        await this.persist();
        await this.refresh();
        break;
    }
  }
}