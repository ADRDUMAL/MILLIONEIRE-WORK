# Forma 3D — Cardápio 3D/AR para restaurantes

<img src="LOGO FORMA 3D.png" alt="Forma 3D" width="220">

Plataforma em que o restaurante fotografa (ou filma) os pratos pelo celular, o modelo 3D é gerado e revisado, e o cliente final abre um QR Code na mesa para ver o cardápio, girar o prato em 3D e visualizá-lo em realidade aumentada.

O projeto tem duas frentes no mesmo servidor:

| Frente | Rotas | Situação |
| --- | --- | --- |
| **Beta de restaurantes** (cardápio 3D/AR) | `/app` (restaurante), `/admin` (sócios), `/m/<slug>` (cliente) | Funcional: cadastro, captura de fotos, fila de revisão, geração 3D (Tripo) ou upload manual, publicação e QR permanente |
| **Forma 3D Studio** (plataforma B2B genérica, nome provisório) | `/`, `/studio/*`, `/p/<slug>` | Preview com fluxo local; reconstrução real via KIRI Engine (desligada por padrão) e captura guiada pela câmera |

## Estrutura do repositório

```
.
├── LOGO FORMA 3D.png          # logotipo
├── pot it.webp                # imagem de referência
├── .claude/launch.json        # atalhos para subir o app (npm start / dev:safe)
└── cardapio-3d-ar/            # aplicação (Node + Express + SQLite)
    ├── README.md                       # documentação técnica completa
    ├── FORMA3D_PRODUCT_DESIGN_SPEC.md  # especificação de produto/UX do Forma 3D
    ├── REDESIGN_LOG.md                 # histórico das fases do redesign
    ├── src/        # servidor, rotas, banco, integrações (Tripo, KIRI)
    ├── public/     # front-end (cardápio, studio, scanner pela câmera)
    ├── scripts/    # seed, backup, QR, certificado HTTPS, testes KIRI
    ├── samples/    # modelos GLB de demonstração
    └── test/       # testes automatizados (node --test)
```

## Stack

Node ≥ 22.13 · Express 5 · SQLite embutido do Node (`node:sqlite`) · disco local · `@google/model-viewer` para 3D/AR. Um único processo, quatro dependências; roda em qualquer VPS/container com volume (`Dockerfile` incluído). Vercel/serverless **não** serve: falta disco persistente.

## Começar

```bash
cd cardapio-3d-ar
npm install
npm run seed:demo   # admin + 2 restaurantes de teste
npm start           # http://localhost:3000
npm test            # 53 testes, sem consumir créditos de APIs
```

Contas de demonstração: `admin@demo.local / admin12345`, `dono-a@demo.local / demo12345`.

## Fases do produto

1. **Beta de restaurantes**: captura guiada em 4 ângulos, revisão por admin, geração 3D (Tripo, ≈ US$ 0,30 por tentativa) ou modelo manual, calibração pela largura real, AR (Scene Viewer / Quick Look).
2. **Fase 1–2**: preview visual do Forma 3D Studio (desktop e responsivo).
3. **Fase 3A**: assistente de novo produto (fotos, vídeo 360°, GLB pronto).
4. **Fase 3B**: reconstrução real server-side com KIRI Engine (`FORMA_REAL_PROCESSING_ENABLED=1`).
5. **Fase 4**: captura guiada pela câmera do celular (exige HTTPS).

Detalhes de cada fase, variáveis de ambiente, segurança, deploy e custos estão em [`cardapio-3d-ar/README.md`](cardapio-3d-ar/README.md).

## Configuração

Chaves de API (`TRIPO_API_KEY`, `KIRI_API_KEY`) ficam **somente** no arquivo `.env` local, nunca no repositório, que é público. Use `cardapio-3d-ar/.env.example` como modelo.
