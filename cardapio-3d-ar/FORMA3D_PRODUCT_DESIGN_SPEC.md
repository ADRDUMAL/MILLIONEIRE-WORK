# FORMA 3D — Product, UX/UI and MVP Implementation Specification

> Documento mestre para orientar o Claude Code na evolução do protótipo existente.
> 
> O nome **Forma 3D** é provisório e serve apenas como placeholder de interface. Não criar uma identidade definitiva nem alterar nomes internos do repositório em massa nesta fase.

---

## 0. Instrução de execução imediata

O objetivo desta rodada é transformar o protótipo atual, hoje visualmente cru, em um **preview web desktop de alta fidelidade**, navegável e convincente, preservando o que já funciona.

Antes de editar qualquer arquivo:

1. Leia integralmente `README.md`, `package.json` e os arquivos de instrução dentro de `.claude`.
2. Identifique framework, rotas, dependências, scripts, componentes, assets e recursos 3D existentes.
3. Rode o projeto como está e registre brevemente o que já funciona.
4. Procure modelos ou exemplos existentes em `public`, `samples`, `data` e `src`.
5. Não reinstale dependências que já estejam presentes em `node_modules` e `package-lock.json`.
6. Não reescreva backend, pipeline 3D, testes ou Docker sem necessidade direta.
7. Faça alterações incrementais, reutilizando o maior número possível de componentes e dependências existentes.

### Escopo autorizado nesta rodada

- Criar ou reformular o preview visual da plataforma.
- Priorizar desktop, com estrutura CSS que não impeça responsividade futura.
- Criar as telas essenciais com dados de demonstração realistas.
- Reutilizar um modelo 3D já existente no projeto, se houver.
- Se houver visualizador 3D funcional, incorporá-lo à nova interface.
- Se o processamento real não estiver pronto, simular estados de upload e processamento apenas na interface.
- Manter as funcionalidades existentes que não conflitem com a nova experiência.

### Fora do escopo desta rodada

- Autenticação real.
- Banco de dados definitivo.
- Cobrança ou assinatura.
- Pipeline real de fotogrametria ou reconstrução 3D por IA.
- Captura real por câmera.
- Realidade aumentada completa.
- Painel administrativo da empresa proprietária da plataforma.
- Aplicativo nativo.
- Refatoração ampla sem benefício direto para o preview.
- Criação de várias alternativas visuais. Implemente uma direção forte e coerente.

Ao terminar, informe:

- arquivos alterados;
- rota e comando para abrir o preview;
- recursos já funcionais;
- recursos simulados;
- próximos três passos recomendados.

Não produza uma explicação longa antes de trabalhar. Audite, implemente, valide e entregue um resumo objetivo.

---

## 1. Visão do produto

Forma 3D é uma plataforma B2B que transforma produtos físicos em experiências digitais tridimensionais compartilháveis.

Uma empresa poderá:

1. cadastrar um produto;
2. enviar fotos ou um vídeo em 360 graus;
3. acompanhar a geração do modelo tridimensional;
4. revisar e enriquecer o produto com nome, descrição, dimensões, materiais e pontos interativos;
5. publicar uma página visual;
6. compartilhar o produto por link ou incorporá-lo em outro site;
7. futuramente permitir visualização em realidade aumentada.

O produto não deve ser tratado como um sistema exclusivo para cardápios ou alimentos. O diretório atual pode se chamar `cardapio-3d-ar`, mas a plataforma precisa funcionar conceitualmente para:

- móveis;
- produtos industriais;
- decoração;
- calçados;
- embalagens;
- equipamentos;
- objetos de consumo;
- alimentos, quando aplicável.

### Promessa central

**Transforme produtos reais em experiências 3D.**

### Pilares de valor

- Mais entendimento do produto.
- Apresentação comercial premium.
- Mais confiança antes da compra.
- Compartilhamento simples.
- Diferenciação digital para marcas e indústrias.
- Processo guiado, mesmo para usuários sem conhecimento técnico em 3D.

---

## 2. Dois públicos, duas experiências

### 2.1 Cliente da plataforma — experiência B2B

É a empresa que cadastra e publica produtos. Precisa sentir que o sistema é:

- profissional;
- seguro;
- simples;
- moderno;
- organizado;
- capaz de gerar valor comercial;
- utilizável sem experiência técnica.

A interface deve reduzir ansiedade. Termos técnicos como mesh, topologia, UV, GLB ou fotogrametria não devem dominar a jornada. Traduzir tecnologia em ações simples.

Exemplos:

- Em vez de “iniciar reconstrução fotogramétrica”, usar “Construir modelo 3D”.
- Em vez de “upload de dataset”, usar “Adicione fotos ou um vídeo do produto”.
- Em vez de “exportar GLB”, usar “Publicar” ou “Baixar modelo”, conforme o contexto.

### 2.2 Consumidor do cliente — experiência pública

É quem recebe o link, encontra o produto no site de uma marca ou abre a experiência em uma loja.

Precisa conseguir, sem tutorial:

- reconhecer o produto imediatamente;
- arrastar para girar;
- pinçar ou usar controles para aproximar;
- visualizar informações importantes;
- abrir pontos interativos;
- compartilhar;
- futuramente ver o produto no próprio espaço em realidade aumentada.

A página pública deve carregar rápido, ter poucos elementos e colocar o objeto 3D no centro da experiência.

---

## 3. Personalidade do design

### Direção desejada

Combinar:

- clareza, confiança, tipografia forte e objetividade de produtos financeiros contemporâneos;
- condução amigável, feedback visual e progressão perceptível de produtos educacionais interativos;
- acabamento premium de um SaaS B2B;
- presença tátil e espacial coerente com um produto de tecnologia 3D.

### Sensação pretendida

O usuário deve pensar:

> “Isso é tecnologia avançada, mas parece simples de usar.”

### Adjetivos do sistema visual

- confiante;
- humano;
- dimensional;
- claro;
- editorial;
- amigável;
- preciso;
- inovador;
- premium sem ser luxuoso;
- sério sem ser frio.

### O que evitar

- dashboard genérico roxo;
- estética de criptomoeda;
- cyberpunk ou neon excessivo;
- excesso de glassmorphism;
- interface inteiramente escura;
- cards pequenos demais e densos;
- muitos gráficos sem valor real;
- aparência de template comprado;
- elementos infantis ou mascotes caricatos;
- animações decorativas que prejudiquem velocidade;
- copiar diretamente Wise, Duolingo ou qualquer produto existente;
- usar cor como único indicador de estado;
- textos em inglês na interface principal.

---

## 4. Sistema de cores

### Paleta principal

| Token | Hex | Uso |
|---|---:|---|
| `--color-canvas` | `#F4F1E8` | Fundo principal quente, landing e áreas amplas |
| `--color-surface` | `#FFFDF8` | Cards, modais e painéis claros |
| `--color-forest-950` | `#0B2B20` | Sidebar, painéis imersivos e contraste máximo |
| `--color-forest-800` | `#12372A` | Marca provisória, navegação e elementos institucionais |
| `--color-lime-500` | `#B9F227` | CTA principal, seleção e progresso positivo |
| `--color-lime-650` | `#91C900` | Hover ou estado pressionado do lime |
| `--color-blue-600` | `#315CFF` | Tecnologia, links, AR e ações secundárias pontuais |
| `--color-ink` | `#18211D` | Texto principal |
| `--color-muted` | `#68716C` | Texto secundário |
| `--color-line` | `#DCDDD5` | Bordas e divisores |
| `--color-success` | `#2DAA63` | Publicado/concluído, sempre com ícone e texto |
| `--color-warning` | `#D9911A` | Atenção, sempre com ícone e texto |
| `--color-danger` | `#D84A4A` | Erro ou ação destrutiva, sempre com confirmação |

### Proporção visual recomendada

- 60% creme e superfícies claras.
- 25% verde profundo.
- 10% neutros e linhas.
- 4% lima.
- 1% azul-cobalto.

Lima e azul são cores de ação, não fundos indiscriminados. O verde profundo sustenta confiança. O creme reduz a frieza de um painel convencional.

### Acessibilidade cromática

- Garantir contraste WCAG AA para textos e controles essenciais.
- Nunca indicar “Publicado”, “Processando” ou “Erro” apenas pela cor.
- Sempre combinar status com texto, ícone e, quando necessário, padrão ou forma.
- Evitar pares vermelho/verde sem diferenciação adicional.

---

## 5. Tipografia

### Família principal

Usar a melhor fonte sans-serif já disponível no projeto. Se não houver sistema definido, priorizar nesta ordem:

1. `Manrope`;
2. `Geist Sans`;
3. `Inter`;
4. fallback `system-ui, sans-serif`.

Não adicionar mais de uma dependência de fonte nesta fase.

### Fonte editorial opcional

Uma serifada pode aparecer apenas em grandes frases institucionais da landing page, nunca em controles ou formulários. Se já houver uma fonte serifada instalada, reutilizá-la. Caso contrário, não adicionar agora.

### Escala desktop

| Papel | Tamanho | Peso | Line-height |
|---|---:|---:|---:|
| Display de marketing | `clamp(56px, 6vw, 96px)` | 750–850 | 0.94–1.0 |
| Título de página | 40–52px | 700–800 | 1.0–1.1 |
| Título de seção | 26–32px | 650–750 | 1.1–1.2 |
| Título de card | 16–20px | 600–700 | 1.2 |
| Corpo | 15–17px | 400–500 | 1.5–1.65 |
| Label | 12–14px | 550–650 | 1.3 |
| Microtexto | 11–12px | 500–650 | 1.3 |

### Regras

- Headings grandes, curtos e com quebras intencionais.
- Corpo de texto com largura máxima aproximada de 60–70 caracteres.
- Não usar caixa alta em blocos longos.
- Caixa alta é permitida apenas em eyebrow, categoria ou microcopy editorial com tracking maior.
- Priorizar números tabulares somente quando houver métricas.

---

## 6. Forma, espaçamento e profundidade

### Grid

- Desktop principal: 12 colunas.
- Largura de conteúdo: até 1440px.
- Margens laterais: 32–48px em desktop.
- Gutter: 20–24px.
- Sidebar: 232–264px.
- Barra superior: 64–76px.

### Escala de espaçamento

Usar múltiplos consistentes:

`4, 8, 12, 16, 24, 32, 48, 64, 96`.

Evitar valores aleatórios, salvo ajuste óptico evidente.

### Raios

| Elemento | Raio recomendado |
|---|---:|
| Botão pequeno | 10–12px |
| Botão principal | 14–18px |
| Input | 12–14px |
| Card comum | 18–22px |
| Card de destaque | 24–32px |
| Painel/hero | 32–40px |
| Pill/status | 999px |

### Bordas

- Padrão: 1px sólida `#DCDDD5`.
- Bordas fortes somente em seleção, foco ou dropzone.
- Evitar contornos pretos pesados em todos os cards.

### Sombras

Sombras devem ser suaves e raras:

```css
--shadow-sm: 0 4px 16px rgba(11, 43, 32, 0.06);
--shadow-md: 0 14px 40px rgba(11, 43, 32, 0.10);
--shadow-float: 0 24px 70px rgba(11, 43, 32, 0.14);
```

Objetos 3D podem usar sombra de contato mais perceptível para parecerem apoiados no espaço.

---

## 7. Componentes essenciais

Criar componentes reutilizáveis em vez de duplicar markup.

### Navegação lateral

- Fundo verde profundo.
- Marca provisória no topo.
- Itens com ícone + label.
- Item ativo em lima suave ou superfície clara esverdeada.
- Seções principais: Início, Meus produtos, Capturar, Publicações, Estatísticas e Integrações.
- Ajuda e Configurações fixadas na parte inferior.
- Perfil/empresa no rodapé da sidebar.

### Header interno

- Título ou saudação à esquerda.
- Busca no centro ou canto direito.
- Notificações e avatar.
- Não ocupar altura excessiva.

### Botões

**Primário:** fundo lima, texto verde quase preto, ícone opcional, hover mais escuro e leve elevação.

**Secundário:** fundo claro, borda neutra, texto escuro.

**Tecnologia/AR:** azul-cobalto, usado com moderação.

**Destrutivo:** inicialmente outline vermelho; preenchimento apenas em confirmação.

Estados obrigatórios: default, hover, focus-visible, pressed, disabled e loading.

### Cards de produto

- Imagem ou render ocupando 55–65% do card.
- Fundo de imagem claro e controlado.
- Nome do produto.
- Categoria ou formatos disponíveis: `3D · AR · Web`.
- Status com texto + ícone.
- Menu de contexto.
- Hover com elevação discreta e pequena reação do objeto, sem exagero.

### Status

- Rascunho.
- Enviando.
- Processando.
- Revisão necessária.
- Pronto para publicar.
- Publicado.
- Erro.

Cada status deve ter texto, ícone e cor própria. A forma visual deve continuar compreensível em escala de cinza.

### Inputs

- Labels sempre visíveis.
- Placeholder apenas como exemplo, nunca substituindo label.
- Altura mínima de 44px.
- Estado de foco claro.
- Mensagem de erro específica e próxima ao campo.

### Dropzone

- Área ampla com contorno tracejado azul ou verde.
- Ícone simples de upload.
- Texto principal: “Arraste seus arquivos aqui”.
- Texto secundário: “ou clique para selecionar”.
- Ações alternativas: “Usar câmera”, “Enviar fotos”, “Enviar vídeo”.
- Informar formatos e limite quando forem conhecidos pelo sistema.

### Tooltips e ajuda

- Explicar termos de forma curta.
- Preferir ajuda contextual a longas páginas de documentação.
- Incluir dicas de captura quando melhorarem o resultado.

---

## 8. Arquitetura das telas

### 8.1 Landing page comercial

Objetivo: convencer empresas de que a plataforma gera valor, não apenas mostrar tecnologia.

#### Hero

- Navegação superior simples.
- Headline: **“Transforme produtos reais em experiências 3D”**.
- Subtexto: **“Digitalize, enriqueça e compartilhe seus produtos em poucos passos.”**
- CTA principal: **“Criar meu primeiro modelo”**.
- CTA secundário opcional: **“Ver demonstração”**.
- Objeto 3D grande, inclinado e visualmente realista.
- Pequena anotação editorial ou seta desenhada pode humanizar a composição.
- Três provas rápidas: “Mais compreensão”, “Experiência premium” e “Pronto para compartilhar”.

#### Seções futuras, não obrigatórias no primeiro preview

- Como funciona em três passos.
- Casos de uso por setor.
- Comparação antes/depois.
- Demonstração interativa.
- Integrações.
- CTA final.

### 8.2 Dashboard — Início

Esta é a principal tela do preview.

#### Estrutura

- Sidebar fixa.
- Saudação: “Olá, [nome]”.
- Complemento: “Seus produtos, em novas dimensões.”
- Botão “Novo produto” claramente visível.
- Grade com três produtos demonstrativos de setores diferentes.
- Atividade recente.
- Card de orientação ou insight, sem gráficos desnecessários.

#### Produtos de demonstração

- Caneca Origens — Publicado.
- Cadeira Horizonte — Processando.
- Tênis Fluxo — Publicado.

Usar dados realistas e consistentes, não lorem ipsum.

### 8.3 Novo produto — captura e upload

#### Progressão

1. Captura.
2. Processamento.
3. Publicação.

#### Conteúdo

- Título: “Adicione seu produto”.
- Dropzone principal.
- Opções de câmera, fotos e vídeo.
- Dica contextual: “Fotografe o produto de diferentes ângulos para obter um resultado melhor.”
- Área opcional com requisitos de boa captura.

Não implementar câmera real nesta rodada. Os controles podem demonstrar a experiência e abrir estados simulados.

### 8.4 Processamento

Objetivo: transformar espera em confiança.

#### Conteúdo

- Fundo verde profundo.
- Produto central parcialmente em wireframe e parcialmente renderizado.
- Anéis orbitais ou pontos de análise discretos.
- Percentual grande, por exemplo 68%.
- Headline: “Construindo seu modelo 3D”.
- Subtexto: “Estamos transformando suas imagens em um modelo tridimensional.”
- Checklist de etapas:
  - imagens analisadas;
  - geometria sendo reconstruída;
  - texturas sendo aplicadas;
  - finalização do modelo.

No preview, o progresso pode ser estático ou simulado localmente. Não fingir que existe integração real no resumo de entrega.

### 8.5 Editor e visualizador 3D

#### Estrutura desktop

- Cabeçalho com voltar, nome do produto, status, compartilhar e publicar.
- Barra vertical de ferramentas à esquerda.
- Canvas 3D amplo no centro.
- Painel de propriedades à direita.

#### Ferramentas

- Visualizar.
- Materiais.
- Hotspots.
- Ambiente.
- Medidas.

Nesta rodada, apenas “Visualizar” precisa estar completamente representado. As demais podem existir visualmente e indicar “em breve” ou abrir painéis simples.

#### Canvas

- Fundo claro com grid espacial muito sutil.
- Sombra de contato.
- Controle de rotação 360°.
- Orbit controls existentes, caso já estejam implementados.
- Botões pequenos para resetar câmera, tela cheia e ajuda.
- Nunca esconder o objeto atrás de painéis.

#### Painel de propriedades

- Abas: Produto, Aparência e Interações.
- Campos: nome, categoria, descrição, tags e dimensões.
- Botão salvar ou salvamento automático claramente indicado.

### 8.6 Página pública do produto

Objetivo: atender o consumidor final do cliente.

- Marca do cliente em posição discreta.
- Produto 3D como protagonista.
- Nome e descrição curta.
- Interação por arraste e zoom.
- Botão “Ver em realidade aumentada” reservado para quando o recurso existir.
- Informações essenciais e hotspots.
- Compartilhar.
- Sem sidebar administrativa.
- Sem excesso de campos ou métricas.

---

## 9. Interações e movimento

Movimento deve comunicar dimensão, progresso e resposta.

### Princípios

- Feedback imediato ao clique.
- Transições curtas em ações comuns.
- Animações maiores apenas na entrada do produto 3D e no processamento.
- Respeitar `prefers-reduced-motion`.
- Não bloquear interação enquanto animações decorativas terminam.

### Durações

| Tipo | Duração |
|---|---:|
| Hover/press | 120–180ms |
| Painel, modal ou tab | 200–280ms |
| Entrada de card | 280–420ms |
| Entrada de objeto 3D | 500–800ms |
| Loop de processamento | contínuo, lento e discreto |

### Curvas

- Padrão: `cubic-bezier(0.2, 0.8, 0.2, 1)`.
- Evitar bounce exagerado.
- Um leve overshoot pode aparecer apenas em sucesso ou conclusão.

### Microinterações úteis

- Botão primário reage 1–2px no eixo Y.
- Card de produto eleva e o objeto gira poucos graus.
- Upload confirma arquivo com check e nome.
- Checklist do processamento acende por etapa.
- Ao publicar, mostrar confirmação clara e link compartilhável.

---

## 10. Responsividade

### Decisão desta fase

Implementar primeiro o desktop com qualidade. Entretanto, componentes não podem depender de medidas rígidas que tornem o mobile impossível.

### Breakpoints sugeridos

- Mobile: até 767px.
- Tablet: 768–1099px.
- Desktop: 1100px ou mais.

### Comportamentos futuros

- Sidebar vira drawer no mobile.
- Grade de produtos: 3 colunas → 2 colunas → 1 coluna.
- Editor desktop com três áreas vira canvas primeiro e painel em bottom sheet ou abas.
- A página pública prioriza o visualizador, com informações abaixo.
- Alvos de toque devem ter no mínimo 44 × 44px.

Na primeira rodada, é suficiente garantir que o preview não quebre gravemente abaixo de 1100px. O refinamento mobile completo vem depois da aprovação do design desktop.

---

## 11. Conteúdo e voz da interface

### Tom

- direto;
- humano;
- confiante;
- didático sem infantilizar;
- orientado a resultado;
- sem jargões desnecessários.

### Exemplos aprovados

- “Adicione seu produto.”
- “Fotografe de diferentes ângulos.”
- “Construindo seu modelo 3D.”
- “Seu produto está pronto para revisão.”
- “Publique e compartilhe em poucos cliques.”
- “Seus produtos, em novas dimensões.”

### Evitar

- “Revolucione o metaverso da sua marca.”
- “Solução disruptiva de última geração.”
- “Upload de dataset fotogramétrico.”
- Promessas de precisão ou automação que ainda não foram validadas.

---

## 12. Direção dos objetos e imagens

- Produtos isolados com iluminação de estúdio suave.
- Sombras realistas e controladas.
- Fundos claros, quentes e pouco ruidosos.
- Misturar categorias para provar que a solução não é exclusiva para alimentos.
- No dashboard, usar caneca, cadeira e tênis como demonstração inicial.
- O objeto deve ocupar área suficiente para ser reconhecido imediatamente.
- Evitar bancos de imagens genéricos de pessoas em escritórios.
- Evitar renders plásticos ou excessivamente perfeitos.

Se não existirem assets para cadeira e tênis, usar placeholders visuais simples e honestos no preview, sem instalar geradores ou buscar assets externos automaticamente.

---

## 13. Pipeline futuro de criação 3D

Esta seção orienta arquitetura futura, não precisa ser implementada agora.

### Entrada

- sequência de fotos;
- vídeo em 360 graus;
- futuramente captura guiada no celular;
- modelo 3D enviado diretamente pelo cliente.

### Processamento conceitual

1. Upload seguro.
2. Validação de quantidade, qualidade e cobertura das imagens.
3. Extração de quadros quando a entrada for vídeo.
4. Reconstrução de geometria.
5. Geração e aplicação de textura.
6. Otimização para web.
7. Conversão para formato de entrega, preferencialmente GLB/glTF na web.
8. Revisão humana ou assistida.
9. Publicação.

### Observação de produto

Não prometer que uma única foto sempre gera um modelo comercial fiel. Objetos reflexivos, transparentes, lisos ou com partes muito finas exigem mais cuidado. A experiência deve orientar o usuário a capturar material suficiente.

---

## 14. Requisitos de desempenho e qualidade

- Preservar carregamento rápido do shell da aplicação.
- Fazer lazy loading do visualizador 3D quando possível.
- Não carregar vários modelos pesados simultaneamente no dashboard.
- Cards do dashboard podem usar thumbnails estáticas; o 3D completo abre no editor.
- Evitar vídeos automáticos pesados no preview inicial.
- Não adicionar bibliotecas de animação se CSS ou dependências existentes resolverem.
- Não duplicar bibliotecas 3D.
- Tratar estados de loading, vazio e erro.
- Garantir foco visível para teclado.
- Adicionar `aria-label` a botões somente com ícone.
- Usar HTML semântico.
- Não introduzir erros no console.

### Critérios mínimos de validação

- O projeto inicia com o comando já definido no `package.json`.
- A rota principal abre sem erro.
- Navegação entre telas do preview funciona.
- O visualizador existente, se houver, continua funcionando.
- Não existem imports quebrados.
- Não há overflow horizontal no viewport desktop.
- Os estados simulados estão claramente separados de integrações reais.
- O design é coerente entre todas as telas.

---

## 15. Estratégia de implementação com economia de tokens

### Fase 0 — Auditoria curta

Ler apenas os arquivos necessários para compreender:

- stack;
- entrada da aplicação;
- rotas;
- estilos;
- componentes principais;
- visualizador 3D;
- scripts.

Evitar mapear `node_modules`, arquivos gerados ou pastas irrelevantes.

### Fase 1 — Preview desktop de alta fidelidade

Implementar:

- design tokens;
- app shell;
- sidebar e header;
- dashboard;
- fluxo de novo produto;
- estado de processamento;
- editor/visualizador;
- dados mockados centralizados.

Esta é a fase atual.

### Fase 2 — Ajuste responsivo

Somente depois da aprovação visual:

- tablet;
- mobile;
- drawer;
- bottom sheet do editor;
- página pública mobile.

### Fase 3 — Fluxo funcional

- upload real;
- persistência;
- jobs de processamento;
- estados reais;
- autenticação.

### Fase 4 — Captura e AR

- câmera;
- captura guiada;
- HTTPS e permissões;
- realidade aumentada;
- validação em aparelhos reais.

### Regra de parada

Não avançar automaticamente para uma nova fase. Entregar a Fase 1 para aprovação antes de implementar integrações caras ou arquitetura definitiva.

---

## 16. Sugestão de estrutura de frontend

Adaptar ao framework existente; não impor esta estrutura se o projeto já tiver convenções melhores.

```text
src/
  components/
    app-shell/
    buttons/
    cards/
    forms/
    status/
    viewer/
  pages-or-routes/
    landing/
    dashboard/
    new-product/
    processing/
    product-editor/
    public-product/
  data/
    demo-products.*
  styles/
    tokens.*
    globals.*
```

### Dados mockados

Centralizar produtos e atividades em um único arquivo para evitar repetição e facilitar substituição por API no futuro.

### Rotas sugeridas

Usar o padrão do framework existente. Conceitualmente:

- `/` — landing ou dashboard, conforme a estrutura atual;
- `/app` — dashboard;
- `/app/products/new` — novo produto;
- `/app/products/:id/processing` — processamento;
- `/app/products/:id` — editor;
- `/p/:slug` — página pública.

Para economizar implementação no preview, essas telas podem inicialmente funcionar como rotas simples ou estados internos, desde que a navegação seja demonstrável e o código permaneça organizado.

---

## 17. Referência visual descrita

O conceito visual aprovado contém:

- landing page clara com headline preta gigante à esquerda;
- caneca 3D grande e inclinada à direita;
- CTA lima em formato arredondado;
- dashboard com sidebar verde profundo;
- área principal creme/branca;
- cards de produto com fotografias claras;
- botão “Novo produto” em lima;
- tela de upload branca com progressão em três etapas;
- processamento em painel verde profundo com objeto parcialmente em wireframe;
- editor com canvas central, ferramentas à esquerda e propriedades à direita;
- página pública mobile com produto central e botão azul para AR;
- tipografia sans-serif forte, com uso editorial pontual;
- linhas técnicas discretas, anotações humanas e profundidade suave.

A referência serve como **direção**, não como composição rígida. Ajustar ao conteúdo real e à arquitetura existente sem perder a personalidade visual.

---

## 18. Definição de pronto para esta rodada

A rodada está pronta quando existir um preview que permita avaliar, com clareza:

1. como uma empresa encontra seus produtos;
2. como inicia um novo cadastro;
3. como percebe que o modelo está sendo processado;
4. como revisa e publica o objeto;
5. como o objeto se torna a parte central da experiência;
6. como o sistema transmite tecnologia, confiança e simplicidade.

O resultado deve parecer um produto real em construção — não um conjunto de wireframes, não um template genérico e não uma demonstração técnica isolada de Three.js.

---

## 19. Comando final para o Claude Code

Depois de ler este documento e os arquivos essenciais do projeto:

> Audite a implementação atual, preserve tudo que já funciona e execute somente a Fase 1. Construa um preview desktop de alta fidelidade seguindo integralmente o sistema visual e a arquitetura descritos aqui. Reutilize o visualizador 3D e as dependências existentes sempre que possível. Não implemente backend, câmera, reconstrução por IA ou AR real nesta rodada. Use dados de demonstração centralizados, navegação funcional e estados simulados honestos. Valide o projeto no final e entregue um resumo objetivo com arquivos alterados, rota do preview, recursos funcionais, simulações e próximos passos.

