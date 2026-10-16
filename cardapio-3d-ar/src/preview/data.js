// Dados de demonstração do preview (Fase 1). Único ponto de verdade para produtos, atividade e
// conta demo; substituir por consultas reais quando o fluxo funcional (Fase 3) existir.

export const ACCOUNT = {
  firstName: 'Mariana',
  name: 'Mariana Costa',
  initials: 'MC',
  company: 'Estúdio Norte',
  plan: 'Beta · convite',
};

// Status do produto no preview. `tone` é a cor; o ícone e o texto garantem leitura sem cor.
export const STATUS = {
  draft: { label: 'Rascunho', tone: 'neutral', icon: 'pencil' },
  files_added: { label: 'Arquivos adicionados', tone: 'neutral', icon: 'file' },
  uploading: { label: 'Enviando', tone: 'blue', icon: 'upload' },
  processing: { label: 'Processando', tone: 'warning', icon: 'spinner' },
  review: { label: 'Revisão necessária', tone: 'warning', icon: 'eye' },
  ready: { label: 'Pronto para publicar', tone: 'blue', icon: 'sparkle' },
  published: { label: 'Publicado', tone: 'success', icon: 'check' },
  error: { label: 'Erro', tone: 'danger', icon: 'alert' },
};

export const PRODUCTS = [
  {
    slug: 'caneca-origens',
    poster: '/static/posters/caneca-origens.png',
    name: 'Caneca Origens',
    category: 'Utilidades domésticas',
    brand: 'Estúdio Norte',
    status: 'published',
    illo: 'mug',
    model: '/static/samples/demo/caneca.glb',
    cameraOrbit: '-35deg 70deg 108%',
    description: 'Caneca de cerâmica esmaltada com alça em argila natural. Capacidade de 330 ml, própria para micro-ondas e lava-louças.',
    tags: ['cerâmica', 'esmaltada', 'feita à mão'],
    dimensions: { width: 12.8, height: 9.6, depth: 8.6 },
    materials: ['Cerâmica esmaltada', 'Argila natural'],
    hotspots: [
      { title: 'Alça em argila', text: 'Modelada à mão e queimada a 1.200 °C.', position: '0.055m 0.05m 0m' },
      { title: 'Esmalte creme', text: 'Acabamento acetinado, sem chumbo.', position: '-0.03m 0.07m 0.03m' },
    ],
    views: 1284,
    arViews: 213,
    updatedAt: '2026-09-12',
    publishedAt: '2026-09-03',
  },
  {
    slug: 'cadeira-horizonte',
    poster: '/static/posters/cadeira-horizonte.png',
    name: 'Cadeira Horizonte',
    category: 'Mobiliário',
    brand: 'Estúdio Norte',
    status: 'processing',
    progress: 68,
    illo: 'chair',
    model: '/static/samples/demo/cadeira.glb',
    cameraOrbit: '-40deg 74deg 105%',
    description: 'Cadeira de jantar com assento e encosto estofados em tecido e estrutura em carvalho maciço.',
    tags: ['carvalho', 'estofado', 'sala de jantar'],
    dimensions: { width: 46, height: 92, depth: 46 },
    materials: ['Carvalho maciço', 'Tecido 100% algodão'],
    hotspots: [
      { title: 'Estrutura em carvalho', text: 'Madeira certificada com acabamento em óleo.', position: '0.2m 0.2m 0.2m' },
    ],
    views: 0,
    arViews: 0,
    updatedAt: '2026-09-15',
    publishedAt: null,
  },
  {
    slug: 'tenis-fluxo',
    poster: '/static/posters/tenis-fluxo.png',
    name: 'Tênis Fluxo',
    category: 'Calçados',
    brand: 'Estúdio Norte',
    status: 'published',
    illo: 'sneaker',
    model: '/static/samples/demo/tenis.glb',
    cameraOrbit: '38deg 74deg 105%',
    description: 'Tênis leve para uso diário, com cabedal em malha respirável e entressola em espuma de alta resiliência.',
    tags: ['malha', 'espuma', 'unissex'],
    dimensions: { width: 30, height: 13.7, depth: 11 },
    materials: ['Malha técnica', 'Espuma EVA', 'Borracha reciclada'],
    hotspots: [
      { title: 'Entressola em espuma', text: 'Amortecimento de alta resiliência.', position: '0.02m 0.02m 0.055m' },
      { title: 'Cabedal respirável', text: 'Malha técnica com ventilação lateral.', position: '0.03m 0.09m 0.03m' },
    ],
    views: 3402,
    arViews: 786,
    updatedAt: '2026-09-10',
    publishedAt: '2026-08-28',
  },
];

export const findProduct = (slug) => PRODUCTS.find((p) => p.slug === slug) || null;

export const ACTIVITY = [
  { when: 'Hoje, 14:20', text: 'Cadeira Horizonte entrou em processamento.', product: 'cadeira-horizonte', icon: 'spinner' },
  { when: 'Hoje, 09:05', text: 'Tênis Fluxo recebeu 128 visualizações ontem.', product: 'tenis-fluxo', icon: 'eye' },
  { when: 'Ontem, 17:48', text: 'Caneca Origens foi compartilhada por link.', product: 'caneca-origens', icon: 'share' },
  { when: '12 set', text: 'Descrição da Caneca Origens atualizada.', product: 'caneca-origens', icon: 'pencil' },
];

// Etapas do processamento (texto que aparece na checklist). Percentual em que cada uma conclui.
export const PROCESSING_STEPS = [
  { label: 'Enviando imagens', done: 8 },
  { label: 'Verificando captura', done: 22 },
  { label: 'Reconstruindo geometria', done: 62 },
  { label: 'Criando textura', done: 90 },
  { label: 'Preparando modelo', done: 100 },
];

export const CAPTURE_TIPS = [
  'Luz difusa, sem sombras duras nem reflexos.',
  'Produto parado; quem se move é você, em volta dele.',
  'De 30 a 60 fotos, cada uma sobrepondo bem a anterior.',
  'Uma volta de cima e outra de baixo fecham a geometria.',
];
