// Inspeção leve de vídeo MP4/MOV (ISO BMFF) sem ffmpeg: duração (mvhd) e dimensões (tkhd).
// Lê só os cabeçalhos das caixas pelo descritor de arquivo — não carrega o vídeo na memória.
// Quando não consegue confirmar (WebM, arquivo truncado, caixa moov ausente) devolve confirmed=false
// e a interface avisa em vez de inventar um valor.
import fs from 'node:fs';

const MAX_MOOV = 32 * 1024 * 1024;

export function isMp4Like(head) {
  return Buffer.isBuffer(head) && head.length >= 12 && head.subarray(4, 8).toString('ascii') === 'ftyp';
}

function readAt(fd, offset, length) {
  const buf = Buffer.alloc(length);
  const n = fs.readSync(fd, buf, 0, length, offset);
  return buf.subarray(0, n);
}

// Percorre caixas de um buffer em memória (moov e filhos).
function walk(buf, start, end, visit) {
  let p = start;
  while (p + 8 <= end) {
    let size = buf.readUInt32BE(p); const type = buf.subarray(p + 4, p + 8).toString('latin1'); let hdr = 8;
    if (size === 1) { if (p + 16 > end) break; size = Number(buf.readBigUInt64BE(p + 8)); hdr = 16; }
    if (size === 0) size = end - p;
    if (size < hdr || p + size > end) break;
    visit(type, p + hdr, p + size);
    p += size;
  }
}

export function probeMp4(filePath) {
  const out = { durationSeconds: null, width: null, height: null, confirmed: false, container: 'unknown', codec: null, brand: null };
  let fd = null;
  try {
    fd = fs.openSync(filePath, 'r');
    const total = fs.fstatSync(fd).size;
    const head = readAt(fd, 0, 12);
    if (!isMp4Like(head)) return out;
    out.container = 'mp4';
    out.brand = head.subarray(8, 12).toString('latin1').trim() || null; // 'qt' = MOV do iPhone, 'isom'/'mp42' = MP4
    let off = 0;
    while (off + 8 <= total) {
      const h = readAt(fd, off, 16);
      if (h.length < 8) break;
      let size = h.readUInt32BE(0); const type = h.subarray(4, 8).toString('latin1'); let hdr = 8;
      if (size === 1) { size = Number(h.readBigUInt64BE(8)); hdr = 16; }
      if (size === 0) size = total - off;
      if (size < hdr) break;
      if (type === 'moov') {
        if (size > MAX_MOOV) break;
        const moov = readAt(fd, off + hdr, size - hdr);
        walk(moov, 0, moov.length, (t, s, e) => {
          if (t === 'mvhd') {
            const v = moov[s];
            const timescale = v === 1 ? moov.readUInt32BE(s + 20) : moov.readUInt32BE(s + 12);
            const duration = v === 1 ? Number(moov.readBigUInt64BE(s + 24)) : moov.readUInt32BE(s + 16);
            if (timescale) out.durationSeconds = duration / timescale;
          }
          if (t === 'trak') {
            // Uma trilha de vídeo tem handler 'vide' (mdia/hdlr); o codec é o 1º registro de mdia/minf/stbl/stsd.
            let handler = null, codec = null, tw = 0, th = 0;
            const dive = (a, b) => walk(moov, a, b, (t2, s2, e2) => {
              if (t2 === 'tkhd') {
                const v = moov[s2];
                tw = moov.readUInt32BE(s2 + (v === 1 ? 88 : 76)) / 65536;
                th = moov.readUInt32BE(s2 + (v === 1 ? 92 : 80)) / 65536;
              } else if (t2 === 'hdlr' && s2 + 12 <= e2) handler = moov.subarray(s2 + 8, s2 + 12).toString('latin1');
              else if (t2 === 'stsd' && s2 + 16 <= e2) codec = moov.subarray(s2 + 12, s2 + 16).toString('latin1');
              else if (['mdia', 'minf', 'stbl'].includes(t2)) dive(s2, e2);
            });
            dive(s, e);
            const isVideo = handler ? handler === 'vide' : tw > 0 && th > 0;
            if (isVideo && tw > 0 && th > 0 && (out.width == null || tw * th > out.width * out.height)) {
              out.width = Math.round(tw); out.height = Math.round(th); out.codec = codec;
            }
          }
        });
        break;
      }
      off += size;
    }
    out.confirmed = out.durationSeconds != null && out.width != null && out.height != null;
    return out;
  } catch {
    return out;
  } finally {
    if (fd != null) fs.closeSync(fd);
  }
}
