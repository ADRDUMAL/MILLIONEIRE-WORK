import { parseCookies } from '../auth.js';

// Mensagem única entre redirecionamentos, via cookie curto (sem sessão de servidor).
export function setFlash(res, type, text) {
  const v = Buffer.from(JSON.stringify({ type, text })).toString('base64url');
  res.appendHeader('Set-Cookie', `flash=${v}; Path=/; HttpOnly; SameSite=Lax; Max-Age=60`);
}
export function readFlash(req, res) {
  const v = parseCookies(req.headers.cookie).flash;
  if (!v) return null;
  res.appendHeader('Set-Cookie', 'flash=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  try { return JSON.parse(Buffer.from(v, 'base64url').toString('utf8')); } catch { return null; }
}
export function redirectWith(res, url, type, text) { setFlash(res, type, text); res.redirect(url); }
