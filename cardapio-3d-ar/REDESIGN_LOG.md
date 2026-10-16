# REDESIGN LOG — Forma 3D

Execução do `FORMA3D_UI_UX_REDESIGN_V2.md`, **Sprint A (Design Foundation)** e **Sprint B (Dashboard)**.
Data: 22/09/2026.

> A **Sprint A.5 (Brand integration + motion polish)** está no fim deste arquivo, depois da Sprint B.

Escopo respeitado: nada foi tocado no scanner (`public/forma-scanner.js`, `public/scanner/`, `public/forma-capture.js`),
no backend (`src/app.js`, `src/db.js`, `src/routes/admin.js`, `src/routes/restaurant.js`, `src/auth.js`),
no provider 3D (`src/forma/`, `src/lib/generators/`) nem na landing (`r.get('/')` em `src/routes/preview.js`).
A landing só herdou a paleta nova pelos tokens — a estrutura dela continua igual, como manda a Sprint F.

---

## 1. Auditoria: o que já existia e foi reaproveitado

O projeto **já tinha** uma fundação de design coerente. Nada foi reescrito; tudo abaixo foi mantido e evoluído.

| Componente existente | Onde | Decisão |
| --- | --- | --- |
| Tokens de cor, raio, sombra e motion | `public/forma.css` (`:root`) | **Reaproveitado.** Os nomes `--color-*`/`--r-*` viraram apelidos dos tokens `--f3d-*`/`--radius-*` da especificação. Nenhuma regra antiga precisou ser reescrita. |
| `.btn` + variantes (primary/secondary/tech/ghost/lg/sm) | `public/forma.css` | **Reaproveitado**, só ajustes de peso, raio e estado `:active`. |
| `.pill` de status (ícone + texto + cor) | `forma.css` + `statusPill()` em `src/preview/ui.js` | **Reaproveitado.** Já atendia §18 (estado nunca só por cor); só o contraste foi recalibrado. |
| `.field`, `.tags`, `.copy-row`, `.swatch` | `public/forma.css` | **Reaproveitado sem mudança estrutural.** |
| `.card`, `.empty`, `.toast`, `.simnote` | `public/forma.css` | **Reaproveitado.** |
| `.mcard` (item de lista) | `public/forma.css` | **Reaproveitado** e exposto como componente `listItem()` para a Sprint C usar no passo "Método". |
| `shell()` — sidebar + topbar + drawer | `src/preview/ui.js` | **Reaproveitado.** Só ganhou a navegação inferior. |
| Ícones SVG inline e ilustrações `illo()` | `src/preview/ui.js` | **Reaproveitado integralmente.** |
| `FormaStore` (produtos locais em localStorage/IndexedDB) | `public/forma-store.js` | **Reaproveitado.** A home passou a ler dele. |
| `productCard()` / `.pgrid` | `ui.js` + `forma.css` | **Mantido intacto** — continua servindo `/studio/produtos`, que é escopo da Sprint C/§9. |

**Skills locais verificadas** (§20): existem `ui-ux-pro-max` (+ `design-system`, `ui-styling`, `brand`), o plugin `design:*`
(`design-critique`, `accessibility-review`, `design-handoff`, `design-system`), `frontend-design` e `dataviz`.
Nenhuma foi carregada: a especificação v2 já fixa tokens, escala tipográfica, tempos de motion e critérios de
acessibilidade, então carregá-las gastaria crédito sem alterar a decisão de design. Nenhuma dependência foi instalada.

---

## 2. Sprint A — Design Foundation

### Tokens (`public/forma.css`)
Os tokens da §4 entraram como fonte única de verdade, e os nomes antigos viraram apelidos apontando para eles:

| Token | Valor | Substitui |
| --- | --- | --- |
| `--f3d-graphite` | `#111111` | `--color-ink` (era `#18211D`) |
| `--f3d-mist` | `#F3F2EF` | `--color-canvas` (era `#F4F1E8`) |
| `--f3d-surface` | `#FFFEFA` | `--color-surface` (era `#FFFDF8`) |
| `--f3d-lime` / `--f3d-lime-strong` | `#B8F36B` / `#A7EF35` | `--color-lime-500` / `--color-lime-650` |
| `--f3d-slate` | `#6D6D72` | `--color-muted` |
| `--f3d-forest` / `--f3d-forest-soft` | `#0B352B` / `#17483C` | `--color-forest-950` / `--color-forest-800` |
| `--f3d-positive` / `--f3d-warning` / `--f3d-negative` | `#087443` / `#9A6500` / `#A93636` | success / warning / danger |
| `--f3d-border` / `--f3d-border-strong` | `rgba(17,17,17,.12)` / `.20` | `--color-line` |
| `--radius-sm/md/lg/xl/pill` | `12 / 18 / 28 / 40 / 999` | `--r-sm/btn/card/card-lg/panel/pill` |

- O azul `#315CFF` **não é cor de marca** e ficou com dois papéis declarados no CSS: sinal de tecnologia (CTA de AR) e anel de foco de teclado.
- O mesmo `#B8F36B`/`#0B352B` foi aplicado ao wordmark SVG em `ui.js`, que tinha os hex antigos cravados.

### Tipografia (§5)
- `body` passou de `500` para `400` e ganhou `font-feature-settings: "calt" 1, "ss01" 1`.
- Escala normalizada para **400 / 500 / 600 / 700**. Os 25 usos de `font-weight: 800` e os 7 de `650`/`750`
  foram convertidos — nenhum peso acima de 700 sobrou na interface.

### Componentes
- **Botão**: pressionado agora encolhe (`scale(.98)`, §14) em vez de deslocar; peso 600; borda secundária no token `border-strong`.
- **Status**: contrastes recalibrados para AA sobre os fundos das pílulas (o amarelo `#9A6500` sobre `#FAEFD8` dava 4,3:1 e virou `#7A5000`, 6,2:1).
- **Card**: hover com elevação + 2px (§14), borda no token forte.
- **Link de texto**: altura mínima de 24px (WCAG 2.5.8).
- **Topbar**: fundo sólido — o `backdrop-filter: blur(12px)` saiu, porque §15 pede nada de glassmorphism.
- **Sidebar**: o item ativo entra com o fundo deslizando da esquerda (`::before` com `scaleX`), em vez de aparecer de uma vez.

### Navegação responsiva (§6, §19)
- **Celular (≤767px)**: barra inferior fixa com quatro destinos — **Início / Produtos / Criar / Mais**.
  "Criar" carrega o lime e é a ação principal; "Mais" reabre a mesma gaveta de navegação, então nada ficou inacessível.
  O hambúrguer do header some nessa faixa (era controle repetido) e o CTA "Novo produto" sai do topbar em Início e Produtos.
- **Tablet (768–1099px)**: segue com header compacto + gaveta, como já era.
- **Desktop**: sidebar de 248px intacta.
- `public/forma.js`: o drawer passou a aceitar **vários** gatilhos (`[data-drawer-open]`) e devolve o foco ao gatilho que o abriu.

---

## 3. Sprint B — Dashboard (`/studio`)

### Antes
Três cartões grandes de produto ocupando toda a dobra, uma lista de atividade genérica e um card escuro de
"dica de captura". A tela não respondia "como está minha operação?".

### Depois
Ordem nova: **métricas → retomada → produtos recentes → atividade**.

1. **Header**: `Olá, Mariana` / `Aqui está o que mudou nos seus produtos.` + CTA `Novo produto`.
2. **Quatro métricas compactas** (`.metrics`): Produtos · Publicados · Em processamento · Visualizações.
   Número forte, rótulo curto e uma linha de contexto. Todas calculadas a partir de `PRODUCTS`, mais o que
   existe no `FormaStore` deste navegador (somado no cliente).
3. **"Continue de onde parou"** (`.resume`): só aparece quando existe produto pendente de verdade
   (`processing`, `review`, `ready`, `draft`, `files_added`, `error`). Produto local pendente tem prioridade
   sobre o de demonstração; ao excluí-lo, o card volta sozinho ao estado do servidor.
4. **Produtos recentes** (`.plist` / `.prow`): linha em vez de cartão gigante — miniatura, nome, categoria,
   data de atualização, visualizações, estado, ação rápida contextual (`Ver página` / `Acompanhar` /
   `Tentar de novo` / `Continuar`) e menu. Produtos criados no navegador entram no topo da lista, com aviso
   de "Reenviar arquivos" quando os blobs da sessão foram descartados e com exclusão real.
5. **Atividade**: linha inteira clicável, mais densa.
6. O card escuro de dica saiu: era texto genérico competindo com a operação (§15).

### Sobre métricas inventadas (§7, §22)
A §7 pede "Visualizações 30d". **O backend não tem histórico de acessos** — os dados de demonstração só
guardam um total acumulado por produto. Em vez de fabricar uma janela de 30 dias e uma tendência,
a métrica se chama **"Visualizações"** com o rótulo honesto *"total desde a publicação"*, e a nota de
simulação na própria tela declara que a janela de 30 dias e as tendências dependem de um histórico no backend.
Produtos locais não somam visualizações, porque não existe contador de acessos para eles.

### Dependências de backend registradas (não implementadas de propósito)
- **Histórico de visualizações por dia** → habilita "Visualizações 30d" e as pequenas tendências da §7.
- **Poster/thumbnail renderizado do GLB** → a §7 pede "preview real do 3D" nos produtos recentes. Hoje a
  lista usa a ilustração dos produtos de demonstração e a miniatura real capturada dos produtos locais.
  Montar um `<model-viewer>` por linha significaria vários contextos WebGL na home; o caminho certo é o
  backend gerar um poster por modelo.

---

## 4. Arquivos alterados

| Arquivo | O que mudou |
| --- | --- |
| `public/forma.css` | Camada de tokens `--f3d-*`/`--radius-*`; tipografia 400–700; botões, pílulas, cards, links e topbar; slide da sidebar; `.bnav` (navegação inferior); `.metrics`, `.resume`, `.plist`/`.prow`, `.activity-link`; regras responsivas em ≤1099, ≤767 e ≤360. |
| `src/preview/ui.js` | `bottomNav()` dentro de `shell()`; componentes novos `metric()`, `listItem()`, `productRow()`; hex do wordmark alinhado aos tokens. |
| `src/routes/preview.js` | Rota `/studio` reconstruída (métricas, retomada, produtos recentes, atividade); helpers `rowAction()` e `PENDING`. |
| `public/forma.js` | Drawer com múltiplos gatilhos e devolução de foco; bloco novo da home (soma das métricas locais, retomada local com restauração, linhas locais com exclusão). |
| `.claude/launch.json` | `autoPort: true` em `cardapio-safe-http`, para o preview não colidir quando a porta 3001 já está ocupada pelo `dev:safe` do terminal. |

Sem dependências novas, sem mudança de stack, sem arquivo removido.

---

## 5. Validação

**Testes** — `npm test`: **48 passando, 0 falhando** (mesmo resultado da linha de base antes das mudanças).
Não há ESLint/Prettier configurados no projeto; nenhum linter foi instalado (§20.3).
Não existe etapa de build: o servidor é Express com HTML gerado em JS e assets estáticos.
`node --check` passou em `src/routes/preview.js` e `src/preview/ui.js`.

**Ambiente** — validado com `npm run dev:safe --http` (KIRI falso, em processo). **Nenhum crédito consumido.**

**Rotas** (todas 200): `/`, `/studio`, `/studio/produtos`, `/studio/produtos/novo`, `/studio/publicacoes`,
`/studio/estatisticas`, `/studio/configuracoes`, `/studio/produtos/:slug/processando`, `/studio/produtos/:slug`, `/p/:slug`.
Console do navegador sem erros em nenhuma delas.

**Breakpoints** — sem scroll horizontal (`scrollWidth − clientWidth = 0`) em:

| 320 | 390 | 430 | 768 | 1024 | 1366 | 1440 |
| --- | --- | --- | --- | --- | --- | --- |
| ok | ok | ok | ok | ok | ok | ok |

- ≤767: métricas em 2 colunas, retomada em três fileiras, linha de produto recomposta em duas fileiras, barra inferior ativa.
- 768–1099: header compacto + gaveta, quatro métricas lado a lado.
- ≥1100: sidebar fixa.
- ≤360: rótulos das métricas e ação da linha encolhem um passo.

**Acessibilidade** — varredura no DOM a 390px: nenhum controle abaixo de 24px de altura; todos os botões de
ícone com `aria-label`; `aria-current="page"` no destino ativo; `:focus-visible` global de 3px;
`.prow-action` com 44px de altura em toque; `prefers-reduced-motion` respeitado pela regra global já existente.
Contraste dos pares novos conferido na mão: slate/surface 4,9:1 · positive/success-100 5,1:1 ·
warning-text/warning-100 6,2:1 · negative/danger-100 5,3:1 · lime/graphite 14,6:1 · forest/branco 13,5:1.

**Comportamento verificado no navegador**: "Mais" abre a gaveta e devolve o foco; produto criado no navegador
entra na home (métrica 3→4, retomada trocada, linha no topo com aviso de reenvio); ao excluir, a métrica volta
a 3 e a retomada volta ao produto de demonstração.

---

## 6. O que continua pendente (fora do escopo destas duas sprints)

- **Sprint C — Create Flow**: `/studio/produtos/novo` ainda abre como formulário administrativo (nome, categoria,
  descrição, coleção, três dimensões, tags de uma vez). É o maior problema apontado na §8 e o próximo passo.
- **Sprint D — 3D Studio**, **Sprint E — Página pública**, **Sprint F — Landing**: intocadas de propósito.
- **§17 Configurações**: a página segue quase vazia. Não entra em Sprint A nem B.
- `/studio/produtos` continua com a grade de cartões atual; os modos Grid/Lista da §9 são da Sprint C.

---
---

# SPRINT A.5 — Brand integration + motion polish

Data: 22/09/2026. Escopo: **marca, linguagem visual e motion**. A arquitetura das Sprints A e B
ficou de pé — nenhuma tela foi reestruturada, nenhum fluxo mudou.

Intocados, como manda o item 12 do briefing: backend (`src/app.js`, `src/db.js`, `src/routes/admin.js`,
`src/routes/restaurant.js`, `src/auth.js`), KIRI e providers (`src/forma/`, `src/lib/generators/`),
scanner (`public/forma-scanner.js`, `public/scanner/`, `public/forma-capture.js`), fluxo de criação
(`/studio/produtos/novo`), Studio 3D, página pública, landing, banco, rotas e lógica de produtos.

## A.5.1 — Assets de marca encontrados e usados

**Encontrado: um único arquivo.** Uma varredura por `*.png|svg|jpg|jpeg|webp|avif` em todo o projeto
(fora de `node_modules`) devolveu dois arquivos, e só um é identidade:

| Arquivo | O que é |
| --- | --- |
| `LOGO FORMA 3D.png` (raiz do projeto, 2172×724, RGBA) | **Novo lockup horizontal**: símbolo + wordmark `forma3D`, tinta `#131312`, fundo transparente |
| `cardapio-3d-ar/preview-qr.png` | QR code de teste, não é marca |

Não existem no projeto: variante clara, símbolo isolado, wordmark isolado, SVG ou manual de uso.

**Gerados por recorte do arquivo oficial** (sem redesenho, sem recolorir, sem filtro) em
`public/brand/` — as caixas de recorte e o método estão em `public/brand/README.md`:

| Arquivo | Uso |
| --- | --- |
| `forma3d-lockup.png` (720×185) | sidebar, header do celular, nav da landing, rodapé da página pública |
| `forma3d-symbol.png` (256×256) | `apple-touch-icon` |
| `forma3d-symbol-64.png` (64×64) | favicon (novo: o preview não tinha nenhum) |

**O cubo verde saiu.** O `brand()` de `src/preview/ui.js` desenhava um cubo em SVG com o wordmark em
texto; virou `<img>` do lockup oficial. Como o componente é compartilhado, a nova marca aparece em
sidebar, header do celular, landing e rodapé público de uma vez — sem mexer na estrutura de nenhuma
dessas telas.

**Fundo escuro.** A sidebar e o header do celular são `#0B352B`; a tinta do lockup é quase preta.
Sem variante clara oficial, o lockup vai **dentro de uma placa clara** (`.brand-dark`, `.brand-sm`),
com área de respiro preservada. Não foi usado `filter: invert()`, `mix-blend-mode` nem recriação em
CSS — essas eram as saídas proibidas pelo briefing.

**Entrada/login:** não existe login do Forma 3D. O único `/entrar` é o painel legado de restaurantes
(Cardápio 3D, `src/routes/auth.js` + `public/app.css`), que está na lista de "não mexer" do item 12.
Ficou como está; quando existir uma entrada do Forma 3D, ela usa o mesmo `brand()`.

### Variantes oficiais que ainda faltam

1. **Lockup em versão clara** (tinta clara, fundo transparente) — a mais urgente: é o que elimina a
   placa clara nas superfícies escuras.
2. **Símbolo isolado oficial** — o daqui é recorte do lockup; o respiro e o alinhamento óptico
   deveriam vir do design.
3. **SVG** do lockup e do símbolo — hoje a marca é bitmap.
4. **Wordmark isolado**, se houver uso previsto sem o símbolo.
5. **Versão monocromática de uma cor** (lime `#B8F36B` / forest `#0B352B`).
6. **Favicon claro** — o símbolo atual é quase preto e some em abas de navegador escuras.
7. **Manual de marca**: respiro mínimo, tamanho mínimo, fundos permitidos.

## A.5.2 — Linguagem visual derivada do símbolo

O símbolo novo é feito de **dois planos dobrados com corte a 45°** e cantos arredondados. Foram
extraídos dois gestos, aplicados com parcimônia (o briefing proíbe transformar tudo em diagonal):

- **Corte de canto a 45°** (`--cut`, via `clip-path` sobre o `border-radius`), em quatro lugares e só
  neles: bloco "Continue de onde parou", miniatura desse bloco, miniatura das linhas de produto e
  arte do estado vazio. É o mesmo movimento do símbolo repetido em duas escalas dentro do bloco
  operacional — a composição do próprio mark.
- **Hachura a 45° em movimento contínuo** nas barras de progresso (`@keyframes hatch`, linear), que
  substitui o spinner genérico onde já existe percentual real.

Sem a logo, o que identifica a plataforma passa a ser: paleta forest/lime, superfícies de mídia com
canto cortado, hachura diagonal no processamento, faixa de métricas tipográfica e a barra lime do
indicador da sidebar.

## A.5.3 — Dashboard: polimento

**Métricas.** Deixaram de ser quatro retângulos com 1px de gap (que liam como tabela). Agora são uma
superfície só, com hairline **recuada** entre colunas, rótulo em caixa alta de 11,5px/500 e o número
em `clamp(34px, 3.2vw, 46px)`/700, `line-height .95`, tracking `-0.045em`, tabular. O número virou o
elemento de layout; o rótulo e a linha de contexto orbitam ele.

**Continue de onde parou.** Virou o bloco operacional da tela: canto cortado a 45°, miniatura de 88px
(era 64) com o mesmo corte em escala menor, nome em 22px/600, estado, CTA e **barra de progresso
real** na base. Produto de demonstração em processamento mostra o percentual do dado; produto criado
no navegador, que não tem percentual do provider, mostra a hachura contínua — atividade sem número
inventado. Nada de copy de marketing.

**Produtos recentes.** Miniatura de 72px (era 64) com o corte da marca, nome em 16,5px/600 com
tracking negativo, badge reduzido a 12px/26px de altura: o produto pesa mais que o estado. Separador
virou `::before` recuado, que some no hover — assim o deslocamento de 1px da linha não abre fresta.

## A.5.4 — Sidebar

Não foi refeita. Ganhou: a marca nova na placa, `gap` de 4px entre itens (era 2), item de 46px com
raio 14, ícone que clareia no hover e fica lime no ativo, e **indicador compartilhado que desliza**.

O indicador (`.snav-ind`) é um elemento só, posicionado por JS a partir do `offsetTop` do item ativo.
Como cada tela é um documento novo, o "de onde veio" fica em `sessionStorage`: ao abrir a nova seção
o indicador **nasce no item da seção anterior e desliza até o novo** em 260ms. Sem seção anterior,
assenta sem animação. A seleção é uma superfície discreta (`rgba(255,255,255,.09)`) com uma barra
lime de 3px que entra com 4px de deslocamento horizontal — não é um retângulo fluorescente.

Sem JS a seleção continua legível: o estado preso ao item (`.snav-item.is-active`) só é desligado
quando o JS liga `.has-ind`.

## A.5.5 — Tipografia

Continua Inter. O que mudou foi o tratamento:

| Onde | Antes | Depois |
| --- | --- | --- |
| Título da tela (topbar) | 26px | `clamp(26px, 2.4vw, 34px)` / 600 / `-0.03em` |
| Número da métrica | 34px / 700 | `clamp(34px, 3.2vw, 46px)` / 700 / `-0.045em` / `lh .95` |
| Título de seção no app | 20px / 600 | rótulo de 12,5px / 600 / caixa alta / `.1em` + hairline |
| Eyebrow | 12px / 700 / `.12em` | 11,5px / 600 / `.14em` |
| Nome do produto na linha | 16px | 16,5px / 600 / `-0.015em` |
| h1 / h2 globais | tracking `-0.022em` / `-0.014em` | `-0.028em` / `-0.018em` |

O título de seção virou rótulo **só dentro de `.has-shell`** — a landing mantém os títulos grandes
dela, como manda o item 10.

**Bold excessivo:** nove regras saíram de 700 (`.h-card`, `.field label`, `.input-wrap .unit`,
`.avatar`, `.formats`, `.pcard-link`, `.table th`, `.mhead-title`, `.stat small`). O peso 700 ficou
para número e título; rótulo e chip vão a 600/500.

## A.5.6 — Motion: revisão completa

Tokens novos em `:root`, com os nomes antigos virando apelidos (nenhuma regra já escrita precisou
mudar):

| Token | Valor | Uso |
| --- | --- | --- |
| `--t-micro` | 140ms | cor, borda, ícone |
| `--t-state` | 190ms | hover e estado de componente |
| `--t-view` | 260ms | entrada de tela, gaveta, indicador |
| `--ease` | `cubic-bezier(.2,.8,.2,1)` | tudo |
| `--press` | `.985` | pressionado, em botão/cartão/linha/nav |

O que foi removido ou trocado:

- **`@keyframes rise`**: `translateY(10px)` → **4px**. É a mesma distância da troca de rota, então
  entrada de bloco e transição de página falam a mesma língua.
- **`@keyframes pop`**: o overshoot (`70% { scale: 1.03 }`) saiu. A escala chega em 1 e para — o
  briefing proíbe bounce.
- **Entrada do dashboard**: era cartão por cartão (`.pcard` com `animation-delay` de 60/120ms).
  Agora são **três tempos**: cabeçalho (0ms), bloco operacional (40ms) e conteúdo principal (80ms),
  via `.has-shell .content > *`. O mesmo mecanismo é a transição de rota de todas as telas do app.
- **`.pcard`**: hover de -2px → **-1px**; a miniatura trocou `rotate(-3deg) translateY(-3px)` por
  uma leve mudança de perspectiva (`rotateY(-7deg) scale(1.03)`) — profundidade, não giro decorativo.
- **Pílula "Processando"**: o ícone girando (`spin 1.6s`) virou um pulso de opacidade de 1,8s.
  Atividade contínua e discreta, sem spinner competindo com o percentual.
- **Linha de produto**: hover com 1px de deslocamento + superfície, miniatura com perspectiva e CTA
  respondendo junto (borda escurece, seta anda 2px). No toque (≤767) a linha não se mexe.
- **Botão**: `:active` passou de `scale(.98)` para `scale(var(--press))`; hover continua em 1px.
- **Count-up**: só no primeiro carregamento **da sessão** (`sessionStorage`), só em número de três
  dígitos ou mais (contar "3 produtos" não informa nada), 560ms com desaceleração cúbica.
  `data-counted` impede que um rerender — excluir um produto, por exemplo — recomece a contagem.
- **Profundidade com ponteiro (item 8)**: só a miniatura do bloco operacional inclina até 5°,
  seguindo o ponteiro, e só em `(hover: hover) and (pointer: fine)`. Um elemento por tela.
- **Viewer com câmera interpolada** ficou de fora de propósito: é Studio 3D, lista de "não mexer".

**`prefers-reduced-motion`**: a regra global (`animation-duration: .01ms !important`) continua
cobrindo tudo o que é CSS — inclusive `hatch`, `breathe` e a entrada em três tempos. No JS, a mesma
preferência desliga o deslize do indicador (ele assenta direto), o count-up e a inclinação da
miniatura.

## A.5.7 — Arquivos alterados

| Arquivo | O que mudou |
| --- | --- |
| `public/brand/*` | **novo**: lockup, símbolo, favicon e o README com recortes e pendências da marca |
| `public/forma.css` | tokens de motion e `--cut`; tipografia; marca em `<img>` + placa; sidebar e indicador; métricas, retomada e linhas de produto; entrada em três tempos; hachura; nota de simulação mais baixa; responsivo 1099/767/360 |
| `src/preview/ui.js` | `brand()` com o asset oficial; favicon e apple-touch-icon no `doc()`; `data-key` nos itens de nav; `.snav-ind` no `shell()` |
| `src/routes/preview.js` | barra de progresso real no bloco "Continue de onde parou" |
| `public/forma.js` | indicador deslizante da sidebar; count-up uma vez por sessão; barra de progresso do produto local; inclinação da miniatura com o ponteiro |

Sem dependência nova, sem mudança de stack, sem arquivo removido. Nenhum GSAP foi instalado — o
motion é CSS + Web APIs.

## A.5.8 — Skills usadas

- **`ui-ux-pro-max`** — consultada em três buscas (`ux`, `typography`, `gsap`). Três resultados
  entraram na decisão: "use shared motion tokens / don't copy one duration to every transition"
  (virou a escala `--t-micro/state/view`); "deceleration when arriving, linear for constant-rate
  progress" (a hachura do progresso é `linear`, o resto é `ease` de saída); e o preset de hover
  "Subtle" — 150–200ms, deslocamento abaixo de 2px, "so it reads as feedback not motion" — que é
  exatamente o hover de 1px da linha de produto, mais o alerta de não aplicar efeito magnético em
  mais de 1–2 elementos focais por tela (por isso só a miniatura da retomada segue o ponteiro).
- **`frontend-design`** — usada como crítica: "spend your boldness in one place". A ousadia ficou na
  faixa de métricas e no bloco operacional; o resto foi mantido quieto. A mesma skill alertou contra
  os defaults de IA (fundo creme + serifa + terracota; preto com verde ácido), então a paleta seguiu
  sendo a da marca Forma 3D, não uma paleta "de portfólio".
- **GSAP**: os presets foram lidos como referência de tempo e intensidade, mas **nada foi instalado**
  — o projeto não tem GSAP e o briefing proíbe reinstalar dependências. As curvas foram traduzidas
  para CSS.
- **Wise** (`wise.design`, `wise.design/brand`) foi consultada como referência de hierarquia:
  rótulo pequeno + conteúdo enorme, hairlines recuadas, contraste alto e seleção em pílula que
  desliza. Nenhum componente, cor ou forma foi copiado.

## A.5.9 — Validação

**Testes** — `npm test`: **48 passando, 0 falhando** (mesma linha de base das Sprints A e B).
`node --check` em `src/preview/ui.js`, `src/routes/preview.js` e `public/forma.js`.

**Ambiente** — `npm run dev:safe --http` (KIRI falso, em processo). **Nenhum crédito consumido.**

**Rotas** (todas 200, console limpo): `/`, `/studio`, `/studio/produtos`, `/studio/produtos/novo`,
`/studio/publicacoes`, `/studio/estatisticas`, `/studio/configuracoes`,
`/studio/produtos/:slug/processando`, `/studio/produtos/:slug`, `/p/:slug`.

**Breakpoints** — sem scroll horizontal (`scrollWidth − clientWidth = 0`) e composição conferida em:

| 320 | 360 | 390 | 430 | 768 | 1024 | 1280 | 1366 | 1440 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ok | ok | ok | ok | ok | ok | ok | ok | ok |

Dois problemas de composição foram encontrados e corrigidos na validação, não só no CSS:

1. **768px**: "Em processamento" quebrava em duas linhas e desalinhava os números da faixa. O rótulo
   passou a reservar duas linhas de altura (`min-height: 2.5em`) de 1099px para baixo — os quatro
   números voltaram a assentar na mesma linha de base (conferido: tops iguais em 768, 1024 e 390).
2. **768px**: o título da tela sobrava em três linhas espremidas ao lado da busca. O título passou a
   ocupar a linha inteira no tablet; busca e ações descem para a linha seguinte.

No celular: métricas em 2×2 com hairline vertical entre colunas e horizontal entre fileiras, barra
inferior com pílula lime no destino ativo, retomada em quatro fileiras (mídia+texto, estado, CTA,
progresso) e linha de produto recomposta em duas fileiras.

**Acessibilidade** — o indicador da sidebar é `aria-hidden` e decorativo: quem comunica a seção
continua sendo `aria-current="page"` e o próprio estado do item. Sem JS, a seleção presa ao item
continua visível. Nenhum alvo de toque encolheu. A nota de simulação ficou mais discreta mas manteve
ícone + rótulo em negrito e o texto em `#6E4806` sobre `#FBF6EC` (contraste ~7:1).

## A.5.10 — O que continua pendente

- **Sprint C — Create Flow**: `/studio/produtos/novo` segue como formulário administrativo. Não foi
  iniciada, como pedido.
- As variantes de marca listadas em A.5.1 — sem elas, toda superfície escura depende da placa clara.
- **Poster/thumbnail renderizado do GLB** (herdado da Sprint B): as linhas ainda usam ilustração para
  os produtos de demonstração. O corte a 45° já está pronto para receber o preview real.
- **Histórico de visualizações por dia** (herdado da Sprint B): sem ele não há "30 dias" nem tendência.

---
---

# CAPTURA V2 — `FORMA3D_REDENHO_CAPTURA_V2_CLAUDE.md`

Data: 25/09/2026. Validado com `npm run dev:safe` (KIRI falso). **Nenhum crédito real consumido.**

## Diagnóstico

- **Câmera:** `getUserMedia` pedia `max: 1920 × 1080`. Com o iPhone em pé, o lado maior é a altura, e o
  teto de 1080 derrubava o stream. O fallback de `OverconstrainedError` abria a câmera sem resolução
  (640 × 480). A resolução real nunca era lida, e não havia escolha de lente. As fotos saíam do
  quadro do `<video>`, limitadas a 1920 px.
- **Vídeo:** a validação dependia de o navegador *decodificar* o arquivo. MOV/HEVC do iPhone no
  Chrome/Windows era recusado como "não conseguiu abrir". O cliente limitava a 100 MB (o servidor
  aceita 300 MB). 4K era recusado, porque o KIRI aceita até 1080p e não há ffmpeg no servidor. As
  mensagens eram genéricas.

## O que mudou

| Área | Arquivos |
| --- | --- |
| Câmera traseira: só `ideal`, escada 4K → 1080p → padrão, `getSettings`, `enumerateDevices`, lente principal (evita a câmera virtual Dupla/Tripla do iPhone), foco contínuo, `ImageCapture.takePhoto` quando existe | `public/scanner/camera.js` (novo), `public/forma-capture.js` |
| Fotos guiadas: preparar → 3 voltas → disparador, bandeja, contador, anel de cobertura (bússola ou contagem declarada), recusa na hora de foto tremida/escura/repetida, revisão com remoção | `public/forma-guided.js` (novo) |
| Checagem do conjunto: resolução, nitidez relativa, exposição, repetidas (dHash). Fotos grandes (48 MP, HEIC no Safari) são normalizadas, não recusadas | `public/scanner/photo-check.js` (novo) |
| Vídeo: leitura MP4/MOV sem decodificar (duração, resolução, codec). Se o navegador decodifica, os quadros mais nítidos são extraídos e enviados como fotos; se não, o vídeo vai direto quando cabe nos limites; senão, erro com causa | `public/forma-video.js` (novo) |
| Assistente: nova tela de método (§11), passo 1 enxuto, fallback "Tirar com a câmera do celular", superfície do produto, qualidade, upload com progresso real (XHR), erros com título + causa + ação | `public/forma-new-product.js`, `src/routes/preview.js` |
| Processamento: 5 etapas (geometria e textura ativas juntas, porque o KIRI não as separa), tempo decorrido, `aria-live`, erro explicado, "Tentar novamente" sem reenvio, conferência "Seu modelo está pronto" antes de publicar | `public/forma.js`, `public/forma-reconstruction.js`, `src/routes/preview.js` |
| Backend: presets `high`/`standard`, endpoint Featureless, `error_code`/`error_stage`/`attempts`, retry com os arquivos guardados (48 h), sonda de codec, logs sem chave | `src/forma/*`, `src/routes/forma-api.js`, `src/migrations/003_forma_job_errors.sql` |
| Estúdio real (conta, logo, marca na página pública, compartilhamento com QR, preferências 3D, plano); bottom nav Início · Produtos · Criar · Estúdio | `src/routes/preview.js`, `src/preview/ui.js`, `public/forma-store.js` (prefs) |
| Página pública: AR na cor da marca, medidas só do fabricante em faixa compacta, materiais em chips, hotspots ligados à lista, reset, tela cheia, progresso do GLB | `src/routes/preview.js`, `public/forma.js` |
| Visual: Instrument Sans, tokens de espaço, foco forest/lime (o azul saiu), dropzone da marca, landing com título editorial, setores com arte, bloco final com 3D | `public/forma.css`, `src/preview/ui.js` |

## Pendências

- **Validar no iPhone real** (HTTPS): lente escolhida, resolução real (o chip mostra 4K/1080p) e bússola.
- **Validar no KIRI real**, com autorização explícita: preset High/4K (custo e tempo) e endpoint Featureless.
- Converter vídeo HEVC no servidor exigiria ffmpeg. Hoje, HEVC só passa quando o navegador decodifica
  (Safari/iPhone) ou quando cabe no envio direto.
- A cobertura sem bússola é estimada pela contagem de fotos, e a tela diz isso.

---

# Redesign visual — referências KYMA e Conicorn (16/10/2026)

Pedido: usar [kyma.framer.ai](https://kyma.framer.ai) e [conicorn.framer.ai](https://conicorn.framer.ai) como
referência visual para a landing e para a interface do Studio. Só apresentação mudou: nenhuma rota,
fluxo, store, backend ou teste foi alterado (`npm test`: 53/53).

## Linguagem

| Elemento | Decisão |
| --- | --- |
| Display | **Archivo** expandida (wdth 112, peso 800), caixa-alta — ecoa o wordmark pesado do logo e o título da KYMA |
| Utilitária | **JetBrains Mono** para rótulos `[ assim ]_`, leituras, estados e etiquetas |
| Corpo | Instrument Sans (sem mudança) |
| Cor | Paleta da marca mantida; novo `--f3d-night` (#072A22) para hero, setores, sidebar e card de retomada |
| Estrutura | Guias de coluna (KYMA) desenhadas no fundo com `background-origin: content-box`, 4 colunas no desktop |
| Forma | O canto cortado a 45° do símbolo (`--cut`) vira a forma dos botões da landing e das etiquetas de estado |

## Landing (`r.get('/')` em `src/routes/preview.js`, classes `lx-*`)

- **Hero escuro** com título em toda a largura e **visor de captura** (elemento-assinatura): cantoneiras,
  linha de varredura que passa uma vez quando o GLB termina de carregar, e leituras de **azimute e elevação
  vindas da câmera real** do `<model-viewer>` (evento `camera-change`). Medidas e formatos vêm de `data.js`.
- **Faixa de compatibilidade** no lugar de logos de clientes: navegador, Android/Scene Viewer, iPhone/Quick Look, QR, link, incorporação.
- **Como funciona**: frase-manifesto que acende palavra a palavra com o scroll (desligada com movimento
  reduzido ou sem JS — a frase aparece inteira) e as três etapas alinhadas às colunas, cada uma com um fato.
- **Setores** como tabela de abas (`role="tablist"`, setas/Home/End) que troca o modelo do visor ao lado.
  Restaurantes entrou como primeiro setor, com o `samples/prato-exemplo.glb`.
- **Chamada final** no estilo "let's get started" e rodapé em mono.
- O CSS da landing antiga (`lp-*`, `steps3`, `sector-*`) foi removido.

Nenhum número de mercado foi inventado: os dados da página são fatos do produto (20–300 fotos, vídeo até
3 min, GLB/USDZ, AR) e leituras reais do visualizador.

## Studio

Títulos de página e do editor em display caixa-alta; métricas com números em display e rótulos em mono;
cabeçalhos de seção como `[ PRODUTOS RECENTES ]`; estados (`.pill`) como etiquetas mono com o canto da marca;
card "Continue de onde parou" com guias de coluna; sidebar e cabeçalho do celular em `--f3d-night`.

## Pendências

- As fontes vêm do Google Fonts (como a Instrument Sans já vinha). Para rodar 100% offline, hospedar os
  arquivos em `public/fonts/`.
- Validar a varredura e as leituras do visor num celular real (desempenho do `<model-viewer>` com dois visores na página).
