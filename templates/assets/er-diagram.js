/**
 * ER Diagram Interactive Controls: zoom, pan, search, schema-switch, tooltip.
 *
 * Per-schema SVGs are embedded as separate .er-svg-layer divs.
 * Schema dropdown switches which layer is visible (display:none / '').
 * "Tüm Şemalar" shows the combined full SVG.
 * Search filters nodes within the active layer via opacity dimming.
 */
(function () {
  var container = document.getElementById('er-container');
  var schemaFilter = document.getElementById('er-schema-filter');
  var searchInput = document.getElementById('er-search');
  var zoomLabel = document.getElementById('er-zoom-level');
  var tooltip = document.getElementById('er-tooltip');
  var hasPerSchema = window.ER_HAS_PER_SCHEMA || false;

  if (!container) return;

  // All SVG layers
  var allLayers = container.querySelectorAll('.er-svg-layer');

  function getActiveLayer() {
    for (var i = 0; i < allLayers.length; i++) {
      if (allLayers[i].style.display !== 'none') return allLayers[i];
    }
    return allLayers[0];
  }

  // --- Zoom & Pan state ---
  var scale = 1;
  var panX = 0;
  var panY = 0;
  var isPanning = false;
  var startX = 0;
  var startY = 0;

  function updateTransform() {
    var layer = getActiveLayer();
    if (layer) {
      layer.style.transform = 'translate(' + panX + 'px, ' + panY + 'px) scale(' + scale + ')';
    }
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

  // --- Schema layer switching ---
  function switchSchema(schemaName) {
    // Reset zoom/pan for new layer
    scale = 1; panX = 0; panY = 0;

    for (var i = 0; i < allLayers.length; i++) {
      var layer = allLayers[i];
      var layerSchema = layer.getAttribute('data-schema') || '';

      if (schemaName === '') {
        // "Tüm Şemalar" — show combined (data-schema="")
        layer.style.display = (layerSchema === '') ? '' : 'none';
      } else if (hasPerSchema) {
        // Show per-schema SVG if available
        layer.style.display = (layerSchema === schemaName) ? '' : 'none';
      } else {
        // No per-schema SVGs, show combined
        layer.style.display = (layerSchema === '') ? '' : 'none';
      }

      // Clear transform on hidden layers
      if (layer.style.display === 'none') {
        layer.style.transform = '';
      }
    }

    updateTransform();
    applySearch(); // Re-apply search filter on new layer
    updateInfo();
  }

  if (schemaFilter) {
    schemaFilter.addEventListener('change', function () {
      switchSchema(schemaFilter.value);
    });
  }

  // --- Search (within active layer) ---
  function applySearch() {
    var query = (searchInput ? searchInput.value : '').toLowerCase().trim();
    var layer = getActiveLayer();
    if (!layer) return;

    var nodes = layer.querySelectorAll('.node');
    var edges = layer.querySelectorAll('.edge');

    if (!query) {
      nodes.forEach(function (n) {
        n.style.opacity = '';
        n.classList.remove('er-dimmed', 'er-highlight');
      });
      edges.forEach(function (e) {
        e.style.opacity = '';
        e.classList.remove('er-dimmed');
      });
      return;
    }

    var matchedIds = new Set();
    nodes.forEach(function (node) {
      var title = node.querySelector('title');
      var nodeId = title ? title.textContent.trim().replace(/"/g, '') : '';
      if (nodeId.toLowerCase().includes(query)) {
        matchedIds.add(nodeId);
      }
    });

    nodes.forEach(function (node) {
      var title = node.querySelector('title');
      var nodeId = title ? title.textContent.trim().replace(/"/g, '') : '';
      if (matchedIds.has(nodeId)) {
        node.style.opacity = '';
        node.classList.remove('er-dimmed');
        node.classList.add('er-highlight');
      } else {
        node.style.opacity = '0.12';
        node.classList.add('er-dimmed');
        node.classList.remove('er-highlight');
      }
    });

    edges.forEach(function (edge) {
      var title = edge.querySelector('title');
      if (!title) { edge.style.opacity = '0.06'; return; }
      var edgeTitle = title.textContent.trim();
      var connected = Array.from(matchedIds).some(function (id) {
        return edgeTitle.includes(id);
      });
      edge.style.opacity = connected ? '' : '0.06';
    });
  }

  if (searchInput) searchInput.addEventListener('input', applySearch);

  // --- Info label ---
  function updateInfo() {
    var infoLabel = document.querySelector('.er-info');
    if (!infoLabel) return;
    var layer = getActiveLayer();
    if (!layer) return;
    var nodes = layer.querySelectorAll('.node');
    var edges = layer.querySelectorAll('.edge');
    infoLabel.textContent = nodes.length + ' tablo \u00b7 ' + edges.length + ' ili\u015fki';
  }

  // --- Tooltip: nodes + edges ---
  if (tooltip) {
    var meta = window.ER_TABLE_META || {};
    var edgeMeta = window.ER_EDGE_META || {};

    container.addEventListener('mouseover', function (e) {
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

      var edge = e.target.closest('.edge');
      if (edge) {
        var eTitle = edge.querySelector('title');
        if (!eTitle) return;
        var edgeId = eTitle.textContent.trim();
        var eInfo = edgeMeta[edgeId];
        if (eInfo) {
          var eHtml = '<div class="tt-title">' + escapeHtml(eInfo.constraint) + '</div>';
          eHtml += '<div class="tt-meta">' + escapeHtml(eInfo.from + ' \u2192 ' + eInfo.to) + '</div>';
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

    container.addEventListener('mouseout', function (e) {
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

  // Initial state
  updateTransform();
  updateInfo();
})();
