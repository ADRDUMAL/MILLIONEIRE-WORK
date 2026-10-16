// Página do prato: registra visualização 3D e entrada em AR; mostra aviso quando AR não existe.
(function () {
  var mv = document.getElementById('mv');
  var main = document.querySelector('.dish-page');
  if (!mv || !main) return;
  var sent = {};
  function track(kind) {
    if (sent[kind]) return; sent[kind] = true;
    var body = JSON.stringify({ kind: kind, restaurant: Number(main.dataset.restaurant), dish: Number(main.dataset.dish) });
    if (navigator.sendBeacon) navigator.sendBeacon('/api/track', new Blob([body], { type: 'application/json' }));
    else fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true });
  }
  mv.addEventListener('load', function () {
    track('model_view');
    // canActivateAR só é confiável após o carregamento; sem AR, mostramos o aviso e mantemos o 3D.
    var hint = document.getElementById('ar-hint');
    if (hint && !mv.canActivateAR) hint.hidden = false;
  });
  mv.addEventListener('ar-status', function (ev) {
    if (ev.detail && ev.detail.status === 'session-started') track('ar_view');
    if (ev.detail && ev.detail.status === 'failed') { var h = document.getElementById('ar-hint'); if (h) { h.hidden = false; h.textContent = 'Não foi possível abrir a realidade aumentada neste aparelho. O 3D continua disponível acima.'; } }
  });
})();
