(function () {
  'use strict';

  // ------------- Elements -------------
  var elTree = document.getElementById('tree');
  var elSidebar = document.getElementById('sidebar');
  var elToggleSidebar = document.getElementById('toggle-sidebar');
  var elPath = document.getElementById('current-path');
  var elNewBtn = document.getElementById('new-btn');
  var elEditBtn = document.getElementById('edit-btn');
  var elSaveBtn = document.getElementById('save-btn');
  var elCancelBtn = document.getElementById('cancel-btn');
  var elDeleteBtn = document.getElementById('delete-btn');
  var elInsertDrawingBtn = document.getElementById('insert-drawing-btn');
  var elDrawingsStrip = document.getElementById('drawings-strip');
  var elModalDrawing = document.getElementById('modal-drawing');
  var elDrawingToolbar = document.getElementById('drawing-toolbar');
  var elDrawingCanvas = document.getElementById('drawing-canvas');
  var elDrawingDone = document.getElementById('drawing-done');
  var elDrawingCancel = document.getElementById('drawing-cancel');
  var elRefreshBtn = document.getElementById('refresh-btn');
  var elSettingsBtn = document.getElementById('settings-btn');
  var elThemeBtn = document.getElementById('theme-btn');
  var elRender = document.getElementById('render');
  var elEditor = document.getElementById('editor');
  var elEmpty = document.getElementById('empty');
  var elMdToolbar = document.getElementById('md-toolbar');

  var elModalSetup = document.getElementById('modal-setup');
  var elCfgUser = document.getElementById('cfg-user');
  var elCfgRepo = document.getElementById('cfg-repo');
  var elCfgBranch = document.getElementById('cfg-branch');
  var elCfgPat = document.getElementById('cfg-pat');
  var elCfgMsg = document.getElementById('cfg-msg');
  var elCfgSave = document.getElementById('cfg-save');
  var elCfgCancel = document.getElementById('cfg-cancel');
  var elCfgClear = document.getElementById('cfg-clear');

  var elModalNew = document.getElementById('modal-new');
  var elNewParent = document.getElementById('new-parent');
  var elNewName = document.getElementById('new-name');
  var elNewNameLabel = document.getElementById('new-name-label');
  var elNewMsg = document.getElementById('new-msg');
  var elNewCreate = document.getElementById('new-create');
  var elNewCancel = document.getElementById('new-cancel');
  var elNewTabFile = document.getElementById('new-tab-file');
  var elNewTabHtml = document.getElementById('new-tab-html');
  var elNewTabFolder = document.getElementById('new-tab-folder');

  var elSearchInput = document.getElementById('search-input');

  var elModalConflict = document.getElementById('modal-conflict');
  var elConflictMsg = document.getElementById('conflict-msg');
  var elConflictDiscard = document.getElementById('conflict-discard');
  var elConflictCopy = document.getElementById('conflict-copy');

  var elToast = document.getElementById('toast');

  // ------------- Constants -------------
  var LS_CFG = 'notas.cfg';          // {user, repo, branch, pat}
  var LS_LAST = 'notas.lastPath';
  var LS_TREE = 'notas.treeCache';   // {ts, items}
  var LS_THEME = 'notas.theme';
  var LS_DRAFT_PREFIX = 'notas.draft.'; // + path -> texto sin guardar
  var TREE_TTL_MS = 5 * 60 * 1000;
  var DRAFT_AUTOSAVE_MS = 3000;

  // En deploy (Vercel) usamos el proxy /api/gh para evitar problemas de TLS/CORS
  // con dispositivos viejos (iPad mini 1 / Safari 9). En dev (file://, localhost)
  // pegamos directo a api.github.com.
  var IS_DEPLOYED = (location.protocol === 'http:' || location.protocol === 'https:')
    && location.hostname
    && location.hostname !== 'localhost'
    && location.hostname !== '127.0.0.1';
  var API = IS_DEPLOYED ? (location.origin + '/api/gh') : 'https://api.github.com';

  // ------------- State -------------
  var state = {
    cfg: null,
    tree: [],          // array of {path, type:'tree'|'blob'}
    openPath: null,
    openSha: null,
    openContent: '',
    openType: 'md',    // 'md' | 'html'
    editing: false,
    newKind: 'file',
    expanded: {},      // folder paths -> true
    pendingDrawings: {},  // path -> {elements, sha} — cambios sin guardar
    drawingCache: {},     // path -> {version, elements, sha} — cache de la nota abierta
    activeDrawing: null,  // {path, api} cuando el modal de dibujo esta abierto
    draftTimer: null,     // setInterval id mientras se autosave-a un draft
    pendingDraft: null,   // texto recuperado de localStorage a inyectar al entrar a edit
    searchQuery: ''       // filtro del sidebar (lowercase)
  };

  // ------------- Helpers -------------
  function toast(msg, ms) {
    elToast.textContent = msg;
    elToast.className = 'toast';
    if (toast._t) { clearTimeout(toast._t); }
    toast._t = setTimeout(function () {
      elToast.className = 'toast hidden';
    }, ms || 2200);
  }

  function setMsg(el, txt, ok) {
    el.textContent = txt || '';
    el.className = ok ? 'msg ok' : 'msg';
  }

  function encB64(str) {
    return btoa(unescape(encodeURIComponent(str)));
  }
  function decB64(b64) {
    return decodeURIComponent(escape(atob(String(b64).replace(/\n/g, ''))));
  }

  function loadCfg() {
    try {
      var raw = localStorage.getItem(LS_CFG);
      if (!raw) return null;
      var c = JSON.parse(raw);
      if (!c || !c.user || !c.repo || !c.pat) return null;
      if (!c.branch) c.branch = 'main';
      return c;
    } catch (e) { return null; }
  }
  function saveCfg(c) {
    localStorage.setItem(LS_CFG, JSON.stringify(c));
  }
  function clearCfg() {
    localStorage.removeItem(LS_CFG);
    localStorage.removeItem(LS_TREE);
    localStorage.removeItem(LS_LAST);
    // El SW cachea respuestas con el contenido de las notas. Si el usuario
    // borra config (cambia de cuenta/repo) tenemos que purgar para que no
    // reciba notas del scope anterior cuando reconfigure.
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_NOTES' });
    }
  }

  function loadTheme() {
    var t = localStorage.getItem(LS_THEME);
    if (t === 'dark') document.body.className = 'theme-dark';
  }
  function toggleTheme() {
    var dark = document.body.className !== 'theme-dark';
    document.body.className = dark ? 'theme-dark' : '';
    localStorage.setItem(LS_THEME, dark ? 'dark' : 'light');
  }

  function friendlyError(err) {
    if (!err) return 'Error';
    var msg = err.error || '';
    if (err.status === 422 && /sha/i.test(msg)) return 'Ya existe un archivo en esa ruta.';
    if (err.status === 404) return 'No encontrado (revisá user/repo/branch).';
    if (err.status === 401) return 'PAT invalido o sin permisos.';
    if (err.status === 403) return 'Acceso denegado por GitHub (' + msg + ').';
    if (err.status === 0) return 'Sin conexion (' + (IS_DEPLOYED ? 'proxy' : 'GitHub') + ' inaccesible).';
    return msg || ('Error HTTP ' + (err.status || '?'));
  }

  // ------------- GitHub API client -------------
  function api(method, path, body, cb) {
    var c = state.cfg;
    if (!c) { cb({ status: 0, error: 'No config' }); return; }
    var xhr = new XMLHttpRequest();
    var url = API + path;
    xhr.open(method, url, true);
    xhr.setRequestHeader('Authorization', 'token ' + c.pat);
    xhr.setRequestHeader('Accept', 'application/vnd.github+json');
    if (body) xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      var data = null;
      try { data = xhr.responseText ? JSON.parse(xhr.responseText) : null; } catch (e) { data = null; }
      if (xhr.status >= 200 && xhr.status < 300) {
        cb(null, data, xhr.status);
      } else {
        cb({
          status: xhr.status,
          error: (data && data.message) ? data.message : ('HTTP ' + xhr.status)
        }, data, xhr.status);
      }
    };
    xhr.send(body ? JSON.stringify(body) : null);
  }

  function apiCheckRepo(cb) {
    api('GET', '/repos/' + state.cfg.user + '/' + state.cfg.repo, null, cb);
  }

  function apiGetTree(cb) {
    var c = state.cfg;
    api('GET', '/repos/' + c.user + '/' + c.repo + '/git/trees/' + encodeURIComponent(c.branch) + '?recursive=1',
      null, function (err, data) {
        if (err) {
          // Repo recien creado sin commits: GitHub responde 409 "Git Repository
          // is empty.". Tambien podriamos ver 404 si la branch no existe todavia
          // (caso default-branch del repo distinto al que configuro el usuario,
          // o el primer commit aun no se hizo).
          var msg = (err.error || '').toLowerCase();
          if (err.status === 409 || (err.status === 404 && msg.indexOf('empty') >= 0)) {
            cb(null, []);
            return;
          }
          cb(err); return;
        }
        if (!data || !data.tree) { cb({ status: 0, error: 'Respuesta sin tree' }); return; }
        cb(null, data.tree);
      });
  }

  function apiGetFile(path, cb) {
    var c = state.cfg;
    api('GET', '/repos/' + c.user + '/' + c.repo + '/contents/' +
      encodePath(path) + '?ref=' + encodeURIComponent(c.branch), null, cb);
  }

  function apiPutFile(path, contentStr, sha, message, cb) {
    var c = state.cfg;
    var body = {
      message: message || ('Update ' + path),
      content: encB64(contentStr),
      branch: c.branch
    };
    if (sha) body.sha = sha;
    api('PUT', '/repos/' + c.user + '/' + c.repo + '/contents/' + encodePath(path), body, cb);
  }

  function encodePath(p) {
    var parts = p.split('/');
    for (var i = 0; i < parts.length; i++) parts[i] = encodeURIComponent(parts[i]);
    return parts.join('/');
  }

  // ------------- Draft autosave -------------
  // Safari 9 puede matar la pestana en background sin avisar. Persistimos el
  // textarea cada DRAFT_AUTOSAVE_MS para no perder lo que estabas tipeando.
  function draftKey(path) { return LS_DRAFT_PREFIX + path; }
  function saveDraft(path, text) {
    if (!path) return;
    try { localStorage.setItem(draftKey(path), text); } catch (e) {}
  }
  function loadDraft(path) {
    if (!path) return null;
    try { return localStorage.getItem(draftKey(path)); } catch (e) { return null; }
  }
  function clearDraft(path) {
    if (!path) return;
    try { localStorage.removeItem(draftKey(path)); } catch (e) {}
  }
  function startDraftAutosave() {
    stopDraftAutosave();
    state.draftTimer = setInterval(function () {
      if (state.editing && state.openPath) {
        saveDraft(state.openPath, elEditor.value);
      }
    }, DRAFT_AUTOSAVE_MS);
  }
  function stopDraftAutosave() {
    if (state.draftTimer) {
      clearInterval(state.draftTimer);
      state.draftTimer = null;
    }
    // Flush sincronico: el ultimo intervalo pudo haber sido hace casi
    // DRAFT_AUTOSAVE_MS, no queremos perder esos segundos.
    if (state.editing && state.openPath) {
      saveDraft(state.openPath, elEditor.value);
    }
  }

  // ------------- Tree caching -------------
  function cacheTree(items) {
    try {
      localStorage.setItem(LS_TREE, JSON.stringify({ ts: (new Date()).getTime(), items: items }));
    } catch (e) {}
  }
  function loadCachedTree() {
    try {
      var raw = localStorage.getItem(LS_TREE);
      if (!raw) return null;
      var c = JSON.parse(raw);
      if (!c || !c.items) return null;
      if ((new Date()).getTime() - c.ts > TREE_TTL_MS) return null;
      return c.items;
    } catch (e) { return null; }
  }

  // ------------- Tree render -------------
  // GitHub no permite carpetas vacias en git. Para representar una carpeta
  // creada desde la app usamos un archivo .gitkeep adentro. Esos .gitkeep
  // no se muestran como archivos, pero marcan la carpeta como "mantener".
  function buildTreeNodes(items) {
    var root = { name: '', path: '', type: 'tree', children: {}, order: [] };
    var explicitFolders = {};

    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!it.path) continue;

      // Ocultar la carpeta de dibujos del sidebar
      if (it.path === 'assets' || it.path.indexOf('assets/') === 0) continue;

      if (it.type === 'tree') {
        ensurePath(root, it.path, false);
        continue;
      }
      if (it.type !== 'blob') continue;

      if (/(^|\/)\.gitkeep$/i.test(it.path)) {
        var folder = it.path.replace(/(^|\/)\.gitkeep$/i, '');
        if (folder) {
          ensurePath(root, folder, false);
          explicitFolders[folder] = true;
        }
        continue;
      }

      if (!/\.(md|html?)$/i.test(it.path)) continue;
      ensurePath(root, it.path, true);
    }

    pruneEmpty(root, explicitFolders);
    return root;
  }

  function ensurePath(rootNode, path, lastIsFile) {
    var parts = path.split('/');
    var node = rootNode;
    for (var j = 0; j < parts.length; j++) {
      var name = parts[j];
      var isLeaf = (j === parts.length - 1);
      var typ = (isLeaf && lastIsFile) ? 'blob' : 'tree';
      if (!node.children[name]) {
        node.children[name] = {
          name: name,
          path: parts.slice(0, j + 1).join('/'),
          type: typ,
          children: {},
          order: []
        };
        node.order.push(name);
      } else if (isLeaf && lastIsFile) {
        node.children[name].type = 'blob';
      }
      node = node.children[name];
    }
  }

  function pruneEmpty(node, explicitFolders) {
    if (node.type !== 'tree') return node.type === 'blob';
    var keep = [];
    for (var i = 0; i < node.order.length; i++) {
      var name = node.order[i];
      var child = node.children[name];
      var has = pruneEmpty(child, explicitFolders);
      if (has || (child.type === 'tree' && explicitFolders[child.path])) {
        keep.push(name);
      } else {
        delete node.children[name];
      }
    }
    node.order = keep;
    node.order.sort(function (a, b) {
      var ca = node.children[a], cb = node.children[b];
      if (ca.type !== cb.type) return ca.type === 'tree' ? -1 : 1;
      return ca.name.toLowerCase() < cb.name.toLowerCase() ? -1 : 1;
    });
    return node.order.length > 0;
  }

  function renderTree() {
    var root = buildTreeNodes(state.tree);
    if (state.searchQuery) markMatches(root, state.searchQuery);
    elTree.innerHTML = '';
    if (!root.order.length) {
      var empty = document.createElement('div');
      empty.className = 'empty-msg';
      empty.textContent = 'Repo vacio. Crea tu primera nota con +Nuevo.';
      elTree.appendChild(empty);
      return;
    }
    var ul = document.createElement('ul');
    var rendered = 0;
    for (var i = 0; i < root.order.length; i++) {
      var child = root.children[root.order[i]];
      if (state.searchQuery && !child._matches) continue;
      ul.appendChild(renderNode(child));
      rendered++;
    }
    if (state.searchQuery && rendered === 0) {
      var noMatch = document.createElement('div');
      noMatch.className = 'empty-msg';
      noMatch.textContent = 'Sin resultados para "' + state.searchQuery + '"';
      elTree.appendChild(noMatch);
      return;
    }
    elTree.appendChild(ul);
  }
  // Marca _matches en cada nodo y auto-expande ancestros de matches.
  function markMatches(node, q) {
    var anyChild = false;
    for (var i = 0; i < node.order.length; i++) {
      var child = node.children[node.order[i]];
      if (markMatches(child, q)) anyChild = true;
    }
    var selfMatch = false;
    if (node.type === 'blob') {
      selfMatch = node.path.toLowerCase().indexOf(q) >= 0;
    }
    node._matches = anyChild || selfMatch;
    if (node._matches && node.type === 'tree' && node.path) {
      state.expanded[node.path] = true;
    }
    return node._matches;
  }

  function renderNode(node) {
    var li = document.createElement('li');
    li.className = node.type === 'tree' ? 'folder' : 'file';

    var row = document.createElement('div');
    row.className = 'row';
    if (node.type === 'blob' && state.openPath === node.path) {
      row.className += ' active';
    }

    var caret = document.createElement('span');
    caret.className = 'caret';
    var icon = document.createElement('span');
    icon.className = 'icon';
    var nameEl = document.createElement('span');
    nameEl.className = 'name';
    var displayName = node.name;
    if (node.type === 'blob') displayName = displayName.replace(/\.(md|html?)$/i, '');
    nameEl.textContent = displayName;

    if (node.type === 'tree') {
      var expanded = !!state.expanded[node.path];
      caret.innerHTML = expanded ? '&#9660;' : '&#9654;';
      icon.textContent = '📁';
      row.onclick = function () {
        state.expanded[node.path] = !state.expanded[node.path];
        renderTree();
      };
    } else {
      caret.innerHTML = '&nbsp;';
      icon.textContent = /\.html?$/i.test(node.name) ? '🌐' : '📄';
      row.onclick = function () { openNote(node.path); };
    }

    row.appendChild(caret);
    row.appendChild(icon);
    row.appendChild(nameEl);

    if (node.type === 'tree') {
      var del = document.createElement('span');
      del.className = 'del';
      del.innerHTML = '&times;';
      del.title = 'Borrar carpeta';
      (function (path) {
        del.onclick = function (e) {
          if (e.stopPropagation) e.stopPropagation();
          deleteFolder(path);
        };
      })(node.path);
      row.appendChild(del);
    }

    li.appendChild(row);

    if (node.type === 'tree' && state.expanded[node.path]) {
      var sub = document.createElement('ul');
      for (var i = 0; i < node.order.length; i++) {
        var c = node.children[node.order[i]];
        if (state.searchQuery && !c._matches) continue;
        sub.appendChild(renderNode(c));
      }
      li.appendChild(sub);
    }
    return li;
  }

  function expandAncestors(path) {
    var parts = path.split('/');
    var acc = '';
    for (var i = 0; i < parts.length - 1; i++) {
      acc = acc ? acc + '/' + parts[i] : parts[i];
      state.expanded[acc] = true;
    }
  }

  // ------------- Tree load -------------
  function loadTreeFromServer(cb) {
    apiGetTree(function (err, tree) {
      if (err) { if (cb) cb(err); return; }
      state.tree = tree || [];
      cacheTree(state.tree);
      renderTree();
      if (cb) cb(null);
    });
  }

  function loadTreeFresh(cb) {
    var cached = loadCachedTree();
    if (cached) {
      state.tree = cached;
      renderTree();
      if (cb) cb(null);
      return;
    }
    loadTreeFromServer(cb);
  }

  // ------------- Open note -------------
  function detectType(path) {
    return /\.html?$/i.test(path) ? 'html' : 'md';
  }

  function openNote(path) {
    setMode('view');
    elPath.textContent = path;
    elRender.innerHTML = '';
    elRender.classList.remove('hidden');
    elEmpty.classList.add('hidden');
    elEditBtn.disabled = true;
    apiGetFile(path, function (err, data) {
      if (err) {
        toast('Error al abrir: ' + friendlyError(err));
        return;
      }
      var content = '';
      try { content = decB64(data.content || ''); }
      catch (e) { content = '(No se pudo decodificar el contenido)'; }
      state.openPath = path;
      state.openSha = data.sha;
      state.openContent = content;
      state.openType = detectType(path);
      localStorage.setItem(LS_LAST, path);
      expandAncestors(path);
      renderView(content);
      elEditBtn.disabled = false;
      elDeleteBtn.disabled = false;
      renderTree();
      // close sidebar overlay on small screens
      if (window.innerWidth <= 720) elSidebar.classList.add('hidden');
      // Si quedo un draft sin guardar (Safari mato la pestana, refresh, etc),
      // ofrecer recuperarlo. Solo si difiere del contenido remoto.
      var draft = loadDraft(path);
      if (draft != null && draft !== content) {
        if (confirm('Hay un borrador sin guardar de "' + path + '". Recuperar? (Cancelar lo descarta)')) {
          state.pendingDraft = draft;
          setMode('edit');
        } else {
          clearDraft(path);
        }
      }
    });
  }

  function renderView(content) {
    if (state.openType === 'html') {
      elRender.className = 'render html-mode';
      elRender.innerHTML = '';
      var iframe = document.createElement('iframe');
      iframe.className = 'html-frame';
      iframe.setAttribute('sandbox', '');
      // sandbox sin allow-* → no scripts, no forms, no top-nav. Maximo aislamiento.
      iframe.srcdoc = content || '';
      elRender.appendChild(iframe);
    } else {
      elRender.className = 'render';
      renderMarkdown(content);
    }
  }

  function renderMarkdown(md) {
    var html;
    try { html = window.snarkdown(md || ''); }
    catch (e) { html = '<p>(error renderizando)</p>'; }
    elRender.innerHTML = '';
    var safe = sanitizeHtml(html);
    while (safe.firstChild) elRender.appendChild(safe.firstChild);
    postProcessDrawings();
  }

  // snarkdown deja pasar HTML inline ('<script>', on*-handlers, javascript:).
  // Si una nota maliciosa lo aprovecha, puede leer el PAT de localStorage.
  // Whitelist chica de tags y atributos; todo lo demas se descarta.
  var ALLOWED_TAGS = {
    A:1, P:1, BR:1, HR:1, STRONG:1, EM:1, B:1, I:1, U:1, S:1, DEL:1,
    H1:1, H2:1, H3:1, H4:1, H5:1, H6:1,
    UL:1, OL:1, LI:1,
    CODE:1, PRE:1, BLOCKQUOTE:1,
    IMG:1, SPAN:1, DIV:1
  };
  var ALLOWED_ATTRS = {
    href:1, src:1, alt:1, title:1
  };
  function sanitizeHtml(html) {
    var holder = document.createElement('div');
    holder.innerHTML = html || '';
    sanitizeNode(holder);
    return holder;
  }
  function sanitizeNode(node) {
    var i, child, next;
    child = node.firstChild;
    while (child) {
      next = child.nextSibling;
      if (child.nodeType === 1) {
        var tag = child.tagName;
        if (!ALLOWED_TAGS[tag]) {
          // Promover los hijos antes de eliminar el nodo (asi no perdemos texto).
          while (child.firstChild) node.insertBefore(child.firstChild, child);
          node.removeChild(child);
        } else {
          var attrs = child.attributes;
          for (i = attrs.length - 1; i >= 0; i--) {
            var a = attrs[i];
            var nm = a.name.toLowerCase();
            if (!ALLOWED_ATTRS[nm]) {
              child.removeAttribute(a.name);
              continue;
            }
            if ((nm === 'href' || nm === 'src') && /^\s*javascript:/i.test(a.value)) {
              child.removeAttribute(a.name);
            }
          }
          sanitizeNode(child);
        }
      } else if (child.nodeType === 8) {
        // comentarios fuera
        node.removeChild(child);
      }
      child = next;
    }
  }

  function postProcessDrawings() {
    if (!window.Drawing) return;
    var imgs = elRender.getElementsByTagName('img');
    // Snapshot porque vamos a mutar el DOM
    var toProcess = [];
    for (var i = 0; i < imgs.length; i++) {
      var src = imgs[i].getAttribute('src') || '';
      if (/\.draw($|\?)/i.test(src)) toProcess.push({ img: imgs[i], path: src });
    }
    for (var j = 0; j < toProcess.length; j++) {
      (function (path, img) {
        var canvas = document.createElement('canvas');
        canvas.className = 'render-drawing';
        if (img.parentNode) img.parentNode.replaceChild(canvas, img);
        fetchDrawing(path, function (err, data) {
          if (err) {
            var broken = document.createElement('span');
            broken.className = 'render-drawing-broken';
            broken.textContent = '(dibujo no encontrado: ' + path + ')';
            if (canvas.parentNode) canvas.parentNode.replaceChild(broken, canvas);
            return;
          }
          window.Drawing.renderStatic(canvas, data.elements || []);
        });
      })(toProcess[j].path, toProcess[j].img);
    }
  }

  function fetchDrawing(path, cb) {
    if (state.pendingDrawings[path]) { cb(null, state.pendingDrawings[path]); return; }
    if (state.drawingCache[path]) { cb(null, state.drawingCache[path]); return; }
    apiGetFile(path, function (err, data) {
      if (err) { cb(err); return; }
      var parsed;
      try {
        var content = decB64(data.content || '');
        parsed = JSON.parse(content);
        if (!parsed.elements) parsed.elements = [];
      } catch (e) {
        cb({ status: 0, error: 'JSON invalido en ' + path });
        return;
      }
      parsed.sha = data.sha;
      state.drawingCache[path] = parsed;
      cb(null, parsed);
    });
  }

  function generateDrawingId() {
    var chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    var id = '';
    for (var i = 0; i < 12; i++) {
      id += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return id;
  }

  function parseDrawingRefs(text) {
    var refs = [];
    var seen = {};
    var re = /!\[[^\]]*\]\((assets\/[^\)\s]+?\.draw)\)/g;
    var m;
    while ((m = re.exec(text)) !== null) {
      if (!seen[m[1]]) { seen[m[1]] = true; refs.push(m[1]); }
    }
    return refs;
  }

  function refreshDrawingStrip() {
    var refs = parseDrawingRefs(elEditor.value || '');
    elDrawingsStrip.innerHTML = '';
    if (!refs.length) {
      elDrawingsStrip.classList.add('hidden');
      elEditor.classList.remove('with-strip');
      return;
    }
    elDrawingsStrip.classList.remove('hidden');
    elEditor.classList.add('with-strip');
    var label = document.createElement('div');
    label.className = 'strip-label';
    label.textContent = 'Dibujos en esta nota (tap para editar):';
    elDrawingsStrip.appendChild(label);
    for (var i = 0; i < refs.length; i++) {
      (function (path) {
        var thumb = document.createElement('div');
        thumb.className = 'drawing-thumb';
        var canvas = document.createElement('canvas');
        thumb.appendChild(canvas);
        var lbl = document.createElement('span');
        lbl.className = 'thumb-label';
        lbl.textContent = path.split('/').pop();
        thumb.appendChild(lbl);
        thumb.onclick = function () { openDrawingModal(path); };
        elDrawingsStrip.appendChild(thumb);
        fetchDrawing(path, function (err, data) {
          if (err) { thumb.title = 'No se pudo cargar'; return; }
          if (window.Drawing) window.Drawing.renderStatic(canvas, data.elements || []);
        });
      })(refs[i]);
    }
  }

  function insertAtCursor(textarea, text) {
    textarea.focus();
    var start = textarea.selectionStart || 0;
    var end = textarea.selectionEnd || 0;
    var value = textarea.value;
    textarea.value = value.substring(0, start) + text + value.substring(end);
    var newPos = start + text.length;
    textarea.selectionStart = textarea.selectionEnd = newPos;
  }

  // ------------- Markdown toolbar helpers -------------
  // Envuelve la seleccion (o el placeholder) con before/after.
  function wrapSelection(textarea, before, after, placeholder) {
    var start = textarea.selectionStart || 0;
    var end = textarea.selectionEnd || 0;
    var value = textarea.value;
    var sel = value.substring(start, end);
    var inner = sel || (placeholder || '');
    textarea.value = value.substring(0, start) + before + inner + after + value.substring(end);
    textarea.focus();
    if (sel) {
      textarea.selectionStart = start + before.length;
      textarea.selectionEnd = start + before.length + inner.length;
    } else {
      var pos = start + before.length;
      textarea.selectionStart = pos;
      textarea.selectionEnd = pos + inner.length;
    }
  }
  // Agrega un prefijo al inicio de cada linea de la seleccion (o de la linea actual).
  function prefixLines(textarea, prefix) {
    var start = textarea.selectionStart || 0;
    var end = textarea.selectionEnd || 0;
    var value = textarea.value;
    // Expandir al inicio de la primera linea.
    var lineStart = value.lastIndexOf('\n', start - 1) + 1;
    var block = value.substring(lineStart, end);
    var lines = block.split('\n');
    for (var i = 0; i < lines.length; i++) lines[i] = prefix + lines[i];
    var replaced = lines.join('\n');
    textarea.value = value.substring(0, lineStart) + replaced + value.substring(end);
    textarea.focus();
    textarea.selectionStart = lineStart;
    textarea.selectionEnd = lineStart + replaced.length;
  }
  function applyMdAction(action) {
    var ta = elEditor;
    if (action === 'bold')      { wrapSelection(ta, '**', '**', 'texto'); }
    else if (action === 'italic')   { wrapSelection(ta, '*', '*', 'texto'); }
    else if (action === 'code')     { wrapSelection(ta, '`', '`', 'codigo'); }
    else if (action === 'codeblock'){ wrapSelection(ta, '\n```\n', '\n```\n', 'codigo'); }
    else if (action === 'link')     { wrapSelection(ta, '[', '](https://)', 'texto'); }
    else if (action === 'h1')       { prefixLines(ta, '# '); }
    else if (action === 'h2')       { prefixLines(ta, '## '); }
    else if (action === 'ul')       { prefixLines(ta, '- '); }
    else if (action === 'ol')       { prefixLines(ta, '1. '); }
    else if (action === 'quote')    { prefixLines(ta, '> '); }
    else if (action === 'hr')       { insertAtCursor(ta, '\n\n---\n\n'); }
  }

  function openDrawingModal(pathOrNull) {
    if (state.activeDrawing) return;
    var isNew = !pathOrNull;
    var path = pathOrNull || ('assets/d-' + generateDrawingId() + '.draw');
    state.activeDrawing = { path: path, isNew: isNew, api: null };
    elModalDrawing.classList.remove('hidden');

    function mountWith(elements) {
      if (!window.Drawing) {
        toast('Modulo de dibujo no cargado');
        closeDrawingModal(false);
        return;
      }
      state.activeDrawing.api = window.Drawing.mount(
        elDrawingCanvas, elDrawingToolbar, { initialElements: elements }
      );
    }

    setTimeout(function () {
      if (isNew) { mountWith([]); return; }
      var entry = state.pendingDrawings[path] || state.drawingCache[path];
      if (entry) { mountWith(entry.elements || []); return; }
      fetchDrawing(path, function (err, data) {
        if (err) {
          toast('No se pudo cargar el dibujo: ' + friendlyError(err));
          closeDrawingModal(false);
          return;
        }
        mountWith(data.elements || []);
      });
    }, 50);
  }

  function closeDrawingModal(commit) {
    if (!state.activeDrawing) return;
    var ad = state.activeDrawing;
    if (commit && ad.api) {
      var elements = ad.api.getElements();
      var existingSha = null;
      if (state.pendingDrawings[ad.path]) existingSha = state.pendingDrawings[ad.path].sha;
      else if (state.drawingCache[ad.path]) existingSha = state.drawingCache[ad.path].sha;
      state.pendingDrawings[ad.path] = { elements: elements, sha: existingSha };
      if (ad.isNew) insertAtCursor(elEditor, '\n\n![drawing](' + ad.path + ')\n\n');
      refreshDrawingStrip();
    }
    if (ad.api) { try { ad.api.destroy(); } catch (e) {} }
    state.activeDrawing = null;
    elModalDrawing.classList.add('hidden');
  }

  // ------------- Edit / save -------------
  function setMode(mode) {
    if (mode === 'edit') {
      state.editing = true;
      // En el flujo normal el textarea arranca con el contenido remoto.
      // Cuando recuperamos un draft, el caller setea pendingDraft con el texto.
      elEditor.value = (state.pendingDraft != null) ? state.pendingDraft : state.openContent;
      state.pendingDraft = null;
      elEditor.classList.remove('hidden');
      elRender.classList.add('hidden');
      elEditBtn.classList.add('hidden');
      elSaveBtn.classList.remove('hidden');
      elCancelBtn.classList.remove('hidden');
      elDeleteBtn.classList.add('hidden');
      // En .html no aplican ni el toolbar markdown ni el botón dibujo (la sintaxis
      // markdown no se renderiza). Drafts (autosave) sí aplican a ambos tipos.
      if (state.openType === 'md') {
        elInsertDrawingBtn.classList.remove('hidden');
        elMdToolbar.classList.remove('hidden');
        elEditor.classList.add('with-toolbar');
        refreshDrawingStrip();
      } else {
        elInsertDrawingBtn.classList.add('hidden');
        elMdToolbar.classList.add('hidden');
        elEditor.classList.remove('with-toolbar');
        elDrawingsStrip.classList.add('hidden');
        elEditor.classList.remove('with-strip');
      }
      elNewBtn.disabled = true;
      startDraftAutosave();
      setTimeout(function () { elEditor.focus(); }, 30);
    } else {
      state.editing = false;
      stopDraftAutosave();
      elEditor.classList.add('hidden');
      elRender.classList.remove('hidden');
      elEditBtn.classList.remove('hidden');
      elSaveBtn.classList.add('hidden');
      elCancelBtn.classList.add('hidden');
      elDeleteBtn.classList.remove('hidden');
      elInsertDrawingBtn.classList.add('hidden');
      elMdToolbar.classList.add('hidden');
      elEditor.classList.remove('with-toolbar');
      elDrawingsStrip.classList.add('hidden');
      elEditor.classList.remove('with-strip');
      elNewBtn.disabled = false;
    }
  }

  function saveCurrent() {
    if (!state.openPath) return;
    elSaveBtn.disabled = true;
    elCancelBtn.disabled = true;

    var pendingPaths = [];
    for (var p in state.pendingDrawings) {
      if (state.pendingDrawings.hasOwnProperty(p)) pendingPaths.push(p);
    }
    if (pendingPaths.length) toast('Subiendo ' + pendingPaths.length + ' dibujo(s)...', 4000);
    uploadPendingDrawings(pendingPaths, 0, function (err) {
      if (err) {
        elSaveBtn.disabled = false;
        elCancelBtn.disabled = false;
        toast('Error guardando dibujo: ' + friendlyError(err));
        return;
      }
      saveNoteText();
    });
  }

  function uploadPendingDrawings(paths, idx, cb) {
    if (idx >= paths.length) { cb(null); return; }
    var path = paths[idx];
    var entry = state.pendingDrawings[path];
    var content = JSON.stringify({ version: 1, elements: entry.elements });
    apiPutFile(path, content, entry.sha, 'Update drawing ' + path, function (err, data) {
      if (err) { cb(err); return; }
      var newSha = (data && data.content && data.content.sha) || null;
      var wasNew = !entry.sha;
      state.drawingCache[path] = { version: 1, elements: entry.elements, sha: newSha };
      delete state.pendingDrawings[path];
      if (wasNew) {
        state.tree.push({ path: path, type: 'blob', sha: newSha });
      }
      uploadPendingDrawings(paths, idx + 1, cb);
    });
  }

  function saveNoteText() {
    var newContent = elEditor.value;
    apiPutFile(state.openPath, newContent, state.openSha, 'Update ' + state.openPath,
      function (err, data) {
        elSaveBtn.disabled = false;
        elCancelBtn.disabled = false;
        if (err) {
          if (err.status === 409 || err.status === 422) {
            showConflict(newContent);
            return;
          }
          toast('Error al guardar: ' + friendlyError(err));
          return;
        }
        state.openContent = newContent;
        if (data && data.content && data.content.sha) {
          state.openSha = data.content.sha;
        }
        clearDraft(state.openPath);
        renderView(newContent);
        setMode('view');
        toast('Guardado');
        cacheTree(state.tree);
      });
  }

  function deleteCurrent() {
    if (!state.openPath) return;
    if (!confirm('Borrar "' + state.openPath + '"? Esta accion no se puede deshacer.')) return;
    elDeleteBtn.disabled = true;
    var path = state.openPath;
    var c = state.cfg;
    api('DELETE', '/repos/' + c.user + '/' + c.repo + '/contents/' + encodePath(path),
      { message: 'Delete ' + path, sha: state.openSha, branch: c.branch },
      function (err) {
        if (err) {
          toast('Error al borrar: ' + friendlyError(err));
          elDeleteBtn.disabled = false;
          return;
        }
        state.tree = state.tree.filter(function (it) { return it.path !== path; });
        clearDraft(path);
        clearOpenNote();
        renderTree();
        toast('Borrado');
        cacheTree(state.tree);
        setTimeout(loadTreeFromServer, 1500);
      });
  }

  function clearOpenNote() {
    state.openPath = null;
    state.openSha = null;
    state.openContent = '';
    state.openType = 'md';
    state.pendingDrawings = {};
    state.drawingCache = {};
    try { localStorage.removeItem(LS_LAST); } catch (e) {}
    elPath.textContent = '';
    elRender.innerHTML = '';
    elRender.classList.add('hidden');
    elEmpty.classList.remove('hidden');
    elEditBtn.disabled = true;
    elDeleteBtn.disabled = true;
  }

  function deleteFolder(folderPath) {
    if (!confirm('Borrar carpeta "' + folderPath + '" y TODO su contenido? Esta accion no se puede deshacer.')) return;
    var prefix = folderPath + '/';
    var toDelete = [];
    for (var i = 0; i < state.tree.length; i++) {
      var it = state.tree[i];
      if (it.type === 'blob' && it.path.indexOf(prefix) === 0) {
        toDelete.push(it);
      }
    }
    if (!toDelete.length) {
      toast('Carpeta sin archivos para borrar');
      return;
    }
    toast('Borrando ' + toDelete.length + ' archivo(s)...', 5000);
    deleteSequence(toDelete, 0, folderPath);
  }

  function deleteSequence(items, idx, folderPath) {
    if (idx >= items.length) {
      var prefix = folderPath + '/';
      state.tree = state.tree.filter(function (it) {
        return !(it.type === 'blob' && it.path.indexOf(prefix) === 0);
      });
      if (state.openPath && state.openPath.indexOf(prefix) === 0) clearOpenNote();
      renderTree();
      toast('Carpeta borrada');
      cacheTree(state.tree);
      setTimeout(loadTreeFromServer, 1500);
      return;
    }
    var it = items[idx];
    var c = state.cfg;
    function doDel(sha) {
      api('DELETE', '/repos/' + c.user + '/' + c.repo + '/contents/' + encodePath(it.path),
        { message: 'Delete ' + it.path, sha: sha, branch: c.branch },
        function (err) {
          if (err) { toast('Error al borrar ' + it.path + ': ' + friendlyError(err)); return; }
          deleteSequence(items, idx + 1, folderPath);
        });
    }
    if (it.sha) {
      doDel(it.sha);
    } else {
      apiGetFile(it.path, function (err, data) {
        if (err) { toast('Error: ' + friendlyError(err)); return; }
        doDel(data.sha);
      });
    }
  }

  function showConflict(localText) {
    elConflictMsg.textContent = '';
    elModalConflict.classList.remove('hidden');
    elConflictDiscard.onclick = function () {
      clearDraft(state.openPath);
      elModalConflict.classList.add('hidden');
      openNote(state.openPath);
    };
    elConflictCopy.onclick = function () {
      var ok = false;
      try {
        var ta = document.createElement('textarea');
        ta.value = localText;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
        document.body.removeChild(ta);
      } catch (e) { ok = false; }
      if (!ok) {
        setMsg(elConflictMsg, 'No pude copiar al portapapeles. Selecciona el texto en el editor y copia a mano.');
        return;
      }
      clearDraft(state.openPath);
      elModalConflict.classList.add('hidden');
      toast('Texto copiado. Recargando version actual.');
      openNote(state.openPath);
    };
  }

  // ------------- New note / folder -------------
  function openNewModal(kind) {
    state.newKind = kind || 'file';
    elNewTabFile.className = state.newKind === 'file' ? 'tab active' : 'tab';
    elNewTabHtml.className = state.newKind === 'html' ? 'tab active' : 'tab';
    elNewTabFolder.className = state.newKind === 'folder' ? 'tab active' : 'tab';
    var label;
    if (state.newKind === 'file') label = 'Nombre (sin .md)';
    else if (state.newKind === 'html') label = 'Nombre (sin .html)';
    else label = 'Nombre carpeta';
    elNewNameLabel.firstChild.nodeValue = label;
    populateParentSelect(inferParent());
    elNewName.value = '';
    setMsg(elNewMsg, '');
    elModalNew.classList.remove('hidden');
    setTimeout(function () { elNewName.focus(); }, 30);
  }

  function inferParent() {
    if (state.openPath) {
      var i = state.openPath.lastIndexOf('/');
      if (i > 0) return state.openPath.substring(0, i);
    }
    return '';
  }

  function collectFolders() {
    var seen = {};
    for (var i = 0; i < state.tree.length; i++) {
      var it = state.tree[i];
      var parents = [];
      if (it.type === 'tree') {
        parents.push(it.path);
      } else if (it.type === 'blob') {
        var p = it.path;
        var idx = p.lastIndexOf('/');
        while (idx > 0) {
          parents.push(p.substring(0, idx));
          idx = p.lastIndexOf('/', idx - 1);
        }
      }
      for (var j = 0; j < parents.length; j++) {
        if (parents[j]) seen[parents[j]] = true;
      }
    }
    var arr = [];
    for (var k in seen) if (seen.hasOwnProperty(k)) arr.push(k);
    arr.sort();
    return arr;
  }

  function populateParentSelect(preferredParent) {
    var folders = collectFolders();
    elNewParent.innerHTML = '';
    var opt0 = document.createElement('option');
    opt0.value = '';
    opt0.textContent = '(raíz)';
    elNewParent.appendChild(opt0);
    for (var i = 0; i < folders.length; i++) {
      var opt = document.createElement('option');
      opt.value = folders[i];
      opt.textContent = folders[i];
      elNewParent.appendChild(opt);
    }
    if (preferredParent != null) elNewParent.value = preferredParent;
  }

  function createNew() {
    var parent = (elNewParent.value || '').replace(/^\s+|\s+$/g, '').replace(/^\/+|\/+$/g, '');
    var name = (elNewName.value || '').replace(/^\s+|\s+$/g, '').replace(/^\/+|\/+$/g, '');
    if (!name) { setMsg(elNewMsg, 'Falta el nombre'); return; }
    if (/[\\:*?"<>|]/.test(name) || /\/\s|\s\/$/.test(name)) {
      setMsg(elNewMsg, 'Caracteres no permitidos en el nombre'); return;
    }
    if (state.newKind === 'file' || state.newKind === 'html') {
      var ext = state.newKind === 'html' ? '.html' : '.md';
      var rext = state.newKind === 'html' ? /\.html?$/i : /\.md$/i;
      if (!rext.test(name)) name = name + ext;
      var fpath = parent ? parent + '/' + name : name;
      var titleNoExt = name.replace(rext, '');
      var initial = state.newKind === 'html'
        ? '<!doctype html>\n<html lang="es">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>' + titleNoExt + '</title>\n<style>\n  body { font-family: -apple-system, sans-serif; max-width: 720px; margin: 32px auto; padding: 0 16px; color: #222; line-height: 1.55; }\n  h1 { margin-top: 0; }\n</style>\n</head>\n<body>\n\n<h1>' + titleNoExt + '</h1>\n<p>Escribí HTML aquí.</p>\n\n</body>\n</html>\n'
        : '# ' + titleNoExt + '\n\n';
      setMsg(elNewMsg, 'Creando...');
      apiPutFile(fpath, initial, null, 'Create ' + fpath, function (err) {
        if (err) { setMsg(elNewMsg, friendlyError(err)); return; }
        elModalNew.classList.add('hidden');
        // Update optimista: GitHub's git/trees endpoint puede tardar segundos en
        // reflejar el archivo nuevo. Lo agregamos al estado local para que aparezca
        // ya, y refrescamos del server con delay como safety net.
        state.tree.push({ path: fpath, type: 'blob' });
        cacheTree(state.tree);
        expandAncestors(fpath);
        renderTree();
        openNote(fpath);
        setTimeout(function () { loadTreeFromServer(); }, 1500);
      });
    } else {
      var fpath2 = (parent ? parent + '/' : '') + name + '/.gitkeep';
      var folderPath = (parent ? parent + '/' : '') + name;
      setMsg(elNewMsg, 'Creando...');
      apiPutFile(fpath2, '', null, 'Create folder ' + name, function (err) {
        if (err) { setMsg(elNewMsg, friendlyError(err)); return; }
        elModalNew.classList.add('hidden');
        state.tree.push({ path: fpath2, type: 'blob' });
        cacheTree(state.tree);
        state.expanded[folderPath] = true;
        renderTree();
        setTimeout(function () { loadTreeFromServer(); }, 1500);
      });
    }
  }

  // ------------- Setup modal -------------
  function openSetupModal(prefill) {
    var c = prefill || state.cfg || { user: '', repo: '', branch: 'main', pat: '' };
    elCfgUser.value = c.user || '';
    elCfgRepo.value = c.repo || '';
    elCfgBranch.value = c.branch || 'main';
    elCfgPat.value = c.pat || '';
    setMsg(elCfgMsg, '');
    elModalSetup.classList.remove('hidden');
  }

  function saveSetup() {
    var c = {
      user: (elCfgUser.value || '').trim(),
      repo: (elCfgRepo.value || '').trim(),
      branch: (elCfgBranch.value || 'main').trim() || 'main',
      pat: (elCfgPat.value || '').trim()
    };
    if (!c.user || !c.repo || !c.pat) {
      setMsg(elCfgMsg, 'Faltan datos'); return;
    }
    elCfgSave.disabled = true;
    setMsg(elCfgMsg, 'Validando...');
    // Temporarily set cfg to allow api() to send
    var prev = state.cfg;
    state.cfg = c;
    apiCheckRepo(function (err) {
      elCfgSave.disabled = false;
      if (err) {
        state.cfg = prev;
        setMsg(elCfgMsg, 'Error: ' + friendlyError(err));
        return;
      }
      saveCfg(c);
      setMsg(elCfgMsg, 'Listo', true);
      elModalSetup.classList.add('hidden');
      try { localStorage.removeItem(LS_TREE); } catch (e) {}
      loadTreeFromServer(function () {
        var last = localStorage.getItem(LS_LAST);
        if (last) openNote(last);
      });
    });
  }

  // ------------- Wiring -------------
  function bind() {
    elToggleSidebar.onclick = function () {
      elSidebar.classList.toggle('hidden');
    };
    // Search del sidebar: filtro client-side sobre el path. Auto-expande
    // ancestros de los matches via markMatches() en renderTree.
    function onSearchChange() {
      var q = (elSearchInput.value || '').toLowerCase();
      if (q === state.searchQuery) return;
      state.searchQuery = q;
      renderTree();
    }
    elSearchInput.onkeyup = onSearchChange;
    elSearchInput.oninput = onSearchChange;
    elThemeBtn.onclick = toggleTheme;
    elSettingsBtn.onclick = function () { openSetupModal(); };
    elCfgSave.onclick = saveSetup;
    elCfgCancel.onclick = function () { elModalSetup.classList.add('hidden'); };
    elCfgClear.onclick = function () {
      if (confirm && !confirm('Borrar PAT y config del dispositivo?')) return;
      clearCfg();
      state.cfg = null;
      state.tree = [];
      clearOpenNote();
      elTree.innerHTML = '';
      elModalSetup.classList.add('hidden');
      openSetupModal({ user: '', repo: '', branch: 'main', pat: '' });
    };

    elRefreshBtn.onclick = function () {
      try { localStorage.removeItem(LS_TREE); } catch (e) {}
      if (!state.cfg) { openSetupModal(); return; }
      loadTreeFromServer(function (err) {
        if (err) { toast('Error: ' + friendlyError(err)); return; }
        toast('Recargado');
      });
    };

    elNewBtn.onclick = function () {
      if (!state.cfg) { openSetupModal(); return; }
      openNewModal('file');
    };
    elNewTabFile.onclick = function () { openNewModal('file'); };
    elNewTabHtml.onclick = function () { openNewModal('html'); };
    elNewTabFolder.onclick = function () { openNewModal('folder'); };
    elNewCancel.onclick = function () { elModalNew.classList.add('hidden'); };
    elNewCreate.onclick = createNew;

    elEditBtn.onclick = function () {
      if (!state.openPath) return;
      setMode('edit');
    };
    elCancelBtn.onclick = function () {
      state.pendingDrawings = {};
      clearDraft(state.openPath);
      setMode('view');
      renderView(state.openContent);
    };
    elSaveBtn.onclick = saveCurrent;
    elDeleteBtn.onclick = deleteCurrent;
    elInsertDrawingBtn.onclick = function () { openDrawingModal(null); };
    elDrawingDone.onclick = function () { closeDrawingModal(true); };
    elDrawingCancel.onclick = function () { closeDrawingModal(false); };

    // Toolbar de markdown: prevenimos el blur del textarea con mousedown/touchstart,
    // y aplicamos la accion en click. Un solo listener delegado al contenedor.
    function preventBlur(e) {
      if (e.target && e.target.getAttribute && e.target.getAttribute('data-md')) {
        if (e.preventDefault) e.preventDefault();
      }
    }
    elMdToolbar.addEventListener('mousedown', preventBlur);
    elMdToolbar.addEventListener('touchstart', preventBlur);
    elMdToolbar.onclick = function (e) {
      var t = e.target;
      while (t && t !== elMdToolbar && !(t.getAttribute && t.getAttribute('data-md'))) {
        t = t.parentNode;
      }
      if (!t || t === elMdToolbar) return;
      applyMdAction(t.getAttribute('data-md'));
    };
  }

  // ------------- Service Worker + offline UX -------------
  function registerSW() {
    // En dev por file:// no hay SW. Tampoco lo registramos si el browser no lo
    // soporta (iPad mini 1 / Safari 9 caen aca y siguen funcionando online).
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return;

    navigator.serviceWorker.register('sw.js').then(function (reg) {
      // Si ya hay un worker esperando al cargar, mostrar el banner.
      if (reg.waiting && navigator.serviceWorker.controller) {
        showUpdateBanner(reg.waiting);
      }
      reg.addEventListener('updatefound', function () {
        var nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', function () {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) {
            // Hay un controller existente => esto es un update, no la primera instalacion.
            showUpdateBanner(nw);
          }
        });
      });
    }).catch(function () { /* SW opcional, no es bloqueante */ });

    // Recarga la pagina cuando el nuevo SW toma control (post skipWaiting).
    var refreshed = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (refreshed) return;
      refreshed = true;
      location.reload();
    });
  }

  function showUpdateBanner(worker) {
    var banner = document.getElementById('update-banner');
    var btn = document.getElementById('update-reload');
    if (!banner || !btn) return;
    banner.classList.remove('hidden');
    btn.onclick = function () {
      worker.postMessage({ type: 'SKIP_WAITING' });
    };
  }

  function setupOfflineUX() {
    var banner = document.getElementById('offline-banner');
    function sync() {
      var off = (typeof navigator.onLine === 'boolean') ? !navigator.onLine : false;
      if (banner) {
        if (off) banner.classList.remove('hidden');
        else banner.classList.add('hidden');
      }
      // Bloquear Guardar mientras estamos offline: el PUT a GitHub iria a fallar
      // y el draft de localStorage ya cubre "no perder lo que escribi".
      if (off) {
        elSaveBtn.disabled = true;
        elSaveBtn.title = 'Sin conexion - el draft queda guardado localmente';
      } else if (state.editing) {
        elSaveBtn.disabled = false;
        elSaveBtn.title = '';
      }
    }
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    sync();
  }

  // ------------- Boot -------------
  function boot() {
    loadTheme();
    bind();
    registerSW();
    setupOfflineUX();
    var cfg = loadCfg();
    if (!cfg) {
      openSetupModal();
      return;
    }
    state.cfg = cfg;
    var last = localStorage.getItem(LS_LAST);
    loadTreeFresh(function (err) {
      if (err) {
        toast('Error: ' + friendlyError(err));
        if (err.status === 401 || err.status === 404) {
          openSetupModal(cfg);
        }
        return;
      }
      if (last) {
        expandAncestors(last);
        renderTree();
        openNote(last);
      }
    });
  }

  boot();
})();