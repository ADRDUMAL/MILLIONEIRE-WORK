// Leitor de ZIP mínimo e defensivo (sem dependências) para extrair o GLB do pacote do KIRI.
// Só suporta os métodos "stored" (0) e "deflate" (8), sem zip64 nem criptografia — o suficiente
// para o pacote de resultado, e nada além disso. Protege contra zip-slip validando cada nome.
import zlib from 'node:zlib';

const SIG_EOCD = 0x06054b50, SIG_CDIR = 0x02014b50, SIG_LOCAL = 0x04034b50;
const MAX_ENTRIES = 500;

export function isZip(buf) {
  return Buffer.isBuffer(buf) && buf.length > 22 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
}

// Nome seguro: relativo, sem "..", sem barra invertida, sem letra de unidade, sem bytes nulos.
export function isSafeEntryName(name) {
  if (typeof name !== 'string' || !name || name.length > 512) return false;
  if (name.includes('\0') || name.includes('\\')) return false;
  if (name.startsWith('/') || /^[a-zA-Z]:/.test(name)) return false;
  return !name.split('/').some((seg) => seg === '..' || seg === '');
}

export function listEntries(buf) {
  if (!isZip(buf)) throw new Error('O pacote baixado não é um arquivo ZIP');
  // EOCD fica nos últimos 22 bytes + comentário (até 65535).
  const min = Math.max(0, buf.length - 65557);
  let eocd = -1;
  for (let i = buf.length - 22; i >= min; i--) { if (buf.readUInt32LE(i) === SIG_EOCD) { eocd = i; break; } }
  if (eocd < 0) throw new Error('ZIP sem diretório central');
  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (count > MAX_ENTRIES) throw new Error(`ZIP com entradas demais (${count})`);
  if (cdOffset === 0xffffffff || cdOffset + cdSize > buf.length) throw new Error('ZIP zip64 ou diretório central inválido');
  const entries = [];
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== SIG_CDIR) throw new Error('Entrada do diretório central corrompida');
    const flags = buf.readUInt16LE(p + 8), method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16), compSize = buf.readUInt32LE(p + 20), size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    entries.push({ name, flags, method, crc, compSize, size, localOffset, safe: isSafeEntryName(name), directory: name.endsWith('/') });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

export function extractEntry(buf, entry, { maxBytes } = {}) {
  if (!entry.safe) throw new Error(`Nome de arquivo inseguro no ZIP: ${JSON.stringify(entry.name)}`);
  if (entry.flags & 0x1) throw new Error('ZIP criptografado não é aceito');
  if (entry.size === 0xffffffff || entry.compSize === 0xffffffff) throw new Error('Entradas zip64 não são aceitas');
  if (maxBytes && entry.size > maxBytes) throw new Error(`Arquivo no ZIP excede ${(maxBytes / 1e6).toFixed(0)} MB`);
  const lo = entry.localOffset;
  if (lo + 30 > buf.length || buf.readUInt32LE(lo) !== SIG_LOCAL) throw new Error('Cabeçalho local do ZIP corrompido');
  const nameLen = buf.readUInt16LE(lo + 26), extraLen = buf.readUInt16LE(lo + 28);
  const start = lo + 30 + nameLen + extraLen;
  if (start + entry.compSize > buf.length) throw new Error('Dados do ZIP truncados');
  const raw = buf.subarray(start, start + entry.compSize);
  let out;
  if (entry.method === 0) out = Buffer.from(raw);
  else if (entry.method === 8) out = zlib.inflateRawSync(raw, { maxOutputLength: maxBytes || undefined });
  else throw new Error(`Método de compressão ${entry.method} não suportado`);
  if (out.length !== entry.size) throw new Error('Tamanho extraído não confere com o ZIP');
  if ((zlib.crc32(out) >>> 0) !== (entry.crc >>> 0)) throw new Error('CRC do arquivo no ZIP não confere');
  return out;
}

// Encontra o primeiro .glb (ignorando diretórios e nomes inseguros — estes derrubam a extração).
export function findGlbEntry(entries) {
  const unsafe = entries.find((e) => !e.safe);
  if (unsafe) throw new Error(`ZIP contém caminho inseguro: ${JSON.stringify(unsafe.name)}`);
  return entries.find((e) => !e.directory && /\.glb$/i.test(e.name)) || null;
}

// Utilitário para testes e ferramentas: monta um ZIP "stored" a partir de { nome: Buffer }.
export function buildStoredZip(files) {
  const locals = [], centrals = []; let offset = 0;
  for (const [name, data] of Object.entries(files)) {
    const nameBuf = Buffer.from(name, 'utf8'); const crc = zlib.crc32(data) >>> 0;
    const lh = Buffer.alloc(30); lh.writeUInt32LE(SIG_LOCAL, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6); lh.writeUInt16LE(0, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nameBuf.length, 26); lh.writeUInt16LE(0, 28);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(SIG_CDIR, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0, 8); ch.writeUInt16LE(0, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, nameBuf, data); centrals.push(ch, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(SIG_EOCD, 0); eocd.writeUInt16LE(centrals.length / 2, 8); eocd.writeUInt16LE(centrals.length / 2, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}
