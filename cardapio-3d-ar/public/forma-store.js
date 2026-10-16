// Persistência local do preview (Fase 3A). Não há backend para o preview: o painel real do
// restaurante (/app, /admin) usa SQLite com autenticação, e o preview roda sem login.
//
//   metadados  -> localStorage  (pequenos: nome, categoria, tags, status, miniatura)
//   arquivos   -> IndexedDB     (fotos, vídeo e GLB; apagados no início de cada nova sessão)
//
// Arquivos pesados nunca vão para o localStorage. Ao abrir o navegador de novo, os blobs são
// descartados e o produto fica marcado com `hasFiles: false` — a interface pede o reenvio.
window.FormaStore = (function () {
  'use strict';
  var PKEY = 'forma3d.products.v1';
  var SKEY = 'forma3d.session.v1';
  var DB_NAME = 'forma3d-files';
  var STORE = 'blobs';

  // ---------- Estados do produto (texto + ícone + cor; nunca só cor) ----------
  var STATES = {
    draft: { label: 'Rascunho', tone: 'neutral', icon: 'pencil' },
    files_added: { label: 'Arquivos adicionados', tone: 'neutral', icon: 'file' },
    uploading: { label: 'Enviando', tone: 'blue', icon: 'upload' },
    processing: { label: 'Processando', tone: 'warning', icon: 'spinner' },
    review: { label: 'Revisão necessária', tone: 'warning', icon: 'eye' },
    ready: { label: 'Pronto para publicar', tone: 'blue', icon: 'sparkle' },
    published: { label: 'Publicado', tone: 'success', icon: 'check' },
    error: { label: 'Erro', tone: 'danger', icon: 'alert' },
  };
  var ICON_PATHS = {
    pencil: '<path d="m4 20 4-1L20 7l-3-3L5 16zM14 6l3 3"/>',
    file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
    upload: '<path d="M12 16V4M6 10l6-6 6 6M4 20h16"/>',
    spinner: '<path d="M12 3a9 9 0 1 0 9 9"/>',
    eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    alert: '<path d="M12 3 2 20h20zM12 10v4M12 17h.01"/>',
    cube: '<path d="m12 2 8 4.5v9L12 20l-8-4.5v-9z"/><path d="m4 6.5 8 4.5 8-4.5M12 11v9"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    left: '<path d="M15 6l-6 6 6 6"/>',
    right: '<path d="m9 6 6 6-6 6"/>',
    photo: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="m21 16-5-5-8 8"/>',
    video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3z"/>',
    reset: '<path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5"/>',
    camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h10"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  };
  function icon(name, size) {
    return '<svg class="ic" width="' + (size || 20) + '" height="' + (size || 20) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICON_PATHS[name] || '') + '</svg>';
  }
  function statusPill(key) {
    var s = STATES[key] || STATES.draft;
    return '<span class="pill pill-' + s.tone + '">' + icon(s.icon, 14) + '<span>' + s.label + '</span></span>';
  }

  // ---------- localStorage: metadados ----------
  function readAll() {
    try { var v = JSON.parse(localStorage.getItem(PKEY) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
  }
  function writeAll(list) {
    try { localStorage.setItem(PKEY, JSON.stringify(list)); return true; }
    catch (e) {
      // Cota estourada: descarta miniaturas (o que mais ocupa espaço) e tenta de novo.
      try { localStorage.setItem(PKEY, JSON.stringify(list.map(function (p) { var c = Object.assign({}, p); delete c.thumb; return c; }))); return true; }
      catch (e2) { return false; }
    }
  }
  function list() { return readAll().sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); }); }
  function get(id) { return readAll().filter(function (p) { return p.id === id || p.slug === id; })[0] || null; }
  function save(product) {
    var all = readAll();
    var i = all.findIndex(function (p) { return p.id === product.id; });
    product.updatedAt = Date.now();
    if (i >= 0) all[i] = product; else all.push(product);
    writeAll(all);
    return product;
  }
  function patch(id, fields) {
    var p = get(id); if (!p) return null;
    Object.keys(fields).forEach(function (k) { p[k] = fields[k]; });
    return save(p);
  }
  function remove(id) {
    var p = get(id);
    writeAll(readAll().filter(function (x) { return x.id !== (p ? p.id : id); }));
    if (p) { deleteBlobs(p.id); if (window.FormaReconstruction && p.jobId) window.FormaReconstruction.dropJob(p.jobId); }
  }
  function create(fields) {
    var id = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    var p = Object.assign({
      id: id, slug: 'local-' + id, name: 'Produto sem nome', category: '', description: '', brand: '',
      tags: [], dimensions: {}, method: 'photos', status: 'draft', jobId: null, thumb: '',
      files: { count: 0, names: [], bytes: 0 }, model: null, hasFiles: false,
      createdAt: Date.now(), updatedAt: Date.now(), publishedAt: null,
    }, fields || {});
    return save(p);
  }

  // ---------- IndexedDB: blobs da sessão ----------
  var dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise(function (resolve, reject) {
      if (!window.indexedDB) return reject(new Error('IndexedDB indisponível'));
      var rq = indexedDB.open(DB_NAME, 1);
      rq.onupgradeneeded = function () { if (!rq.result.objectStoreNames.contains(STORE)) rq.result.createObjectStore(STORE); };
      rq.onsuccess = function () { resolve(rq.result); };
      rq.onerror = function () { reject(rq.error); };
    });
    return dbp;
  }
  function withStore(mode, fn) {
    return db().then(function (d) {
      return new Promise(function (resolve, reject) {
        var t = d.transaction(STORE, mode), rq = fn(t.objectStore(STORE));
        t.oncomplete = function () { resolve(rq && 'result' in rq ? rq.result : undefined); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error); };
      });
    });
  }
  var blobKey = function (productId, role, i) { return productId + ':' + role + ':' + (i == null ? 0 : i); };
  function putBlob(key, blob) { return ready.then(function () { return withStore('readwrite', function (s) { return s.put(blob, key); }); }); }
  function getBlob(key) { return ready.then(function () { return withStore('readonly', function (s) { return s.get(key); }); }); }
  function listKeys() { return ready.then(function () { return withStore('readonly', function (s) { return s.getAllKeys(); }); }); }
  function deleteBlobs(productId) {
    return listKeys().then(function (keys) {
      return Promise.all((keys || []).filter(function (k) { return String(k).indexOf(productId + ':') === 0; })
        .map(function (k) { return withStore('readwrite', function (s) { return s.delete(k); }); }));
    }).catch(function () {});
  }
  function clearBlobs() { return withStore('readwrite', function (s) { return s.clear(); }).catch(function () {}); }

  // Nova sessão do navegador: descarta os blobs e marca os produtos como "precisa reenviar".
  var ready = (function () {
    var fresh = false;
    try { if (!sessionStorage.getItem(SKEY)) { sessionStorage.setItem(SKEY, Date.now().toString(36)); fresh = true; } } catch (e) {}
    if (!fresh) return Promise.resolve();
    var all = readAll();
    if (all.length) writeAll(all.map(function (p) { p.hasFiles = false; return p; }));
    return clearBlobs();
  })();

  // ---------- Object URLs (revogadas ao sair da página) ----------
  var urls = [];
  function objectUrl(blob) { var u = URL.createObjectURL(blob); urls.push(u); return u; }
  function revoke(url) { var i = urls.indexOf(url); if (i >= 0) urls.splice(i, 1); try { URL.revokeObjectURL(url); } catch (e) {} }
  function revokeAll() { urls.splice(0).forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) {} }); }
  window.addEventListener('pagehide', revokeAll);

  // ---------- Miniatura (JPEG reduzido, cabe no localStorage) ----------
  function thumbFromImage(source, opts) {
    opts = opts || {};
    var max = opts.max || 320;
    return new Promise(function (resolve) {
      try {
        var w = source.naturalWidth || source.videoWidth || source.width;
        var h = source.naturalHeight || source.videoHeight || source.height;
        if (!w || !h) return resolve('');
        var scale = Math.min(1, max / Math.max(w, h));
        var c = document.createElement('canvas');
        c.width = Math.round(w * scale); c.height = Math.round(h * scale);
        var g = c.getContext('2d');
        // Fundo claro: modelos 3D vêm com fundo transparente, que viraria preto no JPEG.
        g.fillStyle = opts.bg || '#F4F1E8'; g.fillRect(0, 0, c.width, c.height);
        g.drawImage(source, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.7));
      } catch (e) { resolve(''); }
    });
  }

  // ---------- Preferências do estúdio (Estúdio → Conta, Marca, Preferências 3D) ----------
  // Vivem neste navegador, como os produtos do preview. Quem lê: assistente (qualidade e máscara),
  // página pública (cor do viewer, assinatura) e o próprio Estúdio.
  var PREF_KEY = 'forma3d.studio.v1';
  var PREF_DEFAULTS = { studioName: '', owner: '', logo: '', viewerBg: '#F3F2EF', signature: true, quality: 'high', isMask: 1 };
  function prefs() {
    var saved = {};
    try { saved = JSON.parse(localStorage.getItem(PREF_KEY) || '{}') || {}; } catch (e) { saved = {}; }
    return Object.assign({}, PREF_DEFAULTS, saved);
  }
  function setPrefs(patchObj) {
    var next = Object.assign(prefs(), patchObj || {});
    try { localStorage.setItem(PREF_KEY, JSON.stringify(next)); } catch (e) { return null; }
    return next;
  }

  return {
    prefs: prefs, setPrefs: setPrefs, PREF_DEFAULTS: PREF_DEFAULTS,
    STATES: STATES, icon: icon, statusPill: statusPill,
    list: list, get: get, save: save, patch: patch, remove: remove, create: create,
    blobKey: blobKey, putBlob: putBlob, getBlob: getBlob, deleteBlobs: deleteBlobs,
    objectUrl: objectUrl, revoke: revoke, revokeAll: revokeAll,
    thumbFromImage: thumbFromImage, ready: ready,
  };
})();
