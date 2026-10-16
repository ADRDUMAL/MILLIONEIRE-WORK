# Cardápio 3D/AR — beta

SaaS privado por convite: o restaurante cadastra pratos e fotografa no celular; dois administradores revisam, geram/aprovam o 3D e publicam. O cliente abre o QR, vê o cardápio com foto, gira o prato em 3D e, se o aparelho suportar, vê em realidade aumentada.

**Stack (uma só, sem serviços pagos):** Node 24 + Express + SQLite embutido do Node (`node:sqlite`) + disco local. Um processo, quatro dependências (`express`, `multer`, `qrcode`, `@google/model-viewer` servido localmente). Roda em qualquer VPS/container com um volume.

## Rodar

```bash
npm install
cp .env.example .env          # opcional em desenvolvimento
npm run seed:demo             # admin + 2 restaurantes de teste (senhas de demonstração)
npm start                     # http://localhost:3000 e http://<ip-da-máquina>:3000
```

Admin próprio: `npm run seed:admin -- email senha`. Testes: `npm test`.

Contas do `seed:demo` (troque antes de uso real): `admin@demo.local / admin12345`, `dono-a@demo.local / demo12345` (Cantina da Ana), `dono-b@demo.local / demo12345` (Bistrô do Bento).

## Preview Forma 3D (Fase 1 — desktop, dados de demonstração)

Preview visual da plataforma B2B genérica (nome provisório), convivendo com o beta de restaurantes. Sem login, sem persistência: estados de upload, processamento e publicação são simulados no navegador e marcados como "Simulação no preview".

- `/` — landing (visitante anônimo; usuário logado continua indo para `/app` ou `/admin`).
- `/studio` — dashboard · `/studio/produtos` · `/studio/produtos/novo` · `/studio/produtos/:slug/processando` · `/studio/produtos/:slug` (editor 3D) · `/studio/publicacoes`.
- `/p/:slug` — página pública (`caneca-origens`, `cadeira-horizonte`, `tenis-fluxo`).

Fase 3A (fluxo funcional local): `/studio/produtos/novo` é um assistente de 3 etapas (dados → arquivos → revisão) com três métodos de criação: fotos, vídeo 360° e **modelo 3D pronto**. O caminho do GLB/glTF funciona de verdade (validação por assinatura binária, abertura no `<model-viewer>`, publicação local); fotos e vídeo passam por um provider de reconstrução **simulado** (`public/forma-reconstruction.js`) que entrega um GLB de demonstração. Metadados ficam em `localStorage` e os arquivos em IndexedDB apagado a cada nova sessão do navegador — a interface avisa quando um arquivo precisa ser reenviado. Nada disso toca o backend SQLite do beta de restaurantes.

### Fase 3B — reconstrução real (KIRI Engine) server-side

Desligada por padrão; sem variáveis o preview segue em simulação. Para ligar, no `.env`:

```
FORMA_REAL_PROCESSING_ENABLED=1
FORMA_RECONSTRUCTION_PROVIDER=kiri
KIRI_API_KEY=...          # só o servidor lê; nunca vai ao navegador, a logs ou a respostas
FORMA_MAX_REAL_JOBS=1     # teto de tarefas reais neste ambiente (custo)
```

Fluxo: fotos (20–300) ou vídeo (MP4/MOV, ≤3 min, ≤1920×1080) → `POST /api/forma/reconstruction/jobs` → validação no servidor → envio ao KIRI (Photo Scan: GLB, Medium, 2K, máscara ligada, sem suavização) → polling server-side com backoff → download do ZIP → extração segura do GLB (`src/forma/zip.js`) → validação glTF 2.0 → `data/forma/models/<job>.glb` → `GET /api/forma/reconstruction/jobs/:id/model` → visualizador. Estados do KIRI (-1/3/0/1/2/4) viram enviando/na fila/processando/erro/pronto/expirado; sem percentual inventado. Tabelas isoladas `forma_reconstruction_jobs` e `forma_reconstruction_assets` (migração 002). Em `NODE_ENV=production` exige ainda `FORMA_ALLOW_REAL_IN_PRODUCTION=1` e sessão de administrador.

- Testes (`npm test`) usam um KIRI falso em processo e nunca consomem créditos.
- Interface em modo real sem créditos: `node scripts/fake-kiri-server.js` e `KIRI_BASE_URL=http://127.0.0.1:4747 KIRI_API_KEY=fake ...`.
- Teste real por terminal (1 crédito, pede `SIM`): `KIRI_LIVE_TEST=true npm run kiri:live -- ./pasta-com-fotos`; o resultado abre em `/studio/tarefas/<jobId>`.

### Fase 4 — captura guiada pela câmera (vídeo direto do celular)

Em `/studio/produtos/novo`, o método **Escanear com a câmera** abre a câmera traseira em tela cheia (`getUserMedia`), grava com `MediaRecorder` no formato que o navegador realmente suporta (MP4/H.264 quando disponível — Chrome, Edge e Safari atuais; senão WebM) e devolve o vídeo para o **mesmo fluxo** do método "Enviar vídeo 360°" (validação local → IndexedDB → `POST /api/forma/reconstruction/jobs` com `method=video`). Módulo: `public/forma-capture.js` (`window.FormaCapture`); integração em `public/forma-new-product.js`; estilos no bloco "Fase 4" de `public/forma.css`.

- Interface guiada: contorno de enquadramento, anel de progresso, etapas **Frente → Lateral → Traseira → Ângulo superior** (15 s cada), instrução "Mova-se lentamente ao redor do produto", avisos de **movimento rápido** e **pouca luz** (amostra reduzida do quadro; desligam-se sozinhos quando o navegador não dá acesso aos pixels). A progressão é **por tempo** e a tela diz isso: é orientação de ritmo, não detecção de cobertura.
- Limites: câmera pedida a no máximo 1920×1080 (e reduzida se o aparelho entregar mais), 3 minutos (parada automática), tamanho máximo do servidor; recomendação de 45–90 s nas notas de revisão.
- Cancelar (X ou Esc), Regravar (sem pedir a câmera de novo) e revisar (player, duração, tamanho, resolução, formato) antes de "Usar este vídeo"; no assistente ainda dá para Regravar, Baixar ou Remover.
- **Nada é enviado sem confirmação**: em modo real, "Criar produto" abre um diálogo com a quantidade/tamanho dos arquivos e o custo antes de qualquer envio (vale para fotos, vídeo e câmera).
- Navegador que só grava WebM (Firefox): a gravação e a revisão funcionam; o envio ao KIRI fica bloqueado com aviso e botão de download, e os métodos de fotos, vídeo e GLB continuam disponíveis.
- **HTTPS obrigatório no celular**: `getUserMedia` só existe em contexto seguro. Em `http://<ip>:3000` o painel explica isso e desativa o botão. Veja "Captura pela câmera no celular" abaixo.
- Sem créditos nos testes: `npm test` (fixture real de MP4 do MediaRecorder em `test/fixtures/`) e `npm run dev:safe` (KIRI falso em processo, `DATA_DIR=data/dev-safe`, porta 3001) nunca chamam o serviço real.

Responsivo (Fase 2): sidebar vira drawer e o editor usa bottom sheet abaixo de 1100px; grade 3 → 2 → 1 colunas. No celular da mesma rede Wi-Fi, abra `http://<ip-da-máquina>:3000/studio` (o `npm start` imprime o IP).

Código: `src/routes/preview.js`, `src/preview/{data,ui}.js`, `public/forma.{css,js}`, `public/forma-{store,reconstruction,new-product,capture}.js`. Modelos placeholder em `samples/demo/*.glb` (regerar com `node scripts/make-demo-glbs.js`). Spec: `FORMA3D_PRODUCT_DESIGN_SPEC.md`.

## Teste no celular (2 minutos)

Sem HTTPS a captura do beta de restaurantes já funciona: `<input type="file" capture="environment">` abre a câmera traseira em HTTP. Só a câmera ao vivo (`getUserMedia`) exige HTTPS — é o caso da captura guiada da Forma 3D (Fase 4); veja "Captura pela câmera no celular" abaixo.

1. Computador e celular na **mesma rede Wi-Fi**. `npm start` mostra `na rede local (celular): http://192.168.x.x:3000` — abra esse endereço no celular (ou gere um QR: `npm run qr -- http://192.168.x.x:3000/entrar`). `localhost` do computador **não** funciona no telefone.
2. Entre como `dono-a@demo.local / demo12345`, toque em **Feijoada completa** → **Tirar foto** em *Frente*. A câmera abre; a foto aparece no quadro com "Salva ✓".
3. Repita para Esquerda, Trás e Direita (Galeria também funciona). Toque **Enviar para revisão**.
4. No computador, entre como `admin@demo.local` em `/admin`: o prato está na fila com as 4 fotos.
5. Sem chave Tripo: em **Enviar modelo manual** anexe `samples/prato-exemplo.glb` (gerado por `node scripts/make-sample-glb.js`), confira a prévia, informe a largura real e **Calibrar e publicar**.
6. No celular, abra `/m/cantina-da-ana` → o prato mostra **3D**; toque nele, gire, e **Ver na minha mesa** (Android/Chrome: Scene Viewer; iPhone/Safari: Quick Look com USDZ gerado pelo visualizador, ou USDZ próprio se enviado).

Se o celular não abrir a página: verifique se o Windows permitiu o Node na rede privada (o Windows pergunta na primeira execução).

### Captura pela câmera no celular (HTTPS na rede Wi-Fi)

A captura guiada usa `getUserMedia`, que o navegador só libera em páginas seguras (`https://` ou `localhost`). Passo a passo sem túnel e sem créditos:

1. `npm run cert` — gera `data/certs/dev-{key,cert}.pem` (autoassinado, 90 dias, válido para localhost e para os IPs desta máquina; usa o `openssl` do Git para Windows). Com o [mkcert](https://github.com/FiloSottile/mkcert) instalado, `mkcert -install` + `mkcert -key-file data/certs/dev-key.pem -cert-file data/certs/dev-cert.pem localhost 127.0.0.1 <ip>` evita o aviso no celular.
2. `npm run dev:safe` — sobe em **https://\<ip\>:3001** com o KIRI falso (nenhum crédito). O terminal imprime os IPs.
3. No celular, na mesma rede Wi-Fi, abra `https://<ip>:3001/studio/produtos/novo`, aceite o aviso do certificado (Chrome: *Avançado → Prosseguir*; Safari: *Mostrar detalhes → visitar o site*), preencha os dados e escolha **Escanear com a câmera** → **Abrir câmera** → permita a câmera.
4. Grave (45–90 s), revise, **Usar este vídeo**, **Continuar** e **Criar produto**: o diálogo de confirmação aparece e o envio vai para o KIRI falso; o modelo de demonstração aparece em ~20 s.
5. Para o serviço real: `npm run start:https` (porta 3000, chave e limites do `.env`; `FORMA_MAX_REAL_JOBS` continua valendo). O envio só acontece depois de confirmar no diálogo.

Alternativa sem certificado: um túnel HTTPS (abaixo) apontando para a porta 3001 (`dev:safe`) ou 3000. Se o Windows perguntar, permita o Node na rede privada.

### Preview HTTPS (para AR em alguns aparelhos e para testar fora da rede)

Sem conta de deploy configurada aqui. Opções rápidas, sem custo, mantendo o servidor local:
- `npx localtunnel --port 3000` → URL `https://xxx.loca.lt` (mostra uma página de aviso na primeira abertura).
- Cloudflare Tunnel (`cloudflared tunnel --url http://localhost:3000`) → URL `https://xxx.trycloudflare.com`.

Defina `BASE_URL=https://...` no `.env` quando tiver a URL definitiva: é ela que vai para o QR permanente.

## Fluxo

Restaurante (`/app`): dados da casa, categorias, pratos (nome, categoria, descrição curta, preço, pessoas, largura real em cm, altura opcional), captura guiada (frente/esquerda/trás/direita + capa opcional; foto redimensionada no aparelho para 1600 px), **Enviar para revisão**, esgotado/oculto sem trocar QR, QR/link permanente, métricas.

Admin (`/admin`): convidar/restaurar acesso (link de uso único, 7 dias), plano, limite de pratos 3D, tentativas incluídas, situação da assinatura (manual no beta; `billing_customer_ref` reservado para cobrança futura). Fila com filtros por status/restaurante. Por prato: fotos, dimensões, **Pedir novas fotos** (com motivo), **Aprovar**, **Gerar 3D agora** (só com `TRIPO_API_KEY`, confirmação de custo; nunca automático), **Enviar modelo manual** (GLB, USDZ opcional), prévia 3D, **Calibrar e publicar** (reescala o GLB pela largura real), **Rejeitar modelo** (motivo + próximo estado), **Despublicar**. Registro por tentativa: fornecedor, status, créditos reais/estimados, minutos de revisão, motivo de rejeição.

Estados: rascunho → aguardando revisão → (pedir novas fotos | aprovado para geração → gerando → modelo em revisão → publicado) | rejeitado | falha.

Consumidor (`/m/<slug>`): lista por categoria com foto, preço, pessoas e esgotado; `/m/<slug>/p/<id>` com `<model-viewer>` (GLB; `ios-src` quando há USDZ), botão **Ver na minha mesa**, aviso quando AR não existe, frase de visualização ilustrativa. Contagem agregada por dia (abertura, prato, 3D, AR) sem dados pessoais.

## Gerador 3D (Tripo, API v3)

Com `TRIPO_API_KEY` no `.env`: o admin aciona a geração multivisão (`POST /v3/files` × 4, `POST /v3/generation/multiview-to-model` com `{front|left|back|right: {file_token}}`, polling em `GET /v3/tasks/{id}` a cada `TRIPO_POLL_SECONDS`), o GLB é baixado para a área privada e vai para **Modelo em revisão**. Preço oficial: 30 créditos por multivisão com textura, 1 crédito = US$ 0,01 (≈ US$ 0,30); o valor real (`credits_consumed`) fica gravado na tentativa. Sem chave, o painel mostra "Gerador não configurado" e o caminho manual continua completo.

## Segurança e dados

- Senhas com scrypt; sessão em cookie `HttpOnly SameSite=Lax` (`Secure` em produção); CSRF por token de sessão + checagem de Origin; limite de tentativas de login/convite.
- Toda leitura/escrita privada filtra por `restaurant_id` no servidor (prato de outro restaurante → 404). Testado em `test/flow.test.js`.
- Uploads validados por assinatura binária (JPEG/PNG/WebP, GLB glTF 2.0, USDZ), limites 8 MB (foto) / 40 MB (modelo); GLB com buffers/texturas externos é recusado; a reescala só edita o JSON do glTF.
- Fotos originais e modelos candidatos ficam em `data/private/` (servidos só a dono/admin). Publicados vão para `data/public/` com nomes aleatórios. Chaves só no servidor.
- Backup: `npm run backup` (SQLite consistente + arquivos em `backups/`). Exportação por restaurante: `/admin/restaurantes/:id/export.json`.

## Deploy (HTTPS)

Qualquer host com processo Node persistente e volume: `Dockerfile` incluído (`DATA_DIR=/data`). Coloque atrás de um proxy com TLS (Caddy/Nginx/Fly/Railway) e defina `NODE_ENV=production` e `BASE_URL=https://seu-dominio`. Vercel/serverless **não** serve (sem disco persistente para SQLite/arquivos).

Custo mensal estimado (fora Tripo): hospedagem de 1 container pequeno com volume ≈ US$ 3–7 (Hetzner CX22 ≈ €4, Fly.io shared-cpu + volume ≈ US$ 3–5, Railway ≈ US$ 5) + domínio ≈ US$ 1. A mesma máquina atende 10 ou 100 restaurantes no beta (SQLite + arquivos estáticos); o que escala com o volume é a API 3D: ~US$ 0,30 por tentativa, logo 10 restaurantes × 5 pratos × 1,5 tentativas ≈ US$ 22 no início; 100 restaurantes ≈ US$ 225 (uma vez, por prato), mais minutos de revisão dos sócios — o painel registra isso para descobrir o custo real. Disco: ~1,5 MB por prato em fotos + 3–15 MB por modelo.

## Variáveis (`.env.example`)

`PORT`, `HOST`, `BASE_URL`, `NODE_ENV`/`COOKIE_SECURE`, `DATA_DIR`, `TRIPO_API_KEY`, `TRIPO_MODEL`, `TRIPO_EST_COST_USD`, `TRIPO_POLL_SECONDS`, `TRIPO_FACE_LIMIT`, `ADMIN_EMAIL`/`ADMIN_PASSWORD`, `FORMA_*`/`KIRI_*` (Fase 3B), `HTTPS_KEY_FILE`/`HTTPS_CERT_FILE` (HTTPS local, Fase 4).

## Limitações conhecidas

- Sem HTTPS público configurado aqui; AR no iPhone/Android funciona melhor em HTTPS e a captura guiada pela câmera **exige** HTTPS (o 3D e o upload de arquivos funcionam em HTTP na rede local).
- Captura guiada: a progressão das etapas é por tempo, não por detecção de cobertura; os avisos de movimento/luz são heurísticas simples. Navegadores que só gravam WebM (Firefox) não podem enviar a gravação ao KIRI (MP4/MOV) — baixe e converta, ou use fotos/vídeo.
- USDZ: sem arquivo próprio, o `<model-viewer>` gera um USDZ no iPhone a partir do GLB (qualidade pode variar); USDZ enviado manualmente não é reescalado — envie já na escala real.
- Sem e-mail: o link de convite é copiado do painel e enviado por WhatsApp/e-mail manualmente.
- Cobrança manual; sem processador de pagamento.
- Um restaurante por usuário no beta (o esquema já permite vários).
