/**
 * ER Diagram Interactive Controls: zoom, pan, search, filter, tooltip.
 */
(function () {
  var container = document.getElementById('er-container');
  var wrapper = document.getElementById('er-svg-wrapper');
  var searchInput = document.getElementById('er-search');
  var schemaFilter = document.getElementById('er-schema-filter');
  var zoomLabel = document.getElementById('er-zoom-level');
  var tooltip = document.getElementById('er-tooltip');

  if (!container || !wrapper) return;

  var scale = 1;
  var panX = 0;
  var panY = 0;
  var isPanning = false;
  var startX = 0;
  var startY = 0;

  function updateTransform() {
    wrapper.style.transform = 'translate(' + panX + 'px, ' + panY + 'px) scale(' + scale + ')';
    if (zoomLabel) zoomLabel.textContent = Math.round(scale * 100) + '%';
  }

  // --- Zoom ---
  container.addEventListener('wheel', function (e) {
    e.preventDefault();
    var delta = e.deltaY > 0 ? 0.9 : 1.1;
    var newScale = Math.min(5, Math.max(0.1, scale * delta));
    var rect = container.getBoundingClientRect();
    var cx = e.clientX - rect.left;
    var cy = e.clientY - rect.top;
    panX = cx - (cx - panX) * (newScale / scale);
    panY = cy - (cy - panY) * (newScale / scale);
    scale = newScale;
    updateTransform();
  }, { passive: false });

  // --- Pan ---
  container.addEventListener('mousedown', function (e) {
    if (e.button !== 0) return;
    isPanning = true;
    startX = e.clientX - panX;
    startY = e.clientY - panY;
    container.style.cursor = 'grabbing';
  });

  document.addEventListener('mousemove', function (e) {
    if (!isPanning) return;
    panX = e.clientX - startX;
    panY = e.clientY - startY;
    updateTransform();
  });

  document.addEventListener('mouseup', function () {
    if (isPanning) {
      isPanning = false;
      container.style.cursor = 'grab';
    }
  });

  // --- Zoom buttons ---
  window.erZoomIn = function () {
    scale = Math.min(5, scale * 1.2);
    updateTransform();
  };
  window.erZoomOut = function () {
    scale = Math.max(0.1, scale / 1.2);
    updateTransform();
  };
  window.erZoomReset = function () {
    scale = 1; panX = 0; panY = 0;
    updateTransform();
  };

  // --- Search & Filter ---
  function getNodes() { return wrapper.querySelectorAll('.node'); }
  function getEdges() { return wrapper.querySelectorAll('.edge'); }

  function applyFilter() {
    var query = (searchInput ? searchInput.value : '').toLowerCase().trim();
    var schema = schemaFilter ? schemaFilter.value : '';
    var nodes = getNodes();
    var edges = getEdges();
    var matchedNodeIds = new Set();

    nodes.forEach(function (node) {
      var title = node.querySelector('title');
      var nodeId = title ? title.textContent.trim() : '';
      var parts = nodeId.replace(/"/g, '').split('.');
      var schemaName = parts.length > 1 ? parts[0] : '';
      var tableName = parts.length > 1 ? parts[1] : parts[0] || '';

      var match = true;
      if (query && !tableName.toLowerCase().includes(query) && !nodeId.toLowerCase().includes(query)) {
        match = false;
      }
      if (schema && schemaName !== schema) {
        match = false;
      }

      if (!query && !schema) {
        node.classList.remove('er-dimmed', 'er-highlight');
      } else if (match) {
        node.classList.remove('er-dimmed');
        node.classList.add('er-highlight');
        matchedNodeIds.add(nodeId);
      } else {
        node.classList.add('er-dimmed');
        node.classList.remove('er-highlight');
      }
    });

    edges.forEach(function (edge) {
      if (!query && !schema) {
        edge.classList.remove('er-dimmed');
        return;
      }
      var title = edge.querySelector('title');
      if (!title) { edge.classList.add('er-dimmed'); return; }
      var edgeTitle = title.textContent.trim();
      var connected = Array.from(matchedNodeIds).some(function (id) {
        return edgeTitle.includes(id);
      });
      edge.classList[connected ? 'remove' : 'add']('er-dimmed');
    });
  }

  if (searchInput) searchInput.addEventListener('input', applyFilter);
  if (schemaFilter) schemaFilter.addEventListener('change', applyFilter);

  // --- Tooltip: nodes + edges ---
  if (tooltip) {
    var meta = window.ER_TABLE_META || {};
    var edgeMeta = window.ER_EDGE_META || {};

    wrapper.addEventListener('mouseover', function (e) {
      // Node tooltip
      var node = e.target.closest('.node');
      if (node) {
        var title = node.querySelector('title');
        if (!title) return;
        var nodeId = title.textContent.trim().replace(/"/g, '');
        var info = meta[nodeId];
        if (!info) return;

        var html = '<div class="tt-title">' + escapeHtml(info.table_name) + '</div>';
        html += '<div class="tt-meta">' + escapeHtml(info.schema_name) + '</div>';
        if (info.columns && info.columns.length > 0) {
          html += '<div class="tt-cols">';
          info.columns.forEach(function (c) { html += escapeHtml(c) + '<br>'; });
          html += '</div>';
        }
        tooltip.innerHTML = html;
        tooltip.style.display = 'block';
        return;
      }

      // Edge tooltip
      var edge = e.target.closest('.edge');
      if (edge) {
        var eTitle = edge.querySelector('title');
        if (!eTitle) return;
        var edgeId = eTitle.textContent.trim();
        var eInfo = edgeMeta[edgeId];
        if (eInfo) {
          var eHtml = '<div class="tt-title">' + escapeHtml(eInfo.constraint) + '</div>';
          eHtml += '<div class="tt-meta">' + escapeHtml(eInfo.from + ' → ' + eInfo.to) + '</div>';
          eHtml += '<div class="tt-meta">' + escapeHtml(eInfo.cardinality) + '</div>';
          if (eInfo.columns) {
            eHtml += '<div class="tt-cols">' + escapeHtml(eInfo.columns) + '</div>';
          }
          tooltip.innerHTML = eHtml;
          tooltip.style.display = 'block';
        }
        return;
      }

      tooltip.style.display = 'none';
    });

    document.addEventListener('mousemove', function (e) {
      if (tooltip.style.display === 'block') {
        tooltip.style.left = (e.clientX + 14) + 'px';
        tooltip.style.top = (e.clientY + 14) + 'px';
      }
    });

    wrapper.addEventListener('mouseout', function (e) {
      if (!e.target.closest('.node') && !e.target.closest('.edge')) {
        tooltip.style.display = 'none';
      }
    });
  }

  function escapeHtml(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  updateTransform();
})();
