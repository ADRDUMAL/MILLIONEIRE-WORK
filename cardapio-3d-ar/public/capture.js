// Captura guiada: cada posição usa <input type="file" capture="environment"> (câmera traseira)
// ou a galeria. A foto é redimensionada no aparelho (lado maior 1600 px, JPEG) para poupar
// dados e enviada imediatamente para a posição correspondente.
(function () {
  var root = document.getElementById('captura');
  if (!root || root.dataset.editable !== '1') return;
  var dishId = root.dataset.dish;
  var csrf = root.dataset.csrf;
  var MAX_EDGE = 1600;

  function resize(file) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        try {
          var w = img.naturalWidth, h = img.naturalHeight;
          var scale = Math.min(1, MAX_EDGE / Math.max(w, h));
          var cw = Math.round(w * scale), ch = Math.round(h * scale);
          var canvas = document.createElement('canvas');
          canvas.width = cw; canvas.height = ch;
          canvas.getContext('2d').drawImage(img, 0, 0, cw, ch); // proporção preservada
          canvas.toBlob(function (blob) {
            URL.revokeObjectURL(url);
            resolve(blob && blob.size < file.size ? blob : file);
          }, 'image/jpeg', 0.86);
        } catch (e) { URL.revokeObjectURL(url); resolve(file); }
      };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(file); };
      img.src = url;
    });
  }

  function setStatus(slot, text, isError) {
    var el = slot.querySelector('.slot-status');
    el.textContent = text;
    el.classList.toggle('error', !!isError);
  }
  function showPreview(slot, src) {
    var box = slot.querySelector('.slot-preview');
    box.innerHTML = '';
    var img = document.createElement('img');
    img.src = src; img.alt = slot.dataset.position;
    box.appendChild(img);
  }
  function updateSubmit(complete, hasWidth) {
    var btn = document.getElementById('btn-enviar');
    var hint = document.getElementById('enviar-hint');
    if (!btn) return;
    btn.disabled = !(complete && hasWidth);
    if (hint) hint.textContent = complete ? (hasWidth ? 'Tudo pronto. Toque em "Enviar para revisão".' : 'Informe a largura do prato abaixo e salve antes de enviar.') : 'Faltam fotos obrigatórias.';
  }

  async function upload(slot, file) {
    var pos = slot.dataset.position;
    slot.classList.add('uploading');
    setStatus(slot, 'Preparando…');
    var blob = await resize(file);
    showPreview(slot, URL.createObjectURL(blob));
    setStatus(slot, 'Enviando…');
    var fd = new FormData();
    fd.append('_csrf', csrf);
    fd.append('position', pos);
    fd.append('photo', blob, pos + '.jpg');
    try {
      var res = await fetch('/app/pratos/' + dishId + '/foto', { method: 'POST', body: fd, headers: { 'X-CSRF-Token': csrf }, credentials: 'same-origin' });
      var data = null;
      try { data = await res.json(); } catch (e) { /* sem json */ }
      if (!res.ok || !data || !data.ok) throw new Error((data && data.error) || ('Erro ' + res.status));
      slot.dataset.has = '1';
      setStatus(slot, 'Salva ✓');
      var rm = slot.querySelector('[data-role=remove]'); if (rm) rm.hidden = false;
      updateSubmit(data.complete, data.hasWidth);
    } catch (e) {
      setStatus(slot, 'Falhou: ' + e.message + ' — tente de novo', true);
    } finally {
      slot.classList.remove('uploading');
    }
  }

  async function remove(slot) {
    var pos = slot.dataset.position;
    if (!confirm('Remover a foto "' + pos + '"?')) return;
    try {
      var res = await fetch('/app/pratos/' + dishId + '/foto/' + pos + '/excluir', { method: 'POST', headers: { 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' }, body: '{}', credentials: 'same-origin' });
      if (!res.ok) throw new Error('Erro ' + res.status);
      slot.dataset.has = '0';
      slot.querySelector('.slot-preview').innerHTML = '<div class="placeholder">Tire a foto novamente.</div>';
      setStatus(slot, pos === 'top' ? 'opcional' : 'pendente');
      slot.querySelector('[data-role=remove]').hidden = true;
      updateSubmit(false, true);
    } catch (e) { setStatus(slot, 'Não foi possível remover', true); }
  }

  root.querySelectorAll('.slot').forEach(function (slot) {
    slot.querySelectorAll('input[type=file]').forEach(function (input) {
      input.addEventListener('change', function () {
        var file = input.files && input.files[0];
        input.value = '';
        if (!file) return;
        if (file.size > 40 * 1024 * 1024) { setStatus(slot, 'Arquivo muito grande', true); return; }
        upload(slot, file);
      });
    });
    var rm = slot.querySelector('[data-role=remove]');
    if (rm) rm.addEventListener('click', function () { remove(slot); });
  });
})();
