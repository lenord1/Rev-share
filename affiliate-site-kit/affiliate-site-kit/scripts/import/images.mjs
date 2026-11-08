// 圖片下載：以檔頭判斷真正格式（不信 Content-Type）、讀尺寸、去重、寫入 src/assets/products/。
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export function sniffImage(buf) {
  if (buf.length < 16) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    let i = 2, w = null, h = null;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1];
      if (m === 0xff) { i++; continue; }
      if (m === 0x01 || (m >= 0xd0 && m <= 0xd9)) { i += 2; continue; }
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) { h = buf.readUInt16BE(i + 5); w = buf.readUInt16BE(i + 7); break; }
      i += 2 + buf.readUInt16BE(i + 2);
    }
    return { ext: 'jpg', mime: 'image/jpeg', width: w, height: h };
  }
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { ext: 'png', mime: 'image/png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const t = buf.toString('ascii', 12, 16);
    let w = null, h = null;
    if (t === 'VP8 ' && buf.length >= 30) { w = buf.readUInt16LE(26) & 0x3fff; h = buf.readUInt16LE(28) & 0x3fff; }
    else if (t === 'VP8L' && buf.length >= 25) { const b = buf.readUInt32LE(21); w = (b & 0x3fff) + 1; h = ((b >> 14) & 0x3fff) + 1; }
    else if (t === 'VP8X' && buf.length >= 30) { w = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16)); h = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16)); }
    return { ext: 'webp', mime: 'image/webp', width: w, height: h };
  }
  if (buf.toString('ascii', 4, 12) === 'ftypavif') return { ext: 'avif', mime: 'image/avif', width: null, height: null };
  return null; // GIF、SVG 等一律不收
}

/** 儲存一張已在記憶體中的圖片；回傳登記用的紀錄。 */
export function saveImage({ buf, destDir, baseName, index, sourceUrl, pageUrl, fetchedAt, minSide = 300 }) {
  const info = sniffImage(buf);
  if (!info) return { skipped: '不是 JPEG／PNG／WebP／AVIF（GIF、SVG 不收）' };
  if (info.width && info.height && Math.min(info.width, info.height) < minSide) return { skipped: `尺寸太小（${info.width}×${info.height}，至少 ${minSide}px）` };
  const sha256 = createHash('sha256').update(buf).digest('hex');
  const file = `${baseName}-${index}.${info.ext}`;
  fs.mkdirSync(destDir, { recursive: true });
  fs.writeFileSync(path.join(destDir, file), buf);
  return { image: { file, sourceUrl, pageUrl, fetchedAt, sha256, bytes: buf.length, width: info.width, height: info.height, mime: info.mime } };
}

export async function downloadImages({ urls, fetcher, destDir, baseName, pageUrl, fetchedAt, max = 3, minSide = 300, maxBytes = 8 * 1024 * 1024 }) {
  const images = [];
  const skipped = [];
  const seen = new Set();
  for (const url of urls) {
    if (images.length >= max) break;
    try {
      const r = await fetcher.get(url, { accept: 'image/avif,image/webp,image/png,image/jpeg,*/*;q=0.5', maxBytes });
      const sha = createHash('sha256').update(r.body).digest('hex');
      if (seen.has(sha)) { skipped.push({ url, reason: '與已下載的圖片重複' }); continue; }
      const out = saveImage({ buf: r.body, destDir, baseName, index: images.length + 1, sourceUrl: url, pageUrl, fetchedAt, minSide });
      if (out.skipped) { skipped.push({ url, reason: out.skipped }); continue; }
      seen.add(sha);
      images.push(out.image);
    } catch (e) {
      skipped.push({ url, reason: e?.message ?? String(e) });
    }
  }
  return { images, skipped };
}
