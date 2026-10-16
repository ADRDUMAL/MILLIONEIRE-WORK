# Marca Forma 3D — assets do preview

## Arquivo oficial recebido

Um só: **`LOGO FORMA 3D.png`**, na raiz do projeto (fora de `cardapio-3d-ar/`).

| Propriedade | Valor |
| --- | --- |
| Dimensão | 2172 × 724 px |
| Formato | PNG RGBA, **fundo transparente** |
| Tinta | `#131312` (quase preto), opaca |
| Conteúdo | lockup horizontal: símbolo + wordmark `forma3D` |
| Caixa da tinta (alpha > 40) | x 312–1870 · y 211–549 |
| Símbolo | x 312–633 · y 211–549 (322 × 339) |
| Wordmark | x 691–1870 · y 273–480 (1180 × 208) |

Não existe versão clara, versão em uma cor de marca, símbolo isolado, wordmark isolado nem SVG.

## Arquivos gerados aqui

Gerados **por recorte do arquivo oficial** — sem redesenho, sem recolorir, sem filtro. A geometria é
exatamente a entregue. Para refazer, use as caixas da tabela acima:

| Arquivo | Como foi feito | Onde é usado |
| --- | --- | --- |
| `forma3d-lockup.png` (720 × 185) | recorte `312,211 → 1871,550` + respiro de 12% da altura do símbolo, reamostrado para 720px de largura | sidebar, header do celular, nav da landing, rodapé da página pública |
| `forma3d-symbol.png` (256 × 256) | recorte `312,211 → 634,550` centrado em canvas quadrado (respiro de 13%) | `apple-touch-icon` |
| `forma3d-symbol-64.png` (64 × 64) | o mesmo, reduzido | favicon |

## Como a marca é aplicada

- **Fundo claro** (landing, página pública): o lockup vai direto, sem caixa.
- **Fundo escuro** (sidebar e header do celular, ambos `#0B352B`): a tinta quase preta some no
  verde-escuro. Como **não existe variante clara**, o lockup vai **dentro de uma placa clara**
  (`.brand-dark`, `.brand-sm` em `forma.css`). É contenção com área de respiro preservada — nunca
  `filter: invert()`, `mix-blend-mode` ou recriação em CSS.
- Tamanho por contexto: 26px de altura na landing, 22px na sidebar, 18px no header do celular,
  16px no rodapé público. A imagem nunca é distorcida (`width: auto`).

## O que ainda falta da marca oficial

1. **Variante clara do lockup** (tinta clara / branca, fundo transparente) — enquanto não existir,
   toda superfície escura precisa da placa clara. É a pendência mais importante.
2. **Símbolo isolado oficial**, exportado pelo design — o daqui é recorte do lockup. Serve, mas o
   respiro e o alinhamento óptico deveriam vir do arquivo original.
3. **SVG** do lockup e do símbolo — hoje a marca é bitmap; em telas grandes e em impressão isso
   limita, e um favicon SVG resolveria o contraste em abas escuras.
4. **Wordmark isolado**, se a marca previr uso sem símbolo.
5. **Versão monocromática de uma cor** (para aplicar em lime `#B8F36B` ou forest `#0B352B` quando
   a composição pedir).
6. **Favicon claro**: o símbolo atual é quase preto e fica apagado em abas de navegador escuras.
7. **Manual de uso**: área de respiro mínima, tamanho mínimo e fundos permitidos. Os valores usados
   aqui (respiro de 12% da altura do símbolo) são uma decisão de implementação, não regra oficial.
