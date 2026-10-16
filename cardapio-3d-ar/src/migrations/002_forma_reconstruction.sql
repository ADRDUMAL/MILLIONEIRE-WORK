-- Forma 3D · Fase 3B: tarefas de reconstrução 3D server-side (KIRI Engine) e seus arquivos.
-- Tabelas isoladas: não referenciam restaurantes, pratos ou usuários do beta.

CREATE TABLE forma_reconstruction_jobs (
  id               TEXT PRIMARY KEY,                 -- id interno (frj_...), o único que o navegador vê
  client_key       TEXT UNIQUE,                      -- chave de idempotência enviada pelo navegador (clique duplo)
  product_id       TEXT,                             -- id do produto no navegador (informativo)
  provider         TEXT NOT NULL,                    -- 'kiri'
  method           TEXT NOT NULL,                    -- 'photos' | 'video'
  provider_ref     TEXT,                             -- "serialize" devolvido pelo KIRI; nunca vai ao navegador
  status           TEXT NOT NULL,                    -- uploading|queued|processing|done|error|expired|cancelled
  provider_status  INTEGER,                          -- status bruto do KIRI (-1,0,1,2,3,4)
  stage            TEXT,                             -- texto curto de progresso (sem percentual inventado)
  error_message    TEXT,
  file_count       INTEGER NOT NULL DEFAULT 0,
  bytes            INTEGER NOT NULL DEFAULT 0,
  options_json     TEXT,
  poll_attempts    INTEGER NOT NULL DEFAULT 0,
  poll_errors      INTEGER NOT NULL DEFAULT 0,
  next_poll_at     TEXT,
  last_polled_at   TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  finished_at      TEXT
);
CREATE INDEX idx_forma_jobs_status ON forma_reconstruction_jobs (status);

CREATE TABLE forma_reconstruction_assets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id      TEXT NOT NULL REFERENCES forma_reconstruction_jobs(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,                         -- 'model' (GLB extraído) | 'zip' (pacote baixado)
  rel_path    TEXT NOT NULL,                         -- relativo a DATA_DIR/forma
  bytes       INTEGER NOT NULL,
  bbox_json   TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_forma_assets_job ON forma_reconstruction_assets (job_id, kind);
