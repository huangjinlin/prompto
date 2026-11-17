import { execFile } from "child_process";
import * as http from "http";
import * as path from "path";
import WebSocket from "ws";
import { DESKTOP_INPUT_BYTE_LIMIT, normalizeText, record } from "./DesktopDriver";

export interface QoderCdpConnection {
  command(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>;
  page(verifyOwner?: boolean): Promise<{ id: string; url: string }>;
  close(): void;
}

export class QoderDeliveryError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

export const QODER_READ_NAME = 'function(expected) { return this.childElementCount === 0 && (this.textContent || "").trim() === expected; }';
export const QODER_EDITOR_TEXT = `function() {
  let decorated = false;
  const read = node => {
    if (node.nodeType === 3) return node.nodeValue || "";
    if (node.nodeType !== 1) return "";
    if (node.tagName === "SPAN" && node.getAttribute("data-editor-offset-ignored") === "true" && node.getAttribute("aria-hidden") === "true" && (node.getAttribute("data-editor-link-start-caret") === "true" || node.getAttribute("data-editor-link-favicon") === "true")) { decorated = true; return ""; }
    if (node.tagName === "A" && node.getAttribute("data-editor-link") === "true") decorated = true;
    if (node.tagName === "BR") { decorated = true; return "\\n"; }
    let text = "";
    for (let child = node.firstChild; child; child = child.nextSibling) text += read(child);
    return text;
  };
  const text = read(this);
  return { text, decorated };
}`;
export const QODER_READ_STATE = 'function() { return { connected: this.isConnected, active: this.ownerDocument.activeElement === this, value: this.textContent || "", visibleValue: this.innerText || "" }; }';
export const QODER_READ_SELECTION = `function() {
  const selection = this.ownerDocument.getSelection();
  const inside = node => { for (; node; node = node.parentNode) if (node === this) return true; return false; };
  const ignored = node => node.nodeType === 1 && node.tagName === "SPAN" && node.getAttribute("data-editor-offset-ignored") === "true" && node.getAttribute("aria-hidden") === "true" && (node.getAttribute("data-editor-link-start-caret") === "true" || node.getAttribute("data-editor-link-favicon") === "true");
  const boundary = (node, offset, end) => {
    if (!node || offset !== (end ? node.nodeType === 3 ? (node.nodeValue || "").length : node.childNodes.length : 0)) return false;
    for (; node && node !== this; node = node.parentNode) {
      for (let sibling = end ? node.nextSibling : node.previousSibling; sibling; sibling = end ? sibling.nextSibling : sibling.previousSibling) if (!ignored(sibling)) return false;
    }
    return node === this;
  };
  const anchorInside = Boolean(selection && inside(selection.anchorNode));
  const focusInside = Boolean(selection && inside(selection.focusNode));
  const coversAll = Boolean(selection && !selection.isCollapsed && ((boundary(selection.anchorNode, selection.anchorOffset, false) && boundary(selection.focusNode, selection.focusOffset, true)) || (boundary(selection.focusNode, selection.focusOffset, false) && boundary(selection.anchorNode, selection.anchorOffset, true))));
  return { active: this.ownerDocument.activeElement === this, inside: anchorInside && focusInside, collapsed: Boolean(selection && selection.isCollapsed), coversAll: anchorInside && focusInside && coversAll, atEnd: Boolean(selection && focusInside && boundary(selection.focusNode, selection.focusOffset, true)) };
}`;
export const QODER_TASK_NAVIGATION = `function(sessionId, title, href) {
  const row = this.closest('[data-sidebar-session="work-directory"]');
  const names = this.querySelectorAll("span");
  if (!this.isConnected || this.tagName !== "A" || !this.hasAttribute("data-sidebar-session-link") || this.getAttribute("href") !== href || !row || row.getAttribute("data-session-id") !== sessionId || !Array.from(names).some(name => name.textContent.trim() === title)) throw new Error("Target changed");
  const box = this.getBoundingClientRect();
  if (box.width <= 0 || box.height <= 0) throw new Error("Target unavailable");
  this.click();
}`;
export const QODER_TASK_SUBMISSION = `function(sessionId, title, url, expected) {
  const document = this.ownerDocument;
  const sidebars = document.querySelectorAll(".loop-chrome-sidebar");
  const composers = document.querySelectorAll('[class~="group/chat-composer"]');
  const headings = Array.from(document.querySelectorAll("h1")).filter(node => { const box = node.getBoundingClientRect(); return box.width > 0 && box.height > 0; });
  if (document.location.href !== url || sidebars.length !== 1 || composers.length !== 1 || headings.length !== 1 || headings[0].textContent.trim() !== title) throw new Error("Target changed");
  const active = Array.from(sidebars[0].querySelectorAll('[data-sidebar-session][data-active="true"]'));
  if (!active.length || active.some(row => row.getAttribute("data-session-id") !== sessionId)) throw new Error("Target changed");
  const composer = composers[0];
  const fields = document.querySelectorAll('.loop-rich-editor[contenteditable="true"][role="textbox"]');
  if (!this.isConnected || !composer.contains(this) || fields.length !== 1 || !composer.contains(fields[0]) || document.activeElement !== fields[0]) throw new Error("Input changed");
  const field = fields[0];
  if (field.hasAttribute("disabled") || field.hasAttribute("readonly") || field.getAttribute("aria-disabled") === "true" || field.getAttribute("aria-readonly") === "true") throw new Error("Input changed");
  const matches = value => value === expected || value === "\\u200B" + expected || value === expected + "\\u200B";
  const logical = (${QODER_EDITOR_TEXT}).call(field);
  if (!matches(logical.text.replace(/\\r\\n?/g, "\\n")) || (!logical.decorated && (!matches((field.textContent || "").replace(/\\r\\n?/g, "\\n")) || !matches((field.innerText || "").replace(/\\r\\n?/g, "\\n"))))) throw new Error("Draft changed");
  const buttons = Array.from(composer.querySelectorAll("button,[role=button]")).filter(button => { const box = button.getBoundingClientRect(); return box.width > 0 && box.height > 0; });
  const label = button => (button.getAttribute("aria-label") || "") + " " + (button.getAttribute("title") || "");
  if (buttons.some(button => /停止|取消|中止|\\bstop\\b|\\bcancel\\b/i.test(label(button)))) throw new Error("Task busy");
  const senders = buttons.filter(button => /发送|\\bsend\\b/i.test(label(button)));
  if (senders.length !== 1 || senders[0] !== this || this.disabled || this.getAttribute("aria-disabled") === "true") throw new Error("Send unavailable");
  const box = field.getBoundingClientRect();
  if (box.width <= 0 || box.height <= 0) throw new Error("Input unavailable");
  this.click();
}`;

export interface QoderInputAction { method: string; params: Record<string, unknown>; }

export function qoderKeyPair(key: string, code: string, virtualKey: number, modifiers: number, text?: string): QoderInputAction[] {
  const params = { key, code, windowsVirtualKeyCode: virtualKey, nativeVirtualKeyCode: virtualKey, modifiers };
  return [
    { method: "Input.dispatchKeyEvent", params: { ...params, type: "keyDown", ...(text === undefined ? {} : { text, unmodifiedText: text }) } },
    { method: "Input.dispatchKeyEvent", params: { ...params, type: "keyUp" } },
  ];
}

export function qoderInputPlan(content: string): QoderInputAction[] {
  if (typeof content !== "string" || !content.trim() || Buffer.byteLength(content, "utf8") > DESKTOP_INPUT_BYTE_LIMIT || content.includes("\u200B") || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(content)) {
    throw new QoderDeliveryError("invalid_content", "Qoder 内容为空、含不支持的控制字符或超过 10000 UTF-8 字节，未输入。");
  }
  const plan = [...qoderKeyPair("a", "KeyA", 65, 2), ...qoderKeyPair("Backspace", "Backspace", 8, 0)];
  normalizeText(content).split("\n").forEach((line, index) => {
    if (index) plan.push(...qoderKeyPair("Enter", "Enter", 13, 8, "\r"));
    if (line) plan.push({ method: "Input.insertText", params: { text: line } });
  });
  return plan;
}

export function validateQoderPort(port: number): void {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new QoderDeliveryError("invalid_port", "Qoder CDP 端口必须是 1024-65535 的整数。");
}

export function selectQoderPage(inventory: unknown, port: number): { id: string; url: string; endpoint: string } {
  validateQoderPort(port);
  if (!Array.isArray(inventory)) throw new QoderDeliveryError("invalid_inventory", "Qoder CDP 页面清单无效。");
  const candidates = inventory.map(record).filter(item => {
    try { const url = new URL(String(item.url)); return item.type === "page" && url.protocol === "qoder-cn-app:" && !url.username && !url.password; }
    catch { return false; }
  });
  if (candidates.length !== 1) throw new QoderDeliveryError("page_not_unique", "Qoder 内容页缺失或不唯一，请只保留一个目标窗口。");
  const candidate = candidates[0];
  let endpoint: URL;
  try { endpoint = new URL(String(candidate.webSocketDebuggerUrl)); }
  catch { throw new QoderDeliveryError("invalid_endpoint", "Qoder 调试地址无效。"); }
  if (typeof candidate.id !== "string" || !/^[A-Za-z0-9_-]+$/.test(candidate.id) || endpoint.protocol !== "ws:" || endpoint.hostname !== "127.0.0.1" || endpoint.port !== String(port) || endpoint.pathname !== `/devtools/page/${candidate.id}` || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new QoderDeliveryError("invalid_endpoint", "拒绝非回环或不匹配的 Qoder CDP 地址。");
  }
  return { id: candidate.id, url: String(candidate.url), endpoint: endpoint.href };
}

export function createQoderCommandGate(content: string): (method: string, params: Record<string, unknown>) => boolean {
  const plan = qoderInputPlan(content);
  const readMethods = new Set(["DOM.getDocument", "DOM.querySelectorAll", "DOM.describeNode", "DOM.getBoxModel", "DOM.resolveNode", "DOM.pushNodesByBackendIdsToFrontend"]);
  let focused = false;
  let next = 0;
  let navigated = false;
  let submitted = false;
  return (method, params) => {
    if (readMethods.has(method)) return true;
    if (method === "Runtime.callFunctionOn") {
      if (params.returnByValue !== true) return false;
      if (params.functionDeclaration === QODER_TASK_NAVIGATION && !navigated && !focused && next === 0) { navigated = true; return true; }
      if (params.functionDeclaration === QODER_TASK_SUBMISSION && !submitted && next === plan.length) { submitted = true; return true; }
      return params.throwOnSideEffect === true && [QODER_READ_NAME, QODER_READ_STATE, QODER_READ_SELECTION].includes(String(params.functionDeclaration));
    }
    if (method === "DOM.focus" && !focused && next === 0 && Object.keys(params).length === 1 && Number.isInteger(params.nodeId) && Number(params.nodeId) > 0) { focused = true; return true; }
    const action = plan[next];
    if (!focused || !action || method !== action.method || Object.keys(params).length !== Object.keys(action.params).length || !Object.keys(action.params).every(key => params[key] === action.params[key])) return false;
    next++;
    return true;
  };
}

function inventory(port: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const fail = () => reject(new QoderDeliveryError("cdp_unavailable", "无法连接 Qoder CDP，请完全退出 Qoder 后从 CDP 专用快捷方式启动。"));
    const request = http.get({ hostname: "127.0.0.1", port, path: "/json/list", agent: false }, response => {
      if (response.statusCode !== 200) { response.resume(); fail(); return; }
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on("data", (chunk: Buffer) => { bytes += chunk.length; if (bytes > 262144) { request.destroy(); fail(); } else chunks.push(chunk); });
      response.on("error", fail);
      response.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch { fail(); } });
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
      try {
        if (error) throw error;
        const value = record(JSON.parse(stdout.trim().replace(/^\uFEFF/, "")));
        if (!Number.isInteger(value.pid) || Number(value.pid) <= 0 || typeof value.executable !== "string" || !value.executable) throw new Error();
        resolve({ pid: Number(value.pid), executable: value.executable });
      } catch { reject(new QoderDeliveryError("owner_unverified", "无法核验 Qoder 本机端口所属进程，已停止。")); }
    });
  });
}

export function resolveQoderExecutable(actual: string, configured: string, localAppData = process.env.LOCALAPPDATA ?? ""): string {
  const windowsPath = path.win32;
  const valid = (value: string) => windowsPath.isAbsolute(value) && windowsPath.extname(value).toLowerCase() === ".exe";
  const explicit = configured.trim();
  if (explicit && !valid(explicit)) throw new QoderDeliveryError("invalid_executable", "Qoder CDP 需要绝对 exe 路径。");
  if (valid(actual)) {
    const resolved = windowsPath.resolve(actual);
    if (explicit) {
      if (resolved.toLowerCase() === windowsPath.resolve(explicit).toLowerCase()) return resolved;
    } else if (windowsPath.isAbsolute(localAppData)) {
      const root = windowsPath.join(localAppData, "Programs", "Qoder CN");
      const parts = windowsPath.relative(root, resolved).split(windowsPath.sep);
      if (parts.length === 3 && parts[0].toLowerCase() === ".qoder-versions" && parts[1] && parts[1] !== "." && parts[1] !== ".." && parts[2].toLowerCase() === "qoder cn.exe") return resolved;
    }
  }
  throw new QoderDeliveryError("owner_mismatch", explicit
    ? "CDP 端口不属于配置的 Qoder 程序；如已升级，请清空旧 executablePath 以自动识别标准安装目录，或更新为当前完整路径。"
    : "CDP 端口不属于标准安装目录中的 Qoder CN 程序；非标准安装请在用户设置中指定 qoder.executablePath，拒绝连接。");
}

export async function createQoderCdpConnection(port: number, executable: string, content: string): Promise<QoderCdpConnection> {
  validateQoderPort(port);
  const permitted = createQoderCommandGate(content);
  if (process.platform !== "win32") throw new QoderDeliveryError("invalid_executable", "Qoder CDP 需要本地 Windows。");
  const initialOwner = await owner(port);
  const expected = resolveQoderExecutable(initialOwner.executable, executable).toLowerCase();
  const target = selectQoderPage(await inventory(port), port);
  const socket = new WebSocket(target.endpoint, { handshakeTimeout: 5000, maxPayload: 8388608, perMessageDeflate: false });
  const pending = new Map<number, { resolve(value: Record<string, unknown>): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  let sequence = 0;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new QoderDeliveryError("connection_closed", "Qoder CDP 连接已中断，不会重试。")); }
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
    if (message.error) request.reject(new QoderDeliveryError("protocol_failure", "Qoder CDP 操作被拒绝，不会自动重试。"));
    else request.resolve(record(message.result));
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { close(); reject(new QoderDeliveryError("connect_timeout", "Qoder CDP 连接超时。")); }, 6000);
      socket.once("open", () => { clearTimeout(timer); resolve(); });
      socket.once("error", () => { clearTimeout(timer); reject(new QoderDeliveryError("connect_failed", "Qoder CDP 连接失败。")); });
      socket.once("close", () => { clearTimeout(timer); reject(new QoderDeliveryError("connection_closed", "Qoder CDP 连接已关闭。")); });
    });
  } catch (error) { close(); throw error; }
  return {
    close,
    page: async (verifyOwner = true) => {
      if (closed || socket.readyState !== WebSocket.OPEN) throw new QoderDeliveryError("connection_closed", "Qoder CDP 连接已关闭。");
      if (verifyOwner) {
        const currentOwner = await owner(port);
        if (closed || currentOwner.pid !== initialOwner.pid || path.resolve(currentOwner.executable).toLowerCase() !== expected) throw new QoderDeliveryError("owner_changed", "Qoder 进程身份已变化，已停止。");
      }
      const current = selectQoderPage(await inventory(port), port);
      if (current.id !== target.id || current.endpoint !== target.endpoint) throw new QoderDeliveryError("page_changed", "Qoder 页面身份已变化，已停止。");
      return { id: current.id, url: current.url };
    },
    command: (method, params = {}) => new Promise((resolve, reject) => {
      if (closed || socket.readyState !== WebSocket.OPEN) { reject(new QoderDeliveryError("connection_closed", "Qoder CDP 连接已关闭。")); return; }
      if (!permitted(method, params)) { reject(new QoderDeliveryError("command_rejected", "Qoder 请求不符合已绑定的单次动作计划。")); return; }
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new QoderDeliveryError("command_timeout", "Qoder CDP 操作超时，不会重试。")); close(); }, 5000);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params }), error => { if (error) close(); });
    }),
  };
}