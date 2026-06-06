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

  // ── 变换状态 ──
  let scale = 1;
  let translateX = 0;
  let translateY = 0;
  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragStartTX = 0;
  let dragStartTY = 0;

  let graphWidth = 0;
  let graphHeight = 0;

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
    graphWidth = layout.width + PADDING * 2;
    graphHeight = layout.height + PADDING * 2;

    let html = "";

    // 标题栏
    html += '<div class="flow-header">';
    html += '<span class="title">' + escapeHtml(currentGraph.title || "Flow Graph") + "</span>";
    html += '<div class="actions">';
    html += '<button id="btn-fit">Fit</button>';
    html += '<button id="btn-zin">+</button>';
    html += '<button id="btn-zout">−</button>';
    html += "</div></div>";

    // 视口容器
    html += '<div class="flow-viewport" id="flow-viewport">';

    // SVG
    html += '<svg class="flow-svg" xmlns="http://www.w3.org/2000/svg">';
    html += '<defs><marker id="arrowhead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto"><polygon points="0 0, 10 3.5, 0 7" fill="var(--flow-edge)"/></marker></defs>';

    // <g> 包裹内容
    html += '<g id="flow-content">';

    for (const edge of layout.edges) {
      html += renderEdge(edge);
    }
    for (const node of layout.nodes) {
      html += renderNode(node);
    }

    html += "</g></svg></div>";

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

    // 绑定事件（必须在 innerHTML 之后用 addEventListener，CSP 禁止 onclick）
    bindButtons();
    resetTransform();
    setupInteractions();
  }

  function bindButtons() {
    var btnFit = document.getElementById("btn-fit");
    var btnZin = document.getElementById("btn-zin");
    var btnZout = document.getElementById("btn-zout");
    if (btnFit) btnFit.addEventListener("click", fitView);
    if (btnZin) btnZin.addEventListener("click", zoomIn);
    if (btnZout) btnZout.addEventListener("click", zoomOut);

    // 节点左键：定位
    // 节点右键：上下文菜单
    var viewport = document.getElementById("flow-viewport");
    if (viewport) {
      viewport.addEventListener("click", function (e) {
        var nodeEl = e.target.closest(".flow-node");
        if (nodeEl && !isDragging) {
          var line = parseInt(nodeEl.dataset.line, 10);
          vscode.postMessage({ type: "locateNode", line: line });
        }
      });

      viewport.addEventListener("contextmenu", function (e) {
        var nodeEl = e.target.closest(".flow-node");
        if (!nodeEl) return;
        e.preventDefault();

        var nodeId = nodeEl.dataset.id;
        var nodeData = findNodeById(nodeId);
        if (!nodeData || !nodeData.promptoItems || nodeData.promptoItems.length === 0) return;

        showContextMenu(e.clientX, e.clientY, nodeData);
      });
    }

    // 点击空白处关闭菜单
    document.addEventListener("click", function () {
      hideContextMenu();
    });
  }

  // ── 右键上下文菜单 ──

  function findNodeById(nodeId) {
    if (!currentGraph || !currentGraph.nodes) return null;
    for (var i = 0; i < currentGraph.nodes.length; i++) {
      if (currentGraph.nodes[i].id === nodeId) return currentGraph.nodes[i];
    }
    return null;
  }

  function showContextMenu(clientX, clientY, nodeData) {
    hideContextMenu();

    var menu = document.createElement("div");
    menu.className = "flow-context-menu";
    menu.id = "flow-context-menu";

    var hasMain = false;
    var hasAction = false;
    for (var i = 0; i < nodeData.promptoItems.length; i++) {
      if (!nodeData.promptoItems[i].isAction) hasMain = true;
      if (nodeData.promptoItems[i].isAction) hasAction = true;
    }

    for (var j = 0; j < nodeData.promptoItems.length; j++) {
      var item = nodeData.promptoItems[j];

      // 如果同时有主 prompto 和 action，加分隔线
      if (hasMain && hasAction && j > 0 && item.isAction && !menu.querySelector(".flow-context-separator")) {
        var sep = document.createElement("div");
        sep.className = "flow-context-separator";
        menu.appendChild(sep);
      }

      var el = document.createElement("div");
      el.className = "flow-context-item";
      if (item.isAction) {
        el.className += " action-item";
      }
      el.textContent = item.title;
      el.dataset.line = item.line;
      el.dataset.headingLine = nodeData.line;

      el.addEventListener("click", (function (itm) {
        return function (ev) {
          ev.stopPropagation();
          hideContextMenu();
          vscode.postMessage({
            type: "runPrompto",
            line: itm.line,
            headingLine: nodeData.line,
          });
        };
      })(item));

      menu.appendChild(el);
    }

    // 定位：用 clientX/Y，考虑 viewport 滚动偏移
    var viewport = document.getElementById("flow-viewport");
    var vpRect = viewport ? viewport.getBoundingClientRect() : { left: 0, top: 0 };
    menu.style.left = (clientX - vpRect.left) + "px";
    menu.style.top = (clientY - vpRect.top) + "px";

    var container = viewport || document.body;
    container.appendChild(menu);

    // 防止菜单超出边界
    requestAnimationFrame(function () {
      var menuRect = menu.getBoundingClientRect();
      var parentRect = container.getBoundingClientRect();
      if (menuRect.right > parentRect.right) {
        menu.style.left = Math.max(0, (clientX - vpRect.left) - menuRect.width) + "px";
      }
      if (menuRect.bottom > parentRect.bottom) {
        menu.style.top = Math.max(0, (clientY - vpRect.top) - menuRect.height) + "px";
      }
    });
  }

  function hideContextMenu() {
    var existing = document.getElementById("flow-context-menu");
    if (existing) existing.remove();
  }

  // ── 变换 ──

  function applyTransform() {
    var g = document.getElementById("flow-content");
    if (g) {
      g.setAttribute("transform",
        "translate(" + translateX + "," + translateY + ") scale(" + scale + ")");
    }
  }

  function resetTransform() {
    var viewport = document.getElementById("flow-viewport");
    if (!viewport || graphWidth === 0) return;

    var vw = viewport.clientWidth;
    var vh = viewport.clientHeight;
    if (vw === 0 || vh === 0) return;

    var pad = 10;
    var sx = (vw - pad * 2) / graphWidth;
    var sy = (vh - pad * 2) / graphHeight;
    scale = Math.min(sx, sy, 1);

    translateX = (vw - graphWidth * scale) / 2;
    translateY = (vh - graphHeight * scale) / 2;

    applyTransform();
  }

  function setupInteractions() {
    var viewport = document.getElementById("flow-viewport");
    if (!viewport) return;

    // 滚轮 / 触摸板缩放
    viewport.addEventListener("wheel", function (e) {
      e.preventDefault();
      var rect = viewport.getBoundingClientRect();
      var mx = e.clientX - rect.left;
      var my = e.clientY - rect.top;
      var factor = e.deltaY < 0 ? 1.1 : 0.9;
      var ns = Math.max(0.1, Math.min(10, scale * factor));
      translateX = mx - ((mx - translateX) / scale) * ns;
      translateY = my - ((my - translateY) / scale) * ns;
      scale = ns;
      applyTransform();
    }, { passive: false });

    // 拖拽平移
    viewport.addEventListener("mousedown", function (e) {
      if (e.button !== 0) return;
      isDragging = false;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      dragStartTX = translateX;
      dragStartTY = translateY;

      function onMove(ev) {
        var dx = ev.clientX - dragStartX;
        var dy = ev.clientY - dragStartY;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
          isDragging = true;
          viewport.style.cursor = "grabbing";
        }
        if (isDragging) {
          translateX = dragStartTX + dx;
          translateY = dragStartTY + dy;
          applyTransform();
        }
      }

      function onUp() {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        viewport.style.cursor = "grab";
        // isDragging 在 click 事件中检查后重置
        setTimeout(function () { isDragging = false; }, 0);
      }

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });
  }

  // ── 节点渲染 ──

  function renderNode(node) {
    var x = node.x + PADDING;
    var y = node.y + PADDING;
    var w = NODE_WIDTH;
    var h = NODE_HEIGHT;
    var cx = x + w / 2;
    var cy = y + h / 2;
    var color = getNodeColor(node.kind);
    var cls = "flow-node" + (node.id === highlightedNodeId ? " highlighted" : "");

    var shape = "";
    if (node.kind === "start" || node.kind === "end") {
      shape = '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="' + h / 2 + '" fill="' + color + '"/>';
    } else if (node.kind === "decision") {
      var points = cx + "," + y + " " + (x + w) + "," + cy + " " + cx + "," + (y + h) + " " + x + "," + cy;
      shape = '<polygon points="' + points + '" fill="' + color + '"/>';
    } else {
      shape = '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="4" fill="' + color + '"/>';
    }

    var label = node.title;
    if (label.length > 10) label = label.substring(0, 9) + "…";

    return '<g class="' + cls + '" data-id="' + node.id + '" data-line="' + node.line + '">' +
      shape + '<text class="label" x="' + cx + '" y="' + cy + '">' + escapeHtml(label) + "</text></g>";
  }

  function renderEdge(edge) {
    var sx = edge.sx + PADDING;
    var sy = edge.sy + PADDING;
    var ex = edge.ex + PADDING;
    var ey = edge.ey + PADDING;
    var midY = (sy + ey) / 2;
    var d = "M " + sx + " " + sy + " C " + sx + " " + midY + " " + ex + " " + midY + " " + ex + " " + ey;

    var html = '<path class="flow-edge" d="' + d + '"/>';
    if (edge.label) {
      var mx = (sx + ex) / 2;
      html += '<text class="flow-edge-label" x="' + mx + '" y="' + (midY - 6) + '">' + escapeHtml(edge.label) + "</text>";
    }
    return html;
  }

  // ── 布局算法 ──

  function computeLayout(graph) {
    var nodes = graph.nodes;
    var edges = graph.edges;
    var nodeMap = {};
    var inDegree = {};
    var adj = {};

    for (var i = 0; i < nodes.length; i++) {
      nodeMap[nodes[i].id] = nodes[i];
      inDegree[nodes[i].id] = 0;
      adj[nodes[i].id] = [];
    }
    for (var j = 0; j < edges.length; j++) {
      var e = edges[j];
      if (nodeMap[e.from] && nodeMap[e.to]) {
        adj[e.from].push(e.to);
        inDegree[e.to]++;
      }
    }

    var layers = [];
    var visited = {};
    var queue = [];

    for (var id in inDegree) {
      if (inDegree[id] === 0) queue.push(id);
    }
    if (queue.length === 0 && graph.entry && nodeMap[graph.entry]) {
      queue.push(graph.entry);
    }

    while (queue.length > 0) {
      var layer = [];
      var nextQueue = [];
      while (queue.length > 0) {
        var cid = queue.shift();
        if (visited[cid]) continue;
        visited[cid] = true;
        layer.push(cid);
        for (var k = 0; k < adj[cid].length; k++) {
          var nb = adj[cid][k];
          inDegree[nb]--;
          if (inDegree[nb] <= 0 && !visited[nb]) {
            nextQueue.push(nb);
          }
        }
      }
      if (layer.length > 0) layers.push(layer);
      queue = queue.concat(nextQueue);
    }

    for (var m = 0; m < nodes.length; m++) {
      if (!visited[nodes[m].id]) {
        layers.push([nodes[m].id]);
        visited[nodes[m].id] = true;
      }
    }

    var nodePositions = {};
    for (var li = 0; li < layers.length; li++) {
      var lay = layers[li];
      var layerWidth = lay.length * (NODE_WIDTH + NODE_GAP) - NODE_GAP;
      var startX = -layerWidth / 2;
      for (var ni = 0; ni < lay.length; ni++) {
        nodePositions[lay[ni]] = {
          x: startX + ni * (NODE_WIDTH + NODE_GAP),
          y: li * (NODE_HEIGHT + LAYER_GAP),
        };
      }
    }

    var allX = [], allY = [];
    for (var pid in nodePositions) {
      allX.push(nodePositions[pid].x);
      allY.push(nodePositions[pid].y);
    }
    var minX = Math.min.apply(null, allX);
    var maxX = Math.max.apply(null, allX) + NODE_WIDTH;
    var maxY = Math.max.apply(null, allY) + NODE_HEIGHT;
    var offsetX = -minX;

    var layoutNodes = [];
    for (var n = 0; n < nodes.length; n++) {
      if (nodePositions[nodes[n].id]) {
        layoutNodes.push({
          id: nodes[n].id,
          title: nodes[n].title,
          kind: nodes[n].kind,
          line: nodes[n].line,
          x: nodePositions[nodes[n].id].x + offsetX,
          y: nodePositions[nodes[n].id].y,
        });
      }
    }

    var layoutEdges = [];
    for (var ei = 0; ei < edges.length; ei++) {
      var ed = edges[ei];
      if (nodePositions[ed.from] && nodePositions[ed.to]) {
        layoutEdges.push({
          label: ed.label,
          sx: nodePositions[ed.from].x + offsetX + NODE_WIDTH / 2,
          sy: nodePositions[ed.from].y + NODE_HEIGHT,
          ex: nodePositions[ed.to].x + offsetX + NODE_WIDTH / 2,
          ey: nodePositions[ed.to].y,
        });
      }
    }

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
      case "start": return "var(--flow-start)";
      case "decision": return "var(--flow-decision)";
      case "end": return "var(--flow-end)";
      default: return "var(--flow-action)";
    }
  }

  function updateHighlight() {
    var els = document.querySelectorAll(".flow-node");
    for (var i = 0; i < els.length; i++) {
      if (els[i].dataset.id === highlightedNodeId) {
        els[i].classList.add("highlighted");
      } else {
        els[i].classList.remove("highlighted");
      }
    }
  }

  function escapeHtml(text) {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // ── 按钮动作 ──

  function fitView() {
    resetTransform();
  }

  function zoomIn() {
    var viewport = document.getElementById("flow-viewport");
    if (!viewport) return;
    var cx = viewport.clientWidth / 2;
    var cy = viewport.clientHeight / 2;
    var ns = Math.min(10, scale * 1.2);
    translateX = cx - ((cx - translateX) / scale) * ns;
    translateY = cy - ((cy - translateY) / scale) * ns;
    scale = ns;
    applyTransform();
  }

  function zoomOut() {
    var viewport = document.getElementById("flow-viewport");
    if (!viewport) return;
    var cx = viewport.clientWidth / 2;
    var cy = viewport.clientHeight / 2;
    var ns = Math.max(0.1, scale * 0.8);
    translateX = cx - ((cx - translateX) / scale) * ns;
    translateY = cy - ((cy - translateY) / scale) * ns;
    scale = ns;
    applyTransform();
  }

  init();
})();
