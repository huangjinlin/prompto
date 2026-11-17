import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";

export interface DesktopReply {
  ok: boolean;
  data?: unknown;
  error?: { code?: string; message?: string; details?: { physical_delivery_started?: boolean }; disposition?: { delivery?: string; retry?: string } };
}

export type DesktopRunner = (args: string[], input?: string) => Promise<DesktopReply>;

export interface DesktopDeliveryResult {
  status: "verified" | "apiDispatched" | "notDelivered" | "uncertain";
  detail: string;
}

export interface DesktopNode {
  role?: string;
  name?: string;
  ref_id?: string;
  native_id?: { value?: string };
  states?: string[];
  children?: DesktopNode[];
}

export interface DesktopWindow {
  id: string;
  title: string;
  visible: boolean;
  minimized: boolean;
  is_focused: boolean;
  accessible: boolean;
}

export const DESKTOP_INPUT_BYTE_LIMIT = 10000;

export type DesktopInputStep = { text: string } | { key: "shift+enter" } | { paste: string };

export interface DesktopNavigationContext {
  run: DesktopRunner;
  snapshot: () => Promise<DesktopNode>;
  reportProgress: (message: string) => void;
}

export interface DesktopChatAdapter {
  appName: string;
  scopedSnapshots: boolean;
  requiresReceiptFocus: boolean;
  requiresExactDraft: boolean;
  requiresWorkspace: boolean;
  allowBackgroundFocus: boolean;
  minimizedWindowPolicy: "reject" | "restoreAndMaximize";
  findWindow(windows: DesktopWindow[], workspaceName: string): DesktopWindow;
  observationRoot(tree: DesktopNode): DesktopNode;
  activeTitle(tree: DesktopNode): string | undefined;
  assertTarget(tree: DesktopNode, title: string, workspaceName: string): void;
  assertIdle(tree: DesktopNode): void;
  navigate(tree: DesktopNode, title: string, workspaceName: string, context: DesktopNavigationContext): Promise<DesktopNode>;
  inputField(tree: DesktopNode): DesktopNode;
  sendButton(tree: DesktopNode): DesktopNode;
  requestCount(tree: DesktopNode, content: string): number;
  inputPlan(content: string): DesktopInputStep[];
}

export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function nodes(root: DesktopNode): DesktopNode[] {
  if (!root || typeof root !== "object" || root.states?.some(state => state === "offscreen" || state === "hidden")) return [];
  return [root, ...(Array.isArray(root.children) ? root.children.flatMap(nodes) : [])];
}

export function one(candidates: DesktopNode[], label: string): DesktopNode {
  if (candidates.length !== 1) throw new Error(`${label} is missing or ambiguous.`);
  return candidates[0];
}

export function ref(node: DesktopNode): string {
  if (!node.ref_id?.startsWith("@")) throw new Error("A fresh desktop reference is unavailable.");
  return node.ref_id;
}

export function success(reply: DesktopReply): DesktopReply {
  if (!reply.ok) {
    const unsafePermissions = typeof reply.error?.message === "string" &&
      reply.error.message.includes("private file DACL grants an untrusted principal");
    const failedFocus = typeof reply.error?.message === "string" &&
      (reply.error.message.includes("Target window did not become foreground before headed delivery") ||
        reply.error.message.includes("Window focus did not settle on the requested window"));
    const detail = unsafePermissions
      ? " agent-desktop 私有状态文件的访问控制列表（DACL）包含未受信任主体，请修复该目录权限后重试；不要以管理员身份运行投放或绕过权限检查。"
      : failedFocus ? " 目标窗口未能获得或保持前台焦点。请先手动激活目标软件再尝试投放；不会自动重试激活。" : "";
    throw new Error(`agent-desktop operation failed (${reply.error?.code ?? "unknown"}).${detail}`);
  }
  return reply;
}

export function normalizeText(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

export function multilineInputPlan(content: string): DesktopInputStep[] {
  const plan: DesktopInputStep[] = [];
  normalizeText(content).split("\n").forEach((line, index) => {
    if (index) plan.push({ key: "shift+enter" });
    if (line.length) plan.push({ text: line });
  });
  return plan;
}

export function resolveDesktopExecutable(configuredPath: string = ""): string {
  const explicitPath = configuredPath.trim();
  if (explicitPath && (!path.isAbsolute(explicitPath) || path.extname(explicitPath).toLowerCase() !== ".exe")) {
    throw new Error("prompto.desktop.executablePath must be an absolute native .exe path, not a Shell script.");
  }
  const binaryName = `agent-desktop-win32-${process.arch}.exe`;
  const directories = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const candidates = explicitPath ? [explicitPath] : directories.flatMap(directory => [
    path.join(directory, "agent-desktop.exe"),
    path.join(directory, binaryName),
    path.join(directory, "node_modules", "agent-desktop", "bin", binaryName),
  ]);
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      continue;
    }
  }
  throw new Error("agent-desktop native executable not found. Install it globally or configure prompto.desktop.executablePath.");
}

export function createDesktopRunner(executable: string): DesktopRunner {
  return (args, input) => new Promise((resolve, reject) => {
    if (input !== undefined && (typeof input !== "string" || Buffer.byteLength(input, "utf8") > DESKTOP_INPUT_BYTE_LIMIT)) {
      reject(new Error("Desktop stdin must be a UTF-8 string of at most 10000 bytes."));
      return;
    }
    const env = { ...process.env };
    delete env.AGENT_DESKTOP_SESSION;
    delete env.AGENT_DESKTOP_AGENT_ID;
    let program = executable;
    if (args[0] === "clipboard-formats") {
      if (process.platform !== "win32" || args.length !== 1 || input !== undefined) {
        reject(new Error("Clipboard format inspection requires local Windows."));
        return;
      }
      program = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
      args = ["-NoProfile", "-NonInteractive", "-STA", "-Command",
        "$ErrorActionPreference='Stop'; try { Add-Type -AssemblyName System.Windows.Forms; $data=[System.Windows.Forms.Clipboard]::GetDataObject(); $formats=@(); if($null -ne $data){$formats=@($data.GetFormats($false))}; @{ok=$true;data=@{formats=$formats}} | ConvertTo-Json -Compress -Depth 3 } catch { @{ok=$false;error=@{code='CLIPBOARD_UNAVAILABLE'}} | ConvertTo-Json -Compress -Depth 3 }"];
    }
    const child = spawn(program, args, { windowsHide: true, env, stdio: ["pipe", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let byteLength = 0;
    let settled = false;
    const finish = (error?: Error, reply?: DesktopReply) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      if (error) reject(error);
      else resolve(reply!);
    };
    const deadline = setTimeout(() => {
      child.kill();
      finish(new Error("agent-desktop command timed out."));
    }, 130000);
    child.stdout.on("data", (chunk: Buffer) => {
      byteLength += chunk.length;
      if (byteLength > 8 * 1024 * 1024) {
        child.kill();
        finish(new Error("agent-desktop response exceeded the observation limit."));
        return;
      }
      chunks.push(chunk);
    });
    child.stderr.resume();
    child.stdin.on("error", () => undefined);
    child.on("error", () => finish(new Error("Could not start agent-desktop native executable.")));
    child.on("close", () => {
      try {
        const reply = JSON.parse(Buffer.concat(chunks).toString("utf8")) as DesktopReply;
        if (!reply || typeof reply.ok !== "boolean") throw new Error("Invalid envelope");
        finish(undefined, reply);
      } catch {
        finish(new Error("agent-desktop returned an unreadable response."));
      }
    });
    child.stdin.end(input === undefined ? undefined : Buffer.from(input, "utf8"));
  });
}