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
  var elRefreshBtn = document.getElementById('refresh-btn');
  var elSettingsBtn = document.getElementById('settings-btn');
  var elThemeBtn = document.getElementById('theme-btn');
  var elRender = document.getElementById('render');
  var elEditor = document.getElementById('editor');
  var elEmpty = document.getElementById('empty');

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
  var elNewTabFolder = document.getElementById('new-tab-folder');

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
  var TREE_TTL_MS = 60 * 1000;

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
    editing: false,
    newKind: 'file',
    expanded: {}       // folder paths -> true
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
        if (err) { cb(err); return; }
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

      if (!/\.md$/i.test(it.path)) continue;
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
    elTree.innerHTML = '';
    if (!root.order.length) {
      var empty = document.createElement('div');
      empty.className = 'empty-msg';
      empty.textContent = 'Repo vacio. Crea tu primera nota con +Nuevo.';
      elTree.appendChild(empty);
      return;
    }
    var ul = document.createElement('ul');
    for (var i = 0; i < root.order.length; i++) {
      ul.appendChild(renderNode(root.children[root.order[i]]));
    }
    elTree.appendChild(ul);
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
    nameEl.textContent = node.type === 'blob' ? node.name.replace(/\.md$/i, '') : node.name;

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
      icon.textContent = '📄';
      row.onclick = function () { openNote(node.path); };
    }

    row.appendChild(caret);
    row.appendChild(icon);
    row.appendChild(nameEl);
    li.appendChild(row);

    if (node.type === 'tree' && state.expanded[node.path]) {
      var sub = document.createElement('ul');
      for (var i = 0; i < node.order.length; i++) {
        sub.appendChild(renderNode(node.children[node.order[i]]));
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
      localStorage.setItem(LS_LAST, path);
      expandAncestors(path);
      renderMarkdown(content);
      elEditBtn.disabled = false;
      renderTree();
      // close sidebar overlay on small screens
      if (window.innerWidth <= 720) elSidebar.classList.add('hidden');
    });
  }

  function renderMarkdown(md) {
    var html;
    try { html = window.snarkdown(md || ''); }
    catch (e) { html = '<p>(error renderizando)</p>'; }
    elRender.innerHTML = html;
  }

  // ------------- Edit / save -------------
  function setMode(mode) {
    if (mode === 'edit') {
      state.editing = true;
      elEditor.value = state.openContent;
      elEditor.classList.remove('hidden');
      elRender.classList.add('hidden');
      elEditBtn.classList.add('hidden');
      elSaveBtn.classList.remove('hidden');
      elCancelBtn.classList.remove('hidden');
      elNewBtn.disabled = true;
      setTimeout(function () { elEditor.focus(); }, 30);
    } else {
      state.editing = false;
      elEditor.classList.add('hidden');
      elRender.classList.remove('hidden');
      elEditBtn.classList.remove('hidden');
      elSaveBtn.classList.add('hidden');
      elCancelBtn.classList.add('hidden');
      elNewBtn.disabled = false;
    }
  }

  function saveCurrent() {
    if (!state.openPath) return;
    var newContent = elEditor.value;
    elSaveBtn.disabled = true;
    elCancelBtn.disabled = true;
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
        renderMarkdown(newContent);
        setMode('view');
        toast('Guardado');
        // invalidate tree cache (in case a new file was created or path changed)
        try { localStorage.removeItem(LS_TREE); } catch (e) {}
      });
  }

  function showConflict(localText) {
    elConflictMsg.textContent = '';
    elModalConflict.classList.remove('hidden');
    elConflictDiscard.onclick = function () {
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
      elModalConflict.classList.add('hidden');
      toast('Texto copiado. Recargando version actual.');
      openNote(state.openPath);
    };
  }

  // ------------- New note / folder -------------
  function openNewModal(kind) {
    state.newKind = kind || 'file';
    elNewTabFile.className = state.newKind === 'file' ? 'tab active' : 'tab';
    elNewTabFolder.className = state.newKind === 'folder' ? 'tab active' : 'tab';
    elNewNameLabel.firstChild.nodeValue = state.newKind === 'file' ? 'Nombre (sin .md)' : 'Nombre carpeta';
    elNewParent.value = inferParent();
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

  function createNew() {
    var parent = (elNewParent.value || '').replace(/^\/+|\/+$/g, '');
    var name = (elNewName.value || '').replace(/^\/+|\/+$/g, '');
    if (!name) { setMsg(elNewMsg, 'Falta el nombre'); return; }
    if (/[\\:*?"<>|]/.test(name) || /\/\s|\s\/$/.test(name)) {
      setMsg(elNewMsg, 'Caracteres no permitidos en el nombre'); return;
    }
    if (state.newKind === 'file') {
      if (!/\.md$/i.test(name)) name = name + '.md';
      var fpath = parent ? parent + '/' + name : name;
      setMsg(elNewMsg, 'Creando...');
      apiPutFile(fpath, '# ' + name.replace(/\.md$/i, '') + '\n\n', null,
        'Create ' + fpath, function (err) {
          if (err) { setMsg(elNewMsg, friendlyError(err)); return; }
          elModalNew.classList.add('hidden');
          try { localStorage.removeItem(LS_TREE); } catch (e) {}
          // Update optimista: GitHub's git/trees endpoint puede tardar segundos en
          // reflejar el archivo nuevo. Lo agregamos al estado local para que aparezca
          // ya, y refrescamos del server con delay como safety net.
          state.tree.push({ path: fpath, type: 'blob' });
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
        try { localStorage.removeItem(LS_TREE); } catch (e) {}
        state.tree.push({ path: fpath2, type: 'blob' });
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
    elThemeBtn.onclick = toggleTheme;
    elSettingsBtn.onclick = function () { openSetupModal(); };
    elCfgSave.onclick = saveSetup;
    elCfgCancel.onclick = function () { elModalSetup.classList.add('hidden'); };
    elCfgClear.onclick = function () {
      if (confirm && !confirm('Borrar PAT y config del dispositivo?')) return;
      clearCfg();
      state.cfg = null;
      state.tree = [];
      state.openPath = null;
      state.openSha = null;
      state.openContent = '';
      elTree.innerHTML = '';
      elRender.innerHTML = '';
      elPath.textContent = '';
      elEditBtn.disabled = true;
      elEmpty.classList.remove('hidden');
      elRender.classList.add('hidden');
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
    elNewTabFolder.onclick = function () { openNewModal('folder'); };
    elNewCancel.onclick = function () { elModalNew.classList.add('hidden'); };
    elNewCreate.onclick = createNew;

    elEditBtn.onclick = function () {
      if (!state.openPath) return;
      setMode('edit');
    };
    elCancelBtn.onclick = function () {
      setMode('view');
      renderMarkdown(state.openContent);
    };
    elSaveBtn.onclick = saveCurrent;
  }

  // ------------- Boot -------------
  function boot() {
    loadTheme();
    bind();
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