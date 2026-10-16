// Gera um QR (PNG) para abrir uma URL no celular. Uso: npm run qr -- https://url-do-preview
import fs from 'node:fs';
import QRCode from 'qrcode';
const url = process.argv[2];
if (!url) { console.error('Uso: npm run qr -- <url>'); process.exit(1); }
const file = process.argv[3] || 'preview-qr.png';
await QRCode.toFile(file, url, { width: 512, margin: 2 });
console.log(await QRCode.toString(url, { type: 'terminal', small: true }));
console.log(`${url}\nPNG salvo em ${fs.realpathSync(file)}`);
