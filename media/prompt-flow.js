(function () {
  "use strict";

  const vscode = acquireVsCodeApi();

  // ── 状态 ──
  let currentGraph = null;
  let highlightedNodeId = null;

  // ── 布局常量 ──
  const NODE_WIDTH = 140;
  const NODE_HEIGHT = 40;
  const LAYER_GAP = 80;
  const NODE_GAP = 30;
  const PADDING = 20;

  // ── 初始化 ──
  function init() {
    window.addEventListener("message", handleMessage);
    vscode.postMessage({ type: "ready" });
  }

  function handleMessage(event) {
    const msg = event.data;
    if (msg.type === "updateFlow") {
      currentGraph = msg.graph;
      render();
    } else if (msg.type === "highlightNode") {
      highlightedNodeId = msg.nodeId;
      updateHighlight();
    }
  }

  // ── 渲染 ──
  function render() {
    const container = document.getElementById("flow-container");
    if (!currentGraph || !currentGraph.nodes || currentGraph.nodes.length === 0) {
      container.innerHTML =
        '<div class="empty-state"><div class="icon">⊞</div><div>No flow nodes found</div><div style="font-size:11px">Add flow metadata to your markdown headings</div></div>';
      return;
    }

    const layout = computeLayout(currentGraph);
    const svgWidth = layout.width + PADDING * 2;
    const svgHeight = layout.height + PADDING * 2;

    let html = "";

    // 标题栏
    html += '<div class="flow-header">';
    html += '<span class="title">' + escapeHtml(currentGraph.title || "Flow Graph") + "</span>";
    html += '<div class="actions">';
    html += '<button onclick="fitView()">Fit</button>';
    html += "</div></div>";

    // SVG
    html += '<svg class="flow-svg" viewBox="0 0 ' + svgWidth + " " + svgHeight + '" width="' + svgWidth + '" height="' + svgHeight + '">';
    html += '<defs><marker id="arrowhead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto"><polygon points="0 0, 10 3.5, 0 7" fill="var(--flow-edge)"/></marker></defs>';

    // 边
    for (const edge of layout.edges) {
      html += renderEdge(edge);
    }

    // 节点
    for (const node of layout.nodes) {
      html += renderNode(node);
    }

    html += "</svg>";

    // 诊断
    if (currentGraph.diagnostics && currentGraph.diagnostics.length > 0) {
      html += '<div class="flow-diagnostics">';
      for (const d of currentGraph.diagnostics) {
        html += '<div class="diagnostic">' + escapeHtml(d.message) + "</div>";
      }
      html += "</div>";
    }

    container.innerHTML = html;
    updateHighlight();
  }

  function renderNode(node) {
    const x = node.x + PADDING;
    const y = node.y + PADDING;
    const w = NODE_WIDTH;
    const h = NODE_HEIGHT;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const color = getNodeColor(node.kind);
    const cls = "flow-node" + (node.id === highlightedNodeId ? " highlighted" : "");

    let shape = "";
    if (node.kind === "start" || node.kind === "end") {
      // 圆角矩形
      shape = '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="' + h / 2 + '" fill="' + color + '"/>';
    } else if (node.kind === "decision") {
      // 菱形
      const points = cx + "," + y + " " + (x + w) + "," + cy + " " + cx + "," + (y + h) + " " + x + "," + cy;
      shape = '<polygon points="' + points + '" fill="' + color + '"/>';
    } else {
      // 矩形
      shape = '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="4" fill="' + color + '"/>';
    }

    let label = node.title;
    if (label.length > 10) {
      label = label.substring(0, 9) + "…";
    }

    return (
      '<g class="' + cls + '" data-id="' + node.id + '" data-line="' + node.line + '" onclick="onNodeClick(\'' + node.id + "'," + node.line + ')">' +
      shape +
      '<text class="label" x="' + cx + '" y="' + cy + '">' + escapeHtml(label) + "</text>" +
      "</g>"
    );
  }

  function renderEdge(edge) {
    const sx = edge.sx + PADDING;
    const sy = edge.sy + PADDING;
    const ex = edge.ex + PADDING;
    const ey = edge.ey + PADDING;

    // 贝塞尔曲线
    const midY = (sy + ey) / 2;
    const d = "M " + sx + " " + sy + " C " + sx + " " + midY + " " + ex + " " + midY + " " + ex + " " + ey;

    let html = '<path class="flow-edge" d="' + d + '"/>';

    if (edge.label) {
      const mx = (sx + ex) / 2;
      const my = midY;
      html += '<text class="flow-edge-label" x="' + mx + '" y="' + (my - 6) + '">' + escapeHtml(edge.label) + "</text>";
    }

    return html;
  }

  // ── 布局算法 ──
  function computeLayout(graph) {
    const nodes = graph.nodes;
    const edges = graph.edges;

    // 构建邻接表和入度
    const nodeMap = {};
    const inDegree = {};
    const adj = {};

    for (const n of nodes) {
      nodeMap[n.id] = n;
      inDegree[n.id] = 0;
      adj[n.id] = [];
    }

    for (const e of edges) {
      if (nodeMap[e.from] && nodeMap[e.to]) {
        adj[e.from].push(e.to);
        inDegree[e.to]++;
      }
    }

    // 拓扑排序分层
    const layers = [];
    const visited = new Set();
    const queue = [];

    for (const id in inDegree) {
      if (inDegree[id] === 0) {
        queue.push(id);
      }
    }

    // 如果没有入度为 0 的节点，从 entry 开始
    if (queue.length === 0 && graph.entry && nodeMap[graph.entry]) {
      queue.push(graph.entry);
    }

    while (queue.length > 0) {
      const layer = [];
      const nextQueue = [];

      while (queue.length > 0) {
        const id = queue.shift();
        if (visited.has(id)) continue;
        visited.add(id);
        layer.push(id);

        for (const neighbor of adj[id]) {
          inDegree[neighbor]--;
          if (inDegree[neighbor] <= 0 && !visited.has(neighbor)) {
            nextQueue.push(neighbor);
          }
        }
      }

      if (layer.length > 0) {
        layers.push(layer);
      }
      queue.push(...nextQueue);
    }

    // 处理未访问的节点（循环等情况）
    for (const n of nodes) {
      if (!visited.has(n.id)) {
        layers.push([n.id]);
        visited.add(n.id);
      }
    }

    // 计算坐标
    const nodePositions = {};
    let maxLayerWidth = 0;

    for (let li = 0; li < layers.length; li++) {
      const layer = layers[li];
      const layerWidth = layer.length * (NODE_WIDTH + NODE_GAP) - NODE_GAP;
      maxLayerWidth = Math.max(maxLayerWidth, layerWidth);
      const startX = -layerWidth / 2;

      for (let ni = 0; ni < layer.length; ni++) {
        const id = layer[ni];
        nodePositions[id] = {
          x: startX + ni * (NODE_WIDTH + NODE_GAP),
          y: li * (NODE_HEIGHT + LAYER_GAP),
        };
      }
    }

    // 计算画布尺寸
    const allX = Object.values(nodePositions).map((p) => p.x);
    const allY = Object.values(nodePositions).map((p) => p.y);
    const minX = Math.min(...allX);
    const maxX = Math.max(...allX) + NODE_WIDTH;
    const maxY = Math.max(...allY) + NODE_HEIGHT;

    // 平移使所有坐标为正
    const offsetX = -minX;

    const layoutNodes = nodes
      .filter((n) => nodePositions[n.id])
      .map((n) => ({
        ...n,
        x: nodePositions[n.id].x + offsetX,
        y: nodePositions[n.id].y,
      }));

    const layoutEdges = edges
      .filter((e) => nodePositions[e.from] && nodePositions[e.to])
      .map((e) => ({
        label: e.label,
        sx: nodePositions[e.from].x + offsetX + NODE_WIDTH / 2,
        sy: nodePositions[e.from].y + NODE_HEIGHT,
        ex: nodePositions[e.to].x + offsetX + NODE_WIDTH / 2,
        ey: nodePositions[e.to].y,
      }));

    return {
      nodes: layoutNodes,
      edges: layoutEdges,
      width: maxX - minX + NODE_WIDTH,
      height: maxY + NODE_HEIGHT,
    };
  }

  // ── 工具函数 ──
  function getNodeColor(kind) {
    switch (kind) {
      case "start":
        return "var(--flow-start)";
      case "decision":
        return "var(--flow-decision)";
      case "end":
        return "var(--flow-end)";
      default:
        return "var(--flow-action)";
    }
  }

  function updateHighlight() {
    document.querySelectorAll(".flow-node").forEach((el) => {
      el.classList.toggle("highlighted", el.dataset.id === highlightedNodeId);
    });
  }

  function escapeHtml(text) {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ── 全局事件 ──
  window.onNodeClick = function (nodeId, line) {
    vscode.postMessage({ type: "locateNode", line: line });
  };

  window.fitView = function () {
    const svg = document.querySelector(".flow-svg");
    if (svg) {
      svg.style.width = "100%";
      svg.style.height = "auto";
    }
  };

  init();
})();
