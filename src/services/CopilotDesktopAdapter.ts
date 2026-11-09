import { DesktopChatAdapter, DesktopNode, nodes, one, ref, success, normalizeText, multilineInputPlan } from "./DesktopDriver";

function activeTitle(chat: DesktopNode): string | undefined {
  const pickers = nodes(chat).filter(node => node.role === "button" && node.name === "选取代理会话");
  if (!pickers.length) return undefined;
  const labels = nodes(one(pickers, "Active session picker")).filter(node => node.role === "statictext" && node.name).map(node => node.name);
  return labels[labels.length - 1];
}

export const copilotDesktopAdapter: DesktopChatAdapter = {
  appName: "Code.exe",
  scopedSnapshots: true,
  requiresReceiptFocus: true,
  requiresWorkspace: false,
  allowBackgroundFocus: false,
  findWindow(windows, workspaceName) {
    const windowName = workspaceName.replace(/\s/g, "");
    const matching = windows.filter(window => typeof window.title === "string" && window.title.split(" - ").some(part => part.replace(/\s/g, "") === windowName));
    if (!workspaceName || matching.length !== 1) throw new Error("The local VS Code workspace window cannot be identified uniquely.");
    return matching[0];
  },
  observationRoot(tree) {
    return one(nodes(tree).filter(node => node.native_id?.value === "workbench.panel.chat"), "Copilot panel");
  },
  activeTitle,
  assertTarget(chat, title) {
    if (activeTitle(chat) !== title) throw new Error("The active Copilot session does not match the requested title.");
  },
  assertIdle(chat) {
    if (nodes(chat).some(node => node.role === "button" && /^(取消|停止)(?:\s|[（(]|$)/.test(node.name ?? ""))) {
      throw new Error("The target session is generating a response. Nothing new will be submitted.");
    }
  },
  async navigate(chat, title, _workspaceName, { run, snapshot, reportProgress }) {
    let outlines = nodes(chat).filter(node => node.role === "outline" && node.name === "智能体会话");
    if (activeTitle(chat) !== undefined && activeTitle(chat) !== title) {
      reportProgress("返回主会话列表");
      const back = one(nodes(chat).filter(node => node.role === "button" && /^返回(?:\s|[（(]|$)/.test(node.name ?? "")), "Session title back arrow");
      success(await run(["click", ref(back), "--timeout-ms", "30000"]));
      for (let observation = 0; observation < 3; observation++) {
        chat = await snapshot();
        outlines = nodes(chat).filter(node => node.role === "outline" && node.name === "智能体会话");
        if (outlines.length === 1 && activeTitle(chat) === undefined) break;
      }
      if (activeTitle(chat) !== undefined) throw new Error("The back arrow did not open the main session list.");
    }
    const outline = one(outlines, "Visible session history");
    const rows = nodes(outline).filter(node => {
      if (node.role !== "treeitem") return false;
      const labels = nodes(node).filter(child => child.role === "statictext" && child.name && !/^[\uE000-\uF8FF]+$/.test(child.name)).map(child => child.name);
      return labels[0] === title;
    });
    const row = one(rows, "Requested visible session");
    if (!row.name) throw new Error("The session row has no selectable identity.");
    if (activeTitle(chat) !== title) {
      reportProgress("切换目标会话");
      success(await run(["select", ref(outline), row.name, "--timeout-ms", "30000"]));
      chat = await snapshot();
    }
    return chat;
  },
  inputField(chat) {
    return one(nodes(chat).filter(node => node.role === "textfield" && node.name?.startsWith("聊天输入")), "Unique chat input (enable VS Code screen reader support)");
  },
  sendButton(chat) {
    const button = one(nodes(chat).filter(node => node.role === "button" && /^发送(?:\s|\[|$)/.test(node.name ?? "")), "Default send button");
    if (button.states?.includes("disabled")) throw new Error("The send button is disabled.");
    return button;
  },
  requestCount(chat, content) {
    const messages = one(nodes(chat).filter(node => node.role === "list" && node.name === "聊天"), "Chat messages");
    return nodes(messages).filter(node => node.role === "option" && normalizeText(node.name ?? "").trim() === normalizeText(content).trim() &&
      nodes(node).some(child => child.role === "button" && child.name === "从此处派生对话")).length;
  },
  inputPlan: multilineInputPlan,
};