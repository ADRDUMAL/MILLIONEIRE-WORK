-- Forma 3D · Captura V2: falhas explicáveis e nova tentativa sem reenvio.
-- error_code: código técnico estável (ex.: KIRI_AUTH, UPLOAD_TIMEOUT, RECONSTRUCTION_FAILED).
-- error_stage: etapa em que a falha aconteceu (upload | processing | download).
-- attempts: quantas vezes os arquivos desta tarefa foram enviados ao serviço (cada envio consome créditos).
ALTER TABLE forma_reconstruction_jobs ADD COLUMN error_code TEXT;
ALTER TABLE forma_reconstruction_jobs ADD COLUMN error_stage TEXT;
ALTER TABLE forma_reconstruction_jobs ADD COLUMN attempts INTEGER NOT NULL DEFAULT 1;
