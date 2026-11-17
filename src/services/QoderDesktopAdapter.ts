import { DesktopChatAdapter, DesktopNode, nodes, one, ref, success, normalizeText } from "./DesktopDriver";

function conversation(tree: DesktopNode): DesktopNode {
  return one(nodes(tree).filter(node => node.native_id?.value === "conversation"), "Qoder conversation region");
}

function targetLink(tree: DesktopNode, title: string, workspaceName: string): DesktopNode {
  const all = nodes(tree);
  const workspace = one(all.filter(node => node.children?.some(child => child.role === "menubutton" && child.name === workspaceName)), "Visible Qoder workspace");
  const link = one(all.filter(node => node.role === "link" && node.name?.startsWith(`任务“${title}”，Agent：`)), "Unique visible Qoder task title");
  if (!nodes(workspace).includes(link)) throw new Error("The Qoder task does not belong to the requested workspace.");
  return link;
}

function activeTitle(tree: DesktopNode): string | undefined {
  const menus = nodes(conversation(tree)).filter(node => node.role === "menubutton" && node.name?.startsWith("任务 ") && node.name.endsWith(" 操作"));
  if (!menus.length) return undefined;
  return one(menus, "Qoder active task menu").name!.slice(3, -3);
}

export const qoderDesktopAdapter: DesktopChatAdapter = {
  appName: "Qoder CN.exe",
  scopedSnapshots: false,
  requiresReceiptFocus: false,
  requiresExactDraft: false,
  requiresWorkspace: true,
  allowBackgroundFocus: true,
  minimizedWindowPolicy: "restoreAndMaximize",
  findWindow(windows, workspaceName) {
    if (!workspaceName.trim() || windows.length !== 1) throw new Error("Qoder requires an explicit workspace and one unambiguous application window.");
    return windows[0];
  },
  observationRoot(tree) {
    conversation(tree);
    return tree;
  },
  activeTitle,
  assertTarget(tree, title, workspaceName) {
    targetLink(tree, title, workspaceName);
    if (activeTitle(tree) !== title) throw new Error("The active Qoder task does not match the requested title.");
  },
  assertIdle(tree) {
    if (nodes(conversation(tree)).some(node => node.role === "button" && !node.states?.includes("disabled") &&
      /^(停止|取消)(?:$|\s|[（(]|生成|任务)/.test(node.name ?? ""))) {
      throw new Error("The Qoder task is generating a response.");
    }
  },
  async navigate(tree, title, workspaceName, { run, snapshot, reportProgress }) {
    const link = targetLink(tree, title, workspaceName);
    if (activeTitle(tree) !== title) {
      reportProgress("切换 Qoder 目标任务");
      success(await run(["click", ref(link), "--timeout-ms", "30000"]));
      for (let observation = 0; observation < 3; observation++) {
        tree = await snapshot();
        if (activeTitle(tree) === title) break;
      }
    }
    return tree;
  },
  inputField(tree) {
    return one(nodes(conversation(tree)).filter(node => node.role === "textfield" && node.name === "发送任务消息"), "Unique Qoder message input");
  },
  sendButton(tree) {
    const button = one(nodes(conversation(tree)).filter(node => node.role === "button" && node.name === "发送消息"), "Qoder send button");
    if (button.states?.includes("disabled")) throw new Error("The Qoder send button is disabled.");
    return button;
  },
  requestCount(tree, content) {
    const history = (node: DesktopNode): DesktopNode[] => node.role === "textfield" ? [] : [node, ...(node.children ?? []).flatMap(history)];
    let count = 0;
    const visit = (node: DesktopNode, parents: DesktopNode[]) => {
      if (node.role === "textfield") return;
      if (node.role === "statictext" && normalizeText(node.name ?? "") === normalizeText(content)) {
        const user = [...parents].reverse().find(parent => {
          const descendants = history(parent);
          return descendants.some(child => child.role === "button" && /编辑.*重新发送/.test(child.name ?? "")) &&
            !descendants.some(child => child.role === "button" && child.name === "复制 Markdown");
        });
        if (user) count++;
      }
      for (const child of node.children ?? []) visit(child, [...parents, node]);
    };
    visit(conversation(tree), []);
    return count;
  },
  inputPlan(content) {
    return [{ paste: normalizeText(content) }];
  },
};