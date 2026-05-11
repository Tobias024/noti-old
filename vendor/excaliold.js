// ExcaliOld refactorizado como modulo mountable.
// Origen: m:\Coding\ExcaliOld\ExcaliOld\app.js (IIFE auto-conectado a IDs fijos).
// Cambios: state encapsulado por mount, sin localStorage, sin theme handler,
// toolbar via data-role (no IDs hardcoded), API publica mount + renderStatic.

window.Drawing = (function () {
  'use strict';

  var HISTORY_MAX = 50;

  function cloneElements(arr) {
    return JSON.parse(JSON.stringify(arr));
  }

  function seededRng(seed) {
    var s = seed | 0;
    if (s === 0) s = 1;
    return function () {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
  }

  function randSeed() {
    return Math.floor(Math.random() * 2147483646) + 1;
  }

  // ---------- Pure drawing primitives ----------

  function sketchyLine(c, x1, y1, x2, y2, rng, rough) {
    var dx = x2 - x1, dy = y2 - y1;
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    var nx = -dy / len, ny = dx / len;
    var amp = Math.min(rough, len * 0.03 + 1.5);
    function pass(shrink) {
      var jx1 = x1 + (rng() - 0.5) * amp;
      var jy1 = y1 + (rng() - 0.5) * amp;
      var jx2 = x2 + (rng() - 0.5) * amp;
      var jy2 = y2 + (rng() - 0.5) * amp;
      var midOff = (rng() - 0.5) * amp * 2;
      var mx = (x1 + x2) / 2 + nx * midOff;
      var my = (y1 + y2) / 2 + ny * midOff;
      c.beginPath();
      c.moveTo(jx1, jy1);
      c.quadraticCurveTo(mx, my, jx2, jy2);
      c.stroke();
    }
    pass(1);
    pass(0.85);
  }

  function sketchyRect(c, x1, y1, x2, y2, rng) {
    var w = Math.abs(x2 - x1), h = Math.abs(y2 - y1);
    var rough = Math.max(1.5, Math.min(w, h) * 0.02 + 1.5);
    sketchyLine(c, x1, y1, x2, y1, rng, rough);
    sketchyLine(c, x2, y1, x2, y2, rng, rough);
    sketchyLine(c, x2, y2, x1, y2, rng, rough);
    sketchyLine(c, x1, y2, x1, y1, rng, rough);
  }

  function sketchyEllipse(c, cx, cy, rx, ry, rng) {
    if (rx < 1 || ry < 1) return;
    var rough = Math.min(rx, ry) * 0.04 + 1;
    var n = 14;
    function pass() {
      var startA = rng() * Math.PI * 2;
      var pts = [];
      for (var i = 0; i <= n; i++) {
        var a = startA + (i / n) * Math.PI * 2;
        var jr = 1 + (rng() - 0.5) * 0.06;
        pts.push({
          x: cx + Math.cos(a) * rx * jr + (rng() - 0.5) * rough,
          y: cy + Math.sin(a) * ry * jr + (rng() - 0.5) * rough
        });
      }
      c.beginPath();
      c.moveTo(pts[0].x, pts[0].y);
      for (var i = 1; i < pts.length - 1; i++) {
        var mx = (pts[i].x + pts[i + 1].x) / 2;
        var my = (pts[i].y + pts[i + 1].y) / 2;
        c.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
      }
      c.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
      c.stroke();
    }
    pass();
    pass();
  }

  function crispEllipse(c, cx, cy, rx, ry) {
    if (rx < 0.5 || ry < 0.5) return;
    var k = 0.5522847498;
    var ox = rx * k, oy = ry * k;
    c.beginPath();
    c.moveTo(cx - rx, cy);
    c.bezierCurveTo(cx - rx, cy - oy, cx - ox, cy - ry, cx, cy - ry);
    c.bezierCurveTo(cx + ox, cy - ry, cx + rx, cy - oy, cx + rx, cy);
    c.bezierCurveTo(cx + rx, cy + oy, cx + ox, cy + ry, cx, cy + ry);
    c.bezierCurveTo(cx - ox, cy + ry, cx - rx, cy + oy, cx - rx, cy);
    c.stroke();
  }

  function drawPen(c, el) {
    var pts = el.points;
    if (!pts || !pts.length) return;
    if (pts.length < 2) {
      c.beginPath();
      c.arc(pts[0].x, pts[0].y, el.size / 2, 0, Math.PI * 2);
      c.fillStyle = el.color;
      c.fill();
      return;
    }
    c.beginPath();
    c.moveTo(pts[0].x, pts[0].y);
    for (var i = 1; i < pts.length - 1; i++) {
      var mx = (pts[i].x + pts[i + 1].x) / 2;
      var my = (pts[i].y + pts[i + 1].y) / 2;
      c.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
    }
    var last = pts[pts.length - 1];
    c.lineTo(last.x, last.y);
    c.stroke();
  }

  function drawEl(c, el, style) {
    c.strokeStyle = el.color;
    c.lineWidth = el.size;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    var rng = seededRng(el.seed || 1);
    var sketch = style === 'sketch';
    if (el.type === 'pen') {
      drawPen(c, el);
    } else if (el.type === 'line') {
      if (sketch) sketchyLine(c, el.x1, el.y1, el.x2, el.y2, rng, 3);
      else { c.beginPath(); c.moveTo(el.x1, el.y1); c.lineTo(el.x2, el.y2); c.stroke(); }
    } else if (el.type === 'rect') {
      var minx = Math.min(el.x1, el.x2), miny = Math.min(el.y1, el.y2);
      var maxx = Math.max(el.x1, el.x2), maxy = Math.max(el.y1, el.y2);
      if (sketch) sketchyRect(c, minx, miny, maxx, maxy, rng);
      else c.strokeRect(minx, miny, maxx - minx, maxy - miny);
    } else if (el.type === 'ellipse') {
      var cx = (el.x1 + el.x2) / 2;
      var cy = (el.y1 + el.y2) / 2;
      var rx = Math.abs(el.x2 - el.x1) / 2;
      var ry = Math.abs(el.y2 - el.y1) / 2;
      if (sketch) sketchyEllipse(c, cx, cy, rx, ry, rng);
      else crispEllipse(c, cx, cy, rx, ry);
    }
  }

  function boundingBox(el) {
    if (el.type === 'pen') {
      var minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
      for (var i = 0; i < el.points.length; i++) {
        var p = el.points[i];
        if (p.x < minx) minx = p.x;
        if (p.y < miny) miny = p.y;
        if (p.x > maxx) maxx = p.x;
        if (p.y > maxy) maxy = p.y;
      }
      return { x: minx, y: miny, w: maxx - minx, h: maxy - miny };
    }
    var x = Math.min(el.x1, el.x2), y = Math.min(el.y1, el.y2);
    return { x: x, y: y, w: Math.abs(el.x2 - el.x1), h: Math.abs(el.y2 - el.y1) };
  }

  function allBBox(elements) {
    if (!elements.length) return null;
    var minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (var i = 0; i < elements.length; i++) {
      var bb = boundingBox(elements[i]);
      var pad = elements[i].size || 2;
      if (bb.x - pad < minx) minx = bb.x - pad;
      if (bb.y - pad < miny) miny = bb.y - pad;
      if (bb.x + bb.w + pad > maxx) maxx = bb.x + bb.w + pad;
      if (bb.y + bb.h + pad > maxy) maxy = bb.y + bb.h + pad;
    }
    return { x: minx, y: miny, w: maxx - minx, h: maxy - miny };
  }

  // ---------- Static render (no interaction, fits to canvas) ----------

  function renderStatic(canvas, elements, opts) {
    opts = opts || {};
    var ctx = canvas.getContext('2d');
    var dpr = window.devicePixelRatio || 1;
    var rect = canvas.getBoundingClientRect();
    var w = rect.width || canvas.clientWidth || 300;
    var h = rect.height || canvas.clientHeight || 180;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();

    if (!elements || !elements.length) return;
    var bb = allBBox(elements);
    if (!bb || bb.w <= 0 || bb.h <= 0) {
      bb = { x: bb ? bb.x : 0, y: bb ? bb.y : 0, w: Math.max(1, bb ? bb.w : 1), h: Math.max(1, bb ? bb.h : 1) };
    }
    var margin = 12;
    var sx = (w - 2 * margin) / bb.w;
    var sy = (h - 2 * margin) / bb.h;
    var s = Math.min(sx, sy, 2);
    if (s < 0.05) s = 0.05;
    var offsetX = (w - bb.w * s) / 2 - bb.x * s;
    var offsetY = (h - bb.h * s) / 2 - bb.y * s;
    ctx.save();
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * offsetX, dpr * offsetY);
    for (var i = 0; i < elements.length; i++) {
      drawEl(ctx, elements[i], opts.style || 'sketch');
    }
    ctx.restore();
  }

  // ---------- Interactive mount ----------

  function mount(canvas, toolbar, opts) {
    opts = opts || {};
    var ctx = canvas.getContext('2d');

    var state = {
      tool: 'pen',
      style: 'sketch',
      color: '#1e1e1e',
      size: 2,
      elements: opts.initialElements ? cloneElements(opts.initialElements) : [],
      history: [],
      future: [],
      drawing: false,
      current: null,
      selected: null,
      dragStart: null,
      dragOriginal: null,
      dragSnapshot: null,
      eraseHistoryPushed: false,
      view: { x: 0, y: 0, scale: 1 },
      dpr: window.devicePixelRatio || 1,
      pinching: false,
      pinchStart: null,
      cleanSnapshot: opts.initialElements ? JSON.stringify(opts.initialElements) : '[]'
    };

    var colorInput = toolbar.querySelector('[data-role="color"]');
    var sizeInput = toolbar.querySelector('[data-role="size"]');
    var styleSelect = toolbar.querySelector('[data-role="style"]');
    var toolButtons = toolbar.querySelectorAll('[data-role="tool"]');
    var undoBtn = toolbar.querySelector('[data-role="undo"]');
    var redoBtn = toolbar.querySelector('[data-role="redo"]');
    var resetBtn = toolbar.querySelector('[data-role="reset-view"]');
    var clearBtn = toolbar.querySelector('[data-role="clear"]');

    if (colorInput) state.color = colorInput.value || state.color;
    if (sizeInput) state.size = parseInt(sizeInput.value, 10) || state.size;
    if (styleSelect) state.style = styleSelect.value || state.style;

    function pushHistory() {
      state.history.push(cloneElements(state.elements));
      if (state.history.length > HISTORY_MAX) state.history.shift();
      state.future.length = 0;
    }
    function undo() {
      if (!state.history.length) return;
      state.future.push(cloneElements(state.elements));
      state.elements = state.history.pop();
      state.selected = null;
      redraw();
    }
    function redo() {
      if (!state.future.length) return;
      state.history.push(cloneElements(state.elements));
      state.elements = state.future.pop();
      state.selected = null;
      redraw();
    }

    function resize() {
      var r = canvas.getBoundingClientRect();
      canvas.width = Math.floor(r.width * state.dpr);
      canvas.height = Math.floor(r.height * state.dpr);
      redraw();
    }

    function clearCanvas() {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
    }

    function drawSelection(el) {
      var bb = boundingBox(el);
      var s = state.view.scale;
      var pad = 6 / s;
      ctx.save();
      ctx.strokeStyle = '#1971c2';
      ctx.lineWidth = 1.5 / s;
      if (ctx.setLineDash) ctx.setLineDash([6 / s, 4 / s]);
      ctx.strokeRect(bb.x - pad, bb.y - pad, bb.w + pad * 2, bb.h + pad * 2);
      ctx.restore();
    }

    function redraw() {
      clearCanvas();
      ctx.save();
      ctx.setTransform(
        state.dpr * state.view.scale, 0, 0,
        state.dpr * state.view.scale,
        state.dpr * state.view.x,
        state.dpr * state.view.y
      );
      for (var i = 0; i < state.elements.length; i++) {
        drawEl(ctx, state.elements[i], state.style);
      }
      if (state.current) drawEl(ctx, state.current, state.style);
      if (state.selected != null && state.elements[state.selected]) {
        drawSelection(state.elements[state.selected]);
      }
      ctx.restore();
    }

    function hitTest(el, px, py) {
      var tol = Math.max(8 / state.view.scale, el.size + 4 / state.view.scale);
      if (el.type === 'pen') {
        for (var i = 0; i < el.points.length; i++) {
          var p = el.points[i];
          if (Math.abs(p.x - px) < tol && Math.abs(p.y - py) < tol) return true;
        }
        return false;
      }
      var bb = boundingBox(el);
      return px >= bb.x - tol && px <= bb.x + bb.w + tol &&
             py >= bb.y - tol && py <= bb.y + bb.h + tol;
    }

    function findTopHit(px, py) {
      for (var i = state.elements.length - 1; i >= 0; i--) {
        if (hitTest(state.elements[i], px, py)) return i;
      }
      return -1;
    }

    function getPos(evt) {
      var r = canvas.getBoundingClientRect();
      var cx, cy;
      if (evt.touches && evt.touches.length) {
        cx = evt.touches[0].clientX; cy = evt.touches[0].clientY;
      } else if (evt.changedTouches && evt.changedTouches.length) {
        cx = evt.changedTouches[0].clientX; cy = evt.changedTouches[0].clientY;
      } else { cx = evt.clientX; cy = evt.clientY; }
      var sx = cx - r.left;
      var sy = cy - r.top;
      return {
        x: (sx - state.view.x) / state.view.scale,
        y: (sy - state.view.y) / state.view.scale
      };
    }

    function startInteraction(pos) {
      if (state.tool === 'select') {
        var idx = findTopHit(pos.x, pos.y);
        if (idx === -1) { state.selected = null; redraw(); return; }
        state.selected = idx;
        state.drawing = true;
        state.dragStart = { x: pos.x, y: pos.y };
        state.dragOriginal = cloneElements([state.elements[idx]])[0];
        state.dragSnapshot = cloneElements(state.elements);
        redraw();
        return;
      }
      state.drawing = true;
      state.selected = null;
      if (state.tool === 'pen') {
        state.current = { type: 'pen', color: state.color, size: state.size,
          seed: randSeed(), points: [{ x: pos.x, y: pos.y }] };
      } else if (state.tool === 'eraser') {
        state.eraseHistoryPushed = false;
        eraseAt(pos.x, pos.y);
        state.current = null;
      } else {
        state.current = { type: state.tool, color: state.color, size: state.size,
          seed: randSeed(), x1: pos.x, y1: pos.y, x2: pos.x, y2: pos.y };
      }
    }

    function moveInteraction(pos) {
      if (!state.drawing) return;
      if (state.tool === 'select' && state.dragOriginal) {
        var dx = pos.x - state.dragStart.x;
        var dy = pos.y - state.dragStart.y;
        var el = state.elements[state.selected];
        var orig = state.dragOriginal;
        if (el.type === 'pen') {
          el.points = [];
          for (var i = 0; i < orig.points.length; i++) {
            el.points.push({ x: orig.points[i].x + dx, y: orig.points[i].y + dy });
          }
        } else {
          el.x1 = orig.x1 + dx; el.y1 = orig.y1 + dy;
          el.x2 = orig.x2 + dx; el.y2 = orig.y2 + dy;
        }
        redraw();
        return;
      }
      if (state.tool === 'pen' && state.current) {
        var pts = state.current.points;
        var last = pts[pts.length - 1];
        if (Math.abs(last.x - pos.x) + Math.abs(last.y - pos.y) < 1 / state.view.scale) return;
        pts.push({ x: pos.x, y: pos.y });
        redraw();
      } else if (state.tool === 'eraser') {
        eraseAt(pos.x, pos.y);
      } else if (state.current) {
        state.current.x2 = pos.x;
        state.current.y2 = pos.y;
        redraw();
      }
    }

    function endInteraction() {
      if (!state.drawing) return;
      state.drawing = false;
      if (state.tool === 'select') {
        if (state.dragOriginal && state.selected != null) {
          var el = state.elements[state.selected];
          var orig = state.dragOriginal;
          var moved;
          if (el.type === 'pen') {
            moved = el.points.length > 0 && (
              el.points[0].x !== orig.points[0].x ||
              el.points[0].y !== orig.points[0].y);
          } else {
            moved = el.x1 !== orig.x1 || el.y1 !== orig.y1;
          }
          if (moved && state.dragSnapshot) {
            state.history.push(state.dragSnapshot);
            if (state.history.length > HISTORY_MAX) state.history.shift();
            state.future.length = 0;
          }
        }
        state.dragStart = null;
        state.dragOriginal = null;
        state.dragSnapshot = null;
        return;
      }
      if (state.tool === 'eraser') {
        state.eraseHistoryPushed = false;
        return;
      }
      if (state.current) {
        pushHistory();
        state.elements.push(state.current);
        state.current = null;
        redraw();
      }
    }

    function eraseAt(px, py) {
      var changed = false;
      for (var i = state.elements.length - 1; i >= 0; i--) {
        if (hitTest(state.elements[i], px, py)) {
          if (!state.eraseHistoryPushed) {
            pushHistory();
            state.eraseHistoryPushed = true;
          }
          state.elements.splice(i, 1);
          changed = true;
        }
      }
      if (changed) redraw();
    }

    function setTool(tool) {
      state.tool = tool;
      state.selected = null;
      state.drawing = false;
      state.current = null;
      state.dragStart = null;
      state.dragOriginal = null;
      state.dragSnapshot = null;
      for (var i = 0; i < toolButtons.length; i++) {
        var t = toolButtons[i].getAttribute('data-tool');
        toolButtons[i].className = (t === tool) ? 'tool active' : 'tool';
      }
      redraw();
    }

    function resetView() {
      state.view.x = 0; state.view.y = 0; state.view.scale = 1;
      redraw();
    }

    function midpoint(t1, t2) {
      return { x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 };
    }
    function distance(t1, t2) {
      var dx = t2.clientX - t1.clientX, dy = t2.clientY - t1.clientY;
      return Math.sqrt(dx * dx + dy * dy);
    }
    function beginPinch(e) {
      if (state.drawing) {
        state.drawing = false;
        state.current = null;
        if (state.dragSnapshot) state.elements = state.dragSnapshot;
        state.dragOriginal = null;
        state.dragSnapshot = null;
        state.dragStart = null;
        redraw();
      }
      var t1 = e.touches[0], t2 = e.touches[1];
      state.pinching = true;
      state.pinchStart = {
        mid: midpoint(t1, t2),
        dist: distance(t1, t2),
        view: { x: state.view.x, y: state.view.y, scale: state.view.scale }
      };
    }
    function updatePinch(e) {
      var t1 = e.touches[0], t2 = e.touches[1];
      var mid = midpoint(t1, t2);
      var dist = distance(t1, t2);
      var start = state.pinchStart;
      var r = canvas.getBoundingClientRect();
      var newScale = Math.max(0.2, Math.min(5, start.view.scale * (dist / (start.dist || 1))));
      var startMidScreen = { x: start.mid.x - r.left, y: start.mid.y - r.top };
      var newMidScreen = { x: mid.x - r.left, y: mid.y - r.top };
      var worldX = (startMidScreen.x - start.view.x) / start.view.scale;
      var worldY = (startMidScreen.y - start.view.y) / start.view.scale;
      state.view.scale = newScale;
      state.view.x = newMidScreen.x - worldX * newScale;
      state.view.y = newMidScreen.y - worldY * newScale;
      redraw();
    }

    // ---- Event wiring with cleanup tracking ----
    var cleanups = [];
    function addL(el, ev, fn, useCapture) {
      if (!el) return;
      el.addEventListener(ev, fn, useCapture || false);
      cleanups.push(function () { el.removeEventListener(ev, fn, useCapture || false); });
    }

    for (var i = 0; i < toolButtons.length; i++) {
      (function (btn) {
        addL(btn, 'click', function (e) {
          setTool(e.currentTarget.getAttribute('data-tool'));
        });
      })(toolButtons[i]);
    }
    addL(colorInput, 'change', function () { state.color = colorInput.value; });
    addL(sizeInput, 'change', function () { state.size = parseInt(sizeInput.value, 10); });
    addL(styleSelect, 'change', function () { state.style = styleSelect.value; redraw(); });
    addL(undoBtn, 'click', undo);
    addL(redoBtn, 'click', redo);
    addL(resetBtn, 'click', resetView);
    addL(clearBtn, 'click', function () {
      if (!state.elements.length) return;
      pushHistory();
      state.elements = [];
      state.selected = null;
      redraw();
    });

    addL(canvas, 'mousedown', function (e) { e.preventDefault(); startInteraction(getPos(e)); });
    addL(canvas, 'mousemove', function (e) { if (state.drawing) moveInteraction(getPos(e)); });
    var mouseupHandler = function () { endInteraction(); };
    window.addEventListener('mouseup', mouseupHandler);
    cleanups.push(function () { window.removeEventListener('mouseup', mouseupHandler); });

    addL(canvas, 'touchstart', function (e) {
      if (e.touches.length === 2) { e.preventDefault(); beginPinch(e); return; }
      if (state.pinching) return;
      if (e.touches.length > 2) return;
      e.preventDefault();
      startInteraction(getPos(e));
    });
    addL(canvas, 'touchmove', function (e) {
      if (e.touches.length === 2 && state.pinching) { e.preventDefault(); updatePinch(e); return; }
      if (state.pinching) return;
      if (e.touches.length !== 1) return;
      e.preventDefault();
      moveInteraction(getPos(e));
    });
    addL(canvas, 'touchend', function (e) {
      if (state.pinching) {
        if (e.touches.length < 2) { state.pinching = false; state.pinchStart = null; }
        return;
      }
      e.preventDefault();
      endInteraction();
    });
    addL(canvas, 'touchcancel', function () {
      state.pinching = false; state.pinchStart = null; endInteraction();
    });
    addL(canvas, 'gesturestart', function (e) { e.preventDefault(); });
    addL(canvas, 'gesturechange', function (e) { e.preventDefault(); });

    var resizeHandler = function () { resize(); };
    window.addEventListener('resize', resizeHandler);
    window.addEventListener('orientationchange', resizeHandler);
    cleanups.push(function () {
      window.removeEventListener('resize', resizeHandler);
      window.removeEventListener('orientationchange', resizeHandler);
    });

    // Ensure seeds (in case loaded elements lack seeds)
    for (var k = 0; k < state.elements.length; k++) {
      if (!state.elements[k].seed) state.elements[k].seed = randSeed();
    }

    // Initial setTool to highlight default button
    setTool(state.tool);
    // Defer resize to after layout
    setTimeout(resize, 0);

    function destroy() {
      for (var i = 0; i < cleanups.length; i++) {
        try { cleanups[i](); } catch (e) {}
      }
      cleanups = [];
    }

    return {
      getElements: function () { return cloneElements(state.elements); },
      setElements: function (els) {
        state.elements = els ? cloneElements(els) : [];
        state.cleanSnapshot = JSON.stringify(state.elements);
        state.history = [];
        state.future = [];
        for (var i = 0; i < state.elements.length; i++) {
          if (!state.elements[i].seed) state.elements[i].seed = randSeed();
        }
        redraw();
      },
      isDirty: function () {
        return JSON.stringify(state.elements) !== state.cleanSnapshot;
      },
      markClean: function () {
        state.cleanSnapshot = JSON.stringify(state.elements);
      },
      redraw: redraw,
      resize: resize,
      destroy: destroy
    };
  }

  return {
    mount: mount,
    renderStatic: renderStatic
  };
})();
