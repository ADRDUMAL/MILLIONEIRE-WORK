import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';

// Detecta tipo real pelos primeiros bytes; nunca confia no mimetype do cliente.
export function sniffImage(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: 'png' };
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  return null;
}
export function isGlb(buf) {
  return buf.length > 20 && buf.subarray(0, 4).toString('ascii') === 'glTF' && buf.readUInt32LE(4) === 2;
}
// USDZ é um zip sem compressão; validamos só a assinatura zip.
export function isUsdz(buf) {
  return buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
}

// Dimensões sem decodificar a imagem (JPEG SOF, PNG IHDR, WebP VP8/VP8L/VP8X).
export function imageSize(buf, mime) {
  try {
    if (mime === 'image/png') return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    if (mime === 'image/jpeg') {
      let i = 2;
      while (i < buf.length) {
        if (buf[i] !== 0xff) { i++; continue; }
        const marker = buf[i + 1];
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
        const len = buf.readUInt16BE(i + 2);
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
        }
        i += 2 + len;
      }
    }
    if (mime === 'image/webp') {
      const chunk = buf.subarray(12, 16).toString('ascii');
      if (chunk === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
      if (chunk === 'VP8L') { const b = buf.readUInt32LE(21); return { width: 1 + (b & 0x3fff), height: 1 + ((b >> 14) & 0x3fff) }; }
      if (chunk === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    }
  } catch { /* ignora */ }
  return { width: null, height: null };
}

export const randomName = (ext) => `${crypto.randomBytes(12).toString('hex')}.${ext}`;

// Grava dentro de baseDir sem permitir escapar do diretório.
export function writeUnder(baseDir, relPath, buf) {
  const abs = path.resolve(baseDir, relPath);
  if (!abs.startsWith(path.resolve(baseDir) + path.sep)) throw new Error('Caminho inválido');
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buf);
  return abs;
}
export function resolveUnder(baseDir, relPath) {
  const abs = path.resolve(baseDir, relPath);
  if (!abs.startsWith(path.resolve(baseDir) + path.sep)) return null;
  return abs;
}
export function removeQuiet(abs) { try { if (abs) fs.rmSync(abs, { force: true }); } catch { /* ignora */ } }

export function memoryUpload(maxBytes, maxFiles = 5) {
  return multer({ storage: multer.memoryStorage(), limits: { fileSize: maxBytes, files: maxFiles, fields: 30 } });
}
