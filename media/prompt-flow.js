(function () {
  "use strict";

  const vscode = acquireVsCodeApi();

  // ── 状态 ──
  var currentGraphs = [];
  var activeGraphId = null; // null = show all
  var highlightedNodeId = null;
  var nodeBodyPreviews = {};
  var activePreviewNodeId = null;
  var previewHideTimer = null;
  var hasSavedScale = (savedState && typeof savedState.scale === "number");
  var isSwitchingGraph = false; // 下拉切换时保持 scale

  // ── 布局常量 ──
  var NODE_WIDTH = 140;
  var NODE_HEIGHT = 40;
  var LAYER_GAP = 80;
  var NODE_GAP = 30;
  var PADDING = 20;
  var GRAPH_GAP = 60; // 多图之间的间距

  // ── 变换状态（单个 viewport 内） ──
  var scale = 1;
  var translateX = 0;
  var translateY = 0;
  var isDragging = false;
  var dragStartX = 0;
  var dragStartY = 0;
  var dragStartTX = 0;
  var dragStartTY = 0;

  var totalWidth = 0;
  var totalHeight = 0;

  // ── 恢复持久化状态 ──
  var savedState = vscode.getState();
  if (savedState && typeof savedState.scale === "number") {
    scale = savedState.scale;
  }

  function saveState() {
    vscode.setState({ scale: scale });
  }

  // ── 初始化 ──
  function init() {
    window.addEventListener("message", handleMessage);
    vscode.postMessage({ type: "ready" });
  }

  function handleMessage(event) {
    var msg = event.data;
    if (msg.type === "updateFlow") {
      currentGraphs = msg.graphs || [];
      // 如果只有一个图，自动选中；否则默认全部
      if (currentGraphs.length === 1) {
        activeGraphId = currentGraphs[0].id || null;
      } else if (currentGraphs.length > 1 && activeGraphId === null) {
        // 保持当前选择，如果有的话
      }
      render();
    } else if (msg.type === "highlightNode") {
      highlightedNodeId = msg.nodeId;
      updateHighlight();
    }
  }

  // ── 获取当前要渲染的图列表 ──
  function getVisibleGraphs() {
    if (!currentGraphs || currentGraphs.length === 0) return [];
    if (activeGraphId === null) return currentGraphs;
    for (var i = 0; i < currentGraphs.length; i++) {
      if (currentGraphs[i].id === activeGraphId) return [currentGraphs[i]];
    }
    return currentGraphs;
  }

  // ── 渲染 ──
  function render() {
    var container = document.getElementById("flow-container");
    if (!currentGraphs || currentGraphs.length === 0) {
      container.innerHTML =
        '<div class="empty-state"><div class="icon">⊞</div><div>No flow nodes found</div><div style="font-size:11px">Add flow metadata to your markdown headings</div></div>';
      return;
    }

    var visible = getVisibleGraphs();
    var html = "";
    nodeBodyPreviews = {};

    // 标题栏
    html += '<div class="flow-header">';
    html += '<div class="header-left">';

    // 下拉选择器（多图时显示）
    if (currentGraphs.length > 1) {
      html += '<select id="flow-select" class="flow-select">';
      html += '<option value="__all__"' + (activeGraphId === null ? " selected" : "") + '>全部流程</option>';
      for (var gi = 0; gi < currentGraphs.length; gi++) {
        var g = currentGraphs[gi];
        var sel = (g.id === activeGraphId) ? " selected" : "";
        var nodeCount = g.nodes ? g.nodes.length : 0;
        html += '<option value="' + escapeHtml(g.id || "") + '"' + sel + '>' +
          escapeHtml(g.title || g.id || "Flow") + ' (' + nodeCount + ')</option>';
      }
      html += '</select>';
    } else {
      html += '<span class="title">' + escapeHtml(visible[0].title || "Flow Graph") + "</span>";
    }

    html += '</div>';
    html += '<div class="actions">';
    html += '<button id="btn-fit">Fit</button>';
    html += '<button id="btn-zin">+</button>';
    html += '<span id="zoom-level" class="zoom-level">' + Math.round(scale * 100) + '%</span>';
    html += '<button id="btn-zout">−</button>';
    html += "</div></div>";

    html += '<div id="node-body-preview" class="node-body-preview" aria-hidden="true"></div>';

    // 视口容器
    html += '<div class="flow-viewport" id="flow-viewport">';

    // SVG
    html += '<svg class="flow-svg" xmlns="http://www.w3.org/2000/svg">';
    html += '<defs><marker id="arrowhead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto"><polygon points="0 0, 10 3.5, 0 7" fill="var(--flow-edge)"/></marker></defs>';

    html += '<g id="flow-content">';

    // 计算总布局
    var yOffset = 0;
    var maxW = 0;
    var allRendered = [];

    for (var vi = 0; vi < visible.length; vi++) {
      var graph = visible[vi];
      if (!graph.nodes || graph.nodes.length === 0) continue;

      var layout = computeLayout(graph);

      // 多图时显示子标题
      if (visible.length > 1) {
        var titleInvScale = scale > 0 ? (1 / Math.sqrt(scale)) : 1;
        var titleTx = PADDING;
        var titleTy = yOffset + PADDING + 14;
        html += '<text class="flow-graph-title" transform="translate(' + titleTx + ',' + titleTy + ') scale(' + titleInvScale + ')">​' +
          escapeHtml(graph.title || graph.id || "Flow") + '</text>';
        yOffset += 30;
      }

      // 渲染此图的节点和边（带 yOffset 偏移）
      var gWidth = layout.width + PADDING * 2;
      var gHeight = layout.height + PADDING * 2;

      html += '<g class="flow-subgraph" data-graph-id="' + escapeHtml(graph.id || "") + '" transform="translate(0,' + yOffset + ')">';

      for (var ei = 0; ei < layout.edges.length; ei++) {
        html += renderEdge(layout.edges[ei]);
      }
      for (var ni = 0; ni < layout.nodes.length; ni++) {
        html += renderNode(layout.nodes[ni]);
      }

      html += '</g>';

      yOffset += gHeight;
      maxW = Math.max(maxW, gWidth);

      // 图之间加间距
      if (vi < visible.length - 1) {
        yOffset += GRAPH_GAP;
      }
    }

    totalWidth = maxW;
    totalHeight = yOffset;

    html += "</g></svg></div>";

    // 诊断
    for (var di = 0; di < visible.length; di++) {
      var dg = visible[di];
      if (dg.diagnostics && dg.diagnostics.length > 0) {
        html += '<div class="flow-diagnostics">';
        for (var ddi = 0; ddi < dg.diagnostics.length; ddi++) {
          html += '<div class="diagnostic">' + escapeHtml(dg.diagnostics[ddi].message) + "</div>";
        }
        html += "</div>";
      }
    }

    container.innerHTML = html;
    updateHighlight();

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

    // 下拉选择
    var select = document.getElementById("flow-select");
    if (select) {
      select.addEventListener("change", function () {
        var val = select.value;
        activeGraphId = (val === "__all__") ? null : val;
        isSwitchingGraph = true;
        render();
      });
    }

    // 节点左键：定位
    // 节点右键：上下文菜单
    var viewport = document.getElementById("flow-viewport");
    if (viewport) {
      var preview = document.getElementById("node-body-preview");
      var bodyNodes = viewport.querySelectorAll('.flow-node[data-has-body="1"]');
      for (var bi = 0; bi < bodyNodes.length; bi++) {
        (function (nodeEl) {
          nodeEl.addEventListener("mouseenter", function () {
            if (previewHideTimer) {
              clearTimeout(previewHideTimer);
              previewHideTimer = null;
            }
            showNodeBodyPreview(preview, nodeEl.dataset.id);
          });
          nodeEl.addEventListener("mouseleave", function () {
            if (previewHideTimer) {
              clearTimeout(previewHideTimer);
            }
            previewHideTimer = setTimeout(function () {
              hideNodeBodyPreview();
            }, 80);
          });
        })(bodyNodes[bi]);
      }

      viewport.addEventListener("mouseleave", function () {
        hideNodeBodyPreview();
      });

      viewport.addEventListener("click", function (e) {
        // 小圆点点击：弹出上下文菜单（优先判断，不受拖拽影响）
        if (e.target.classList.contains("prompto-indicator")) {
          var nodeEl = e.target.closest(".flow-node");
          if (nodeEl) {
            var nodeId = nodeEl.dataset.id;
            var nodeData = findNodeById(nodeId);
            if (nodeData && nodeData.promptoItems && nodeData.promptoItems.length > 0) {
              showContextMenu(e.clientX, e.clientY, nodeData);
            }
          }
          e.stopPropagation();
          return;
        }
        // 拖拽后不触发节点定位
        if (isDragging) return;
        // 节点点击：定位
        var nodeEl = e.target.closest(".flow-node");
        if (nodeEl) {
          var line = parseInt(nodeEl.dataset.line, 10);
          vscode.postMessage({ type: "locateNode", line: line });
        }
      });

      viewport.addEventListener("contextmenu", function (e) {
        hideNodeBodyPreview();
        var nodeEl = e.target.closest(".flow-node");
        if (!nodeEl) return;
        e.preventDefault();

        var nodeId = nodeEl.dataset.id;
        var nodeData = findNodeById(nodeId);
        if (!nodeData || !nodeData.promptoItems || nodeData.promptoItems.length === 0) return;

        showContextMenu(e.clientX, e.clientY, nodeData);
      });
    }

    document.addEventListener("click", function () {
      hideContextMenu();
    });
  }

  // ── 右键上下文菜单 ──

  function findNodeById(nodeId) {
    for (var gi = 0; gi < currentGraphs.length; gi++) {
      var nodes = currentGraphs[gi].nodes;
      if (!nodes) continue;
      for (var ni = 0; ni < nodes.length; ni++) {
        if (nodes[ni].id === nodeId) return nodes[ni];
      }
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

      if (hasMain && hasAction && j > 0 && item.isAction && !menu.querySelector(".flow-context-separator")) {
        var sep = document.createElement("div");
        sep.className = "flow-context-separator";
        menu.appendChild(sep);
      }

      var el = document.createElement("div");
      el.className = "flow-context-item";
      if (item.isAction) el.className += " action-item";
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

    var viewport = document.getElementById("flow-viewport");
    var vpRect = viewport ? viewport.getBoundingClientRect() : { left: 0, top: 0 };
    menu.style.left = (clientX - vpRect.left) + "px";
    menu.style.top = (clientY - vpRect.top) + "px";

    var parent = viewport || document.body;
    parent.appendChild(menu);

    requestAnimationFrame(function () {
      var menuRect = menu.getBoundingClientRect();
      var parentRect = parent.getBoundingClientRect();
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

  function showNodeBodyPreview(preview, nodeId) {
    var text = nodeBodyPreviews[nodeId];
    if (!text || !preview) {
      return;
    }

    if (activePreviewNodeId === nodeId && preview.getAttribute("aria-hidden") === "false") {
      return;
    }

    preview.textContent = text;
    preview.setAttribute("aria-hidden", "false");
    activePreviewNodeId = nodeId;
  }

  function hideNodeBodyPreview() {
    var preview = document.getElementById("node-body-preview");
    if (!preview) {
      return;
    }
    preview.setAttribute("aria-hidden", "true");
    activePreviewNodeId = null;
  }

  // ── 变换 ──

  function applyTransform() {
    var g = document.getElementById("flow-content");
    if (g) {
      g.setAttribute("transform",
        "translate(" + translateX + "," + translateY + ") scale(" + scale + ")");
    }
    updateZoomDisplay();
    saveState();
  }

  function updateZoomDisplay() {
    var el = document.getElementById("zoom-level");
    if (el) el.textContent = Math.round(scale * 100) + "%";
  }

  function resetTransform() {
    var viewport = document.getElementById("flow-viewport");
    if (!viewport || totalWidth === 0) return;

    var vw = viewport.clientWidth;
    var vh = viewport.clientHeight;
    if (vw === 0 || vh === 0) return;

    var pad = 10;

    if (isSwitchingGraph) {
      // 下拉切换：保持当前 scale，只重新居中
      isSwitchingGraph = false;
      translateX = (vw - totalWidth * scale) / 2;
      translateY = (vh - totalHeight * scale) / 2;
      applyTransform();
      return;
    }

    if (hasSavedScale) {
      // 首次加载有持久化值：用持久化 scale 居中
      hasSavedScale = false;
      translateX = (vw - totalWidth * scale) / 2;
      translateY = (vh - totalHeight * scale) / 2;
      applyTransform();
      return;
    }

    // Fit 模式或首次加载无持久化值
    var sx = (vw - pad * 2) / totalWidth;
    var sy = (vh - pad * 2) / totalHeight;
    scale = Math.min(sx, sy, 1);

    translateX = (vw - totalWidth * scale) / 2;
    translateY = (vh - totalHeight * scale) / 2;

    applyTransform();
  }

  function setupInteractions() {
    var viewport = document.getElementById("flow-viewport");
    if (!viewport) return;

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
    var hasBody = !!(node.hasBody && node.bodyPreview);
    var cls = "flow-node" + (node.id === highlightedNodeId ? " highlighted" : "") + (hasBody ? " has-body" : "");

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

    // 反缩放文字，保持视觉大小恒定
    var invScale = scale > 0 ? (1 / Math.sqrt(scale)) : 1;
    var labelTransform = 'transform="translate(' + cx + ',' + cy + ') scale(' + invScale + ')"';

    var hasPrompts = node.promptoItems && node.promptoItems.length > 0;
    var indicator = hasPrompts ? '<circle class="prompto-indicator" cx="' + (x + w - 7) + '" cy="' + (y + 7) + '" r="4.5" fill="#f0ad4e" stroke="var(--flow-bg)" stroke-width="1"/>' : '';
    var bodyIndicator = hasBody
      ? '<rect class="flow-body-indicator" x="' + (x + 22) + '" y="' + (y + h - 5) + '" width="' + (w - 44) + '" height="3" rx="1.5"/>' +
        '<circle class="flow-body-dot" cx="' + cx + '" cy="' + (y + h - 3.5) + '" r="1.8"/>'
      : '';

    if (hasBody) {
      nodeBodyPreviews[node.id] = node.bodyPreview;
    }

    return '<g class="' + cls + '" data-id="' + node.id + '" data-line="' + node.line + '" data-has-body="' + (hasBody ? "1" : "0") + '">' +
      shape + bodyIndicator + '<text class="label" ' + labelTransform + '>​' + escapeHtml(label) + "</text>" + indicator + '</g>';
  }

  function renderEdge(edge) {
    var sx = edge.sx + PADDING;
    var sy = edge.sy + PADDING;
    var ex = edge.ex + PADDING;
    var ey = edge.ey + PADDING;

    // 竖直向下分支保持在主轴线上，避免被 lane 偏移挪到左侧
    var isVerticalDownBranch =
      typeof edge.branchIndex === "number" &&
      typeof edge.branchCount === "number" &&
      edge.branchCount > 1 &&
      ey > sy &&
      Math.abs(ex - sx) < 1;

    var laneOffset = 0;
    if (
      typeof edge.branchIndex === "number" &&
      typeof edge.branchCount === "number" &&
      edge.branchCount > 1 &&
      !isVerticalDownBranch
    ) {
      laneOffset = (edge.branchIndex - (edge.branchCount - 1) / 2) * 28;
    }
    sx += laneOffset;
    ex += laneOffset;

    var html = "";
    var labelX = 0;
    var labelY = 0;

    // 分支线优化：右侧分支仅在“跨层分支”时使用右侧引出，避免影响兄弟分支
    var isCrossLayerBranch = (ey - sy) > (NODE_HEIGHT + LAYER_GAP + 20);
    var useRightOrthogonal =
      typeof edge.branchIndex === "number" &&
      typeof edge.branchCount === "number" &&
      edge.branchCount > 1 &&
      edge.branchIndex > (edge.branchCount - 1) / 2 &&
      isCrossLayerBranch;

    if (useRightOrthogonal) {
      var startX = sx + NODE_WIDTH / 2;
      var startY = sy - NODE_HEIGHT / 2;
      var bendX = Math.max(startX + 34, ex + 26);
      var entryY = ey - 6;
      // 圆角折线：使用两段贝塞尔过渡，视觉更柔和
      var topY = startY + 18;
      var bottomY = entryY - 18;
      var d1 = "M " + startX + " " + startY +
        " C " + (startX + 16) + " " + startY + " " + bendX + " " + startY + " " + bendX + " " + topY +
        " L " + bendX + " " + bottomY +
        " C " + bendX + " " + entryY + " " + (ex + 14) + " " + entryY + " " + ex + " " + ey;

      html += '<path class="flow-edge" d="' + d1 + '"/>';
      labelX = bendX - 10;
      labelY = startY - 10;
    } else {
      var midY = (sy + ey) / 2;
      var d = "M " + sx + " " + sy + " C " + sx + " " + midY + " " + ex + " " + midY + " " + ex + " " + ey;
      html += '<path class="flow-edge" d="' + d + '"/>';
      labelX = (sx + ex) / 2;
      labelY = midY - 6;
    }

    if (edge.label) {
      var invScale = scale > 0 ? (1 / Math.sqrt(scale)) : 1;
      var edgeLabelTransform = 'transform="translate(' + labelX + ',' + labelY + ') scale(' + invScale + ')"';
      html += '<text class="flow-edge-label" ' + edgeLabelTransform + '>​' + escapeHtml(edge.label) + "</text>";
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
    var incoming = {};

    for (var i = 0; i < nodes.length; i++) {
      nodeMap[nodes[i].id] = nodes[i];
      inDegree[nodes[i].id] = 0;
      adj[nodes[i].id] = [];
      incoming[nodes[i].id] = [];
    }
    for (var j = 0; j < edges.length; j++) {
      var e = edges[j];
      if (nodeMap[e.from] && nodeMap[e.to]) {
        adj[e.from].push(e.to);
        incoming[e.to].push(e.from);
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
      var minCenterGap = NODE_WIDTH + NODE_GAP;
      var placements = [];

      for (var ni = 0; ni < lay.length; ni++) {
        var nid = lay[ni];
        var parents = incoming[nid] || [];
        var sumX = 0;
        var cntX = 0;
        for (var pi = 0; pi < parents.length; pi++) {
          var parentPos = nodePositions[parents[pi]];
          if (parentPos) {
            sumX += parentPos.x;
            cntX++;
          }
        }

        // 优先贴近父节点水平位置；无父节点时回退到层内均匀分布
        var fallbackX = (ni - (lay.length - 1) / 2) * minCenterGap;
        var desiredX = cntX > 0 ? (sumX / cntX) : fallbackX;
        placements.push({ id: nid, desiredX: desiredX, x: desiredX });
      }

      placements.sort(function (a, b) {
        return a.desiredX - b.desiredX;
      });

      for (var si = 1; si < placements.length; si++) {
        var prev = placements[si - 1];
        var cur = placements[si];
        if (cur.x - prev.x < minCenterGap) {
          cur.x = prev.x + minCenterGap;
        }
      }

      // 同层整体回中：保证 1 对多分支时，子节点簇中心对齐父节点中心
      if (placements.length > 0) {
        var sumDesired = 0;
        var sumActual = 0;
        for (var ci = 0; ci < placements.length; ci++) {
          sumDesired += placements[ci].desiredX;
          sumActual += placements[ci].x;
        }
        var shift = (sumDesired / placements.length) - (sumActual / placements.length);
        if (Math.abs(shift) > 0.001) {
          for (var sj = 0; sj < placements.length; sj++) {
            placements[sj].x += shift;
          }
        }
      }

      for (var ai = 0; ai < placements.length; ai++) {
        nodePositions[placements[ai].id] = {
          x: placements[ai].x,
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
          promptoItems: nodes[n].promptoItems,
          hasBody: nodes[n].hasBody,
          bodyPreview: nodes[n].bodyPreview,
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
          branchIndex: ed.branchIndex,
          branchCount: ed.branchCount,
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

  function fitView() { resetTransform(); }

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
