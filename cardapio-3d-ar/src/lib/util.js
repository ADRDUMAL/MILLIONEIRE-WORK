import QRCode from 'qrcode';

export function baseUrl(req) {
  const cfg = req.app.locals.cfg;
  if (cfg.baseUrl) return cfg.baseUrl;
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  return `${proto}://${req.headers['x-forwarded-host'] || req.headers.host}`;
}
export const menuUrl = (req, restaurant) => `${baseUrl(req)}/m/${restaurant.slug}`;

export const qrPng = (text) => QRCode.toBuffer(text, { type: 'png', width: 1024, margin: 2, errorCorrectionLevel: 'M' });
export const qrSvg = (text) => QRCode.toString(text, { type: 'svg', margin: 2, errorCorrectionLevel: 'M' });

export function slugify(name) {
  return String(name).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'cardapio';
}
// "12,50" | "12.50" | "1.250,00" -> centavos
export function parsePriceCents(v) {
  let s = String(v ?? '').trim().replace(/[R$\s]/g, '');
  if (!s) return 0;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : NaN;
}
export function parseNum(v, { min = 0, max = 1e6, allowEmpty = true } = {}) {
  const s = String(v ?? '').trim().replace(',', '.');
  if (!s) return allowEmpty ? null : NaN;
  const n = Number(s);
  return Number.isFinite(n) && n >= min && n <= max ? n : NaN;
}
export const today = () => new Date().toISOString().slice(0, 10);
