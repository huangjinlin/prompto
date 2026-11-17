import { execFile } from "child_process";
import * as http from "http";
import * as path from "path";
import WebSocket from "ws";
import { record } from "./DesktopDriver";

export interface LingxiCdpConnection {
  command(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>;
  page(): Promise<{ id: string; url: string }>;
  close(): void;
}

export class LingxiDeliveryError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

export const LINGXI_TASK_NAVIGATION = 'function(project, title) { const entry = this.closest(".project-entry"); const projectName = entry && entry.querySelector(".project-item__name"); const taskName = this.querySelector(".project-session__title"); if (!this.matches("button.project-session") || this.getAttribute("type") !== "button" || this.disabled || !projectName || !taskName || projectName.textContent.trim() !== project || taskName.textContent.trim() !== title) throw new Error("Target changed"); this.click(); }';

export const LINGXI_EDITOR_SELECTION = `function(project, title, url, expectedDraft) {
  const document = this.ownerDocument;
  const roots = document.querySelectorAll("#copilot__root");
  if (document.location.href !== url || roots.length !== 1) throw new Error("Target changed");
  const root = roots[0];
  const entries = Array.from(root.querySelectorAll(".claw-aside .project-entry")).filter(entry => { const names = entry.querySelectorAll(".project-item__name"); return names.length === 1 && names[0].textContent.trim() === project; });
  if (entries.length !== 1) throw new Error("Target changed");
  const tasks = Array.from(entries[0].querySelectorAll("button.project-session")).filter(task => { const names = task.querySelectorAll(".project-session__title"); return names.length === 1 && names[0].textContent.trim() === title; });
  if (tasks.length !== 1 || !tasks[0].classList.contains("project-session--active")) throw new Error("Target changed");
  const fields = root.querySelectorAll('[contenteditable="true"][data-lexical-editor="true"]');
  if (fields.length !== 1 || fields[0] !== this || document.activeElement !== this || !this.isConnected || this.getAttribute("aria-disabled") === "true" || this.getAttribute("aria-readonly") === "true") throw new Error("Input changed");
  const composers = root.querySelectorAll(".voice-send-actions");
  if (composers.length !== 1) throw new Error("Input changed");
  const buttons = Array.from(composers[0].querySelectorAll("button,[role=button]"));
  if (buttons.some(button => button.classList.contains("voice-send-btn--stop") || /停止|取消|中止|\\bstop\\b|\\bcancel\\b/i.test((button.getAttribute("aria-label") || "") + " " + (button.title || "")))) throw new Error("Task busy");
  const senders = buttons.filter(button => !button.classList.contains("voice-send-btn--voice"));
  if (senders.length !== 1 || !senders[0].matches("button.voice-send-btn") || senders[0].disabled || senders[0].getAttribute("aria-disabled") === "true" || !/发送|\\bsend\\b/i.test((senders[0].getAttribute("aria-label") || "") + " " + (senders[0].title || ""))) throw new Error("Input unavailable");
  if ([this, senders[0]].some(element => { const box = element.getBoundingClientRect(); return box.width <= 0 || box.height <= 0; })) throw new Error("Input unavailable");
  const text = node => node.nodeType === 3 ? node.nodeValue : node.nodeName === "BR" ? "\\n" : Array.from(node.childNodes).map(text).join("");
  const paragraphs = Array.from(this.childNodes);
  const draft = paragraphs.length && paragraphs.every(node => node.nodeName === "P") ? paragraphs.map(node => node.lastChild && node.lastChild.nodeName === "BR" ? text(node).replace(/\\n$/, "") : text(node)).join("\\n") : text(this);
  if (draft.replace(/\\r\\n?/g, "\\n") !== expectedDraft) throw new Error("Draft changed");
  const selection = document.getSelection();
  if (!selection) throw new Error("Selection unavailable");
  const range = document.createRange();
  range.selectNodeContents(this);
  selection.removeAllRanges();
  selection.addRange(range);
  return selection.rangeCount === 1 && selection.anchorNode === this && selection.anchorOffset === 0 && selection.focusNode === this && selection.focusOffset === this.childNodes.length;
}`;

export const LINGXI_TASK_SUBMISSION = `function(project, title, url, expectedText) {
  const roots = document.querySelectorAll("#copilot__root");
  if (location.href !== url || roots.length !== 1) throw new Error("Target changed");
  const root = roots[0];
  const entries = Array.from(root.querySelectorAll(".claw-aside .project-entry")).filter(entry => { const names = entry.querySelectorAll(".project-item__name"); return names.length === 1 && names[0].textContent.trim() === project; });
  if (entries.length !== 1) throw new Error("Target changed");
  const tasks = Array.from(entries[0].querySelectorAll("button.project-session")).filter(task => { const names = task.querySelectorAll(".project-session__title"); return names.length === 1 && names[0].textContent.trim() === title; });
  if (tasks.length !== 1 || !tasks[0].classList.contains("project-session--active")) throw new Error("Target changed");
  const composers = root.querySelectorAll(".voice-send-actions");
  const fields = root.querySelectorAll('[contenteditable="true"][data-lexical-editor="true"]');
  if (composers.length !== 1 || fields.length !== 1 || fields[0] !== document.activeElement || !this.isConnected || !composers[0].contains(this)) throw new Error("Input changed");
  const buttons = Array.from(composers[0].querySelectorAll("button,[role=button]"));
  if (buttons.some(button => button.classList.contains("voice-send-btn--stop") || /停止|取消|中止|\\bstop\\b|\\bcancel\\b/i.test((button.getAttribute("aria-label") || "") + " " + (button.title || "")))) throw new Error("Task busy");
  const senders = buttons.filter(button => !button.classList.contains("voice-send-btn--voice"));
  if (senders.length !== 1 || senders[0] !== this || !this.matches("button.voice-send-btn") || this.disabled || this.getAttribute("aria-disabled") === "true" || !/发送|\\bsend\\b/i.test((this.getAttribute("aria-label") || "") + " " + (this.title || ""))) throw new Error("Send unavailable");
  if ([this, fields[0]].some(element => { const box = element.getBoundingClientRect(); return box.width <= 0 || box.height <= 0 || element.getAttribute("aria-disabled") === "true" || element.getAttribute("aria-readonly") === "true"; })) throw new Error("Input unavailable");
  const text = node => node.nodeType === 3 ? node.nodeValue : node.nodeName === "BR" ? "\\n" : Array.from(node.childNodes).map(text).join("");
  const paragraphs = Array.from(fields[0].childNodes);
  const draft = paragraphs.length && paragraphs.every(node => node.nodeName === "P") ? paragraphs.map(node => node.lastChild && node.lastChild.nodeName === "BR" ? text(node).replace(/\\n$/, "") : text(node)).join("\\n") : text(fields[0]);
  if (draft.replace(/\\r\\n?/g, "\\n") !== expectedText) throw new Error("Draft changed");
  this.click();
}`;

export function validateLingxiPort(port: number): void {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new LingxiDeliveryError("invalid_port", "灵犀 CDP 端口必须是 1024–65535 的整数。");
}

export function selectLingxiPage(inventory: unknown, port: number): { id: string; url: string; endpoint: string } {
  if (!Array.isArray(inventory)) throw new LingxiDeliveryError("invalid_inventory", "无法读取灵犀 CDP 页面清单。");
  const candidates = inventory.filter(item => {
    const value = record(item);
    try {
      const url = new URL(String(value.url));
      return value.type === "page" && url.protocol === "https:" && url.hostname === "lingxi.wps.cn" && url.pathname.startsWith("/_desktop/lingxi/") && !url.username && !url.password;
    } catch { return false; }
  });
  if (candidates.length !== 1) throw new LingxiDeliveryError("page_not_unique", "灵犀内容页缺失或不唯一，请只保留一个目标窗口。");
  const candidate = record(candidates[0]);
  let endpoint: URL;
  try { endpoint = new URL(String(candidate.webSocketDebuggerUrl)); }
  catch { throw new LingxiDeliveryError("invalid_endpoint", "灵犀调试连接地址无效。"); }
  if (typeof candidate.id !== "string" || !/^[A-Za-z0-9_-]+$/.test(candidate.id) || endpoint.protocol !== "ws:" || endpoint.hostname !== "127.0.0.1" || endpoint.port !== String(port) || endpoint.pathname !== `/devtools/page/${candidate.id}` || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new LingxiDeliveryError("invalid_endpoint", "拒绝非回环或不匹配的灵犀调试地址。");
  }
  return { id: candidate.id, url: String(candidate.url), endpoint: endpoint.href };
}

function inventory(port: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const fail = () => reject(new LingxiDeliveryError("cdp_unavailable", "无法连接灵犀 CDP，请从专用快捷方式启动灵犀。"));
    const request = http.get({ hostname: "127.0.0.1", port, path: "/json/list", agent: false }, response => {
      if (response.statusCode !== 200) { response.resume(); fail(); return; }
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 262144) { request.destroy(); fail(); }
        else chunks.push(chunk);
      });
      response.on("error", fail);
      response.on("end", () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
        catch { fail(); }
      });
    });
    const timer = setTimeout(() => { request.destroy(); fail(); }, 5000);
    request.on("close", () => clearTimeout(timer));
    request.on("error", fail);
  });
}

function owner(port: number): Promise<{ pid: number; executable: string }> {
  const script = `$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); $listeners=@(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue); if($listeners.Count -ne 1 -or $listeners[0].LocalAddress -ne '127.0.0.1'){throw 'Listener rejected'}; $owner=Get-CimInstance Win32_Process -Filter ('ProcessId='+$listeners[0].OwningProcess); @{pid=$owner.ProcessId; executable=$owner.ExecutablePath} | ConvertTo-Json -Compress`;
  return new Promise((resolve, reject) => {
    execFile(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"), ["-NoProfile", "-NonInteractive", "-Command", script], { timeout: 15000, maxBuffer: 32768, windowsHide: true }, (error, stdout) => {
      if (error) { reject(new LingxiDeliveryError("owner_unverified", "无法核验灵犀回环端口所属进程，已停止。")); return; }
      try {
        const value = record(JSON.parse(stdout.trim().replace(/^\uFEFF/, "")));
        if (!Number.isInteger(value.pid) || Number(value.pid) <= 0 || typeof value.executable !== "string" || !value.executable) throw new Error();
        resolve({ pid: Number(value.pid), executable: value.executable });
      } catch { reject(new LingxiDeliveryError("owner_unverified", "灵犀端口进程身份不可核验，已停止。")); }
    });
  });
}

export async function createLingxiCdpConnection(port: number, executable: string): Promise<LingxiCdpConnection> {
  validateLingxiPort(port);
  if (process.platform !== "win32" || !path.isAbsolute(executable) || path.extname(executable).toLowerCase() !== ".exe") throw new LingxiDeliveryError("invalid_executable", "灵犀投放要求本地 Windows 和绝对 exe 路径。");
  const expected = path.resolve(executable).toLowerCase();
  const initialOwner = await owner(port);
  if (path.resolve(initialOwner.executable).toLowerCase() !== expected) throw new LingxiDeliveryError("owner_mismatch", "CDP 端口不属于配置的灵犀程序，拒绝连接。");
  const target = selectLingxiPage(await inventory(port), port);
  const socket = new WebSocket(target.endpoint, { handshakeTimeout: 5000, maxPayload: 8388608, perMessageDeflate: false });
  const pending = new Map<number, { resolve(value: Record<string, unknown>): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  let sequence = 0;
  let closed = false;
  let inputIssued = false;
  let navigationIssued = false;
  let submissionIssued = false;
  let selectionIssued = false;
  const close = () => {
    if (closed) return;
    closed = true;
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new LingxiDeliveryError("connection_closed", "灵犀 CDP 连接已中断。")); }
    pending.clear();
    socket.terminate();
  };
  socket.on("error", close);
  socket.on("close", close);
  socket.on("message", data => {
    let message: Record<string, unknown>;
    try { message = record(JSON.parse(data.toString())); } catch { close(); return; }
    if (!Number.isInteger(message.id)) return;
    const request = pending.get(Number(message.id));
    if (!request) return;
    pending.delete(Number(message.id));
    clearTimeout(request.timer);
    if (message.error) request.reject(new LingxiDeliveryError("protocol_failure", "灵犀 CDP 操作被拒绝，请检查目标状态；不会自动重试。"));
    else request.resolve(record(message.result));
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { close(); reject(new LingxiDeliveryError("connection_timeout", "灵犀 CDP 连接超时。")); }, 6000);
      socket.once("open", () => { clearTimeout(timer); resolve(); });
      socket.once("error", () => { clearTimeout(timer); reject(new LingxiDeliveryError("connection_failed", "灵犀 CDP 连接失败。")); });
      socket.once("close", () => { clearTimeout(timer); reject(new LingxiDeliveryError("connection_closed", "灵犀 CDP 连接已关闭。")); });
    });
  } catch (error) { close(); throw error; }
  const allowed = new Set(["DOM.getDocument", "DOM.querySelector", "DOM.querySelectorAll", "DOM.describeNode", "DOM.getBoxModel", "DOM.resolveNode", "DOM.focus", "Runtime.callFunctionOn", "Input.insertText"]);
  return {
    close,
    page: async () => {
      if (closed) throw new LingxiDeliveryError("connection_closed", "灵犀 CDP 连接已关闭。");
      const currentOwner = await owner(port);
      if (currentOwner.pid !== initialOwner.pid || path.resolve(currentOwner.executable).toLowerCase() !== expected) throw new LingxiDeliveryError("owner_changed", "灵犀进程身份已变化，已停止。");
      const current = selectLingxiPage(await inventory(port), port);
      if (current.id !== target.id || current.endpoint !== target.endpoint) throw new LingxiDeliveryError("page_changed", "灵犀页面身份已变化，已停止。");
      return { id: current.id, url: current.url };
    },
    command: (method, params = {}) => new Promise((resolve, reject) => {
      if (closed || socket.readyState !== WebSocket.OPEN) { reject(new LingxiDeliveryError("connection_closed", "灵犀 CDP 连接已关闭。")); return; }
      if (!allowed.has(method) || method === "Runtime.callFunctionOn" && params.throwOnSideEffect !== true && params.functionDeclaration !== LINGXI_TASK_NAVIGATION && params.functionDeclaration !== LINGXI_TASK_SUBMISSION && params.functionDeclaration !== LINGXI_EDITOR_SELECTION) { reject(new LingxiDeliveryError("command_rejected", "灵犀请求不在安全白名单中。")); return; }
      if (method === "Input.insertText") {
        if (inputIssued || typeof params.text !== "string" || Buffer.byteLength(params.text, "utf8") > 10000) { reject(new LingxiDeliveryError("input_rejected", "灵犀输入过大或存在重复输入尝试，已停止。")); return; }
        inputIssued = true;
      }
      if (method === "Runtime.callFunctionOn" && params.functionDeclaration === LINGXI_TASK_NAVIGATION) {
        if (navigationIssued) { reject(new LingxiDeliveryError("navigation_repeated", "拒绝重复灵犀任务导航。")); return; }
        navigationIssued = true;
      }
      if (method === "Runtime.callFunctionOn" && params.functionDeclaration === LINGXI_TASK_SUBMISSION) {
        if (submissionIssued || !inputIssued) { reject(new LingxiDeliveryError("submission_rejected", "拒绝重复发送或未预填的灵犀发送。")); return; }
        submissionIssued = true;
      }
      if (method === "Runtime.callFunctionOn" && params.functionDeclaration === LINGXI_EDITOR_SELECTION) {
        if (selectionIssued || inputIssued || submissionIssued) { reject(new LingxiDeliveryError("selection_rejected", "拒绝重复全选或输入后的灵犀全选。")); return; }
        selectionIssued = true;
      }
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new LingxiDeliveryError("command_timeout", "灵犀 CDP 操作超时，不会自动重试。")); close(); }, 5000);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params }), error => { if (error) close(); });
    }),
  };
}