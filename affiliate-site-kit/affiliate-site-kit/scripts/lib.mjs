// 共用工具：路徑、讀取設定與資料、報告輸出。零相依，僅需 Node 18+。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = process.env.SITE_ROOT
  ? path.resolve(process.env.SITE_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const p = (...parts) => path.join(ROOT, ...parts);
export const exists = (...parts) => fs.existsSync(p(...parts));
export const readText = (...parts) => fs.readFileSync(p(...parts), 'utf8');
export const readJson = (...parts) => JSON.parse(readText(...parts));

export function loadConfig() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  return JSON.parse(fs.readFileSync(path.join(scriptDir, 'config.json'), 'utf8'));
}

export function loadChannels() {
  if (!exists('src', 'data', 'channels.json')) return [];
  return readJson('src', 'data', 'channels.json').channels ?? [];
}
export const enabledChannels = () => loadChannels().filter((c) => c.enabled);
export const allowedHosts = () => enabledChannels().flatMap((c) => c.hosts);

export function hostAllowed(host, allowed) {
  host = host.toLowerCase();
  return allowed.some((a) => host === a || host.endsWith('.' + a));
}

/** 簡單報告器：收集 error / warn / ok，最後依 error 數決定 exit code。 */
export function createReport(title) {
  const items = [];
  const add = (level, msg) => items.push({ level, msg });
  return {
    error: (m) => add('error', m),
    warn: (m) => add('warn', m),
    ok: (m) => add('ok', m),
    items,
    absorb(other) { items.push(...other.items); return this; },
    get errors() { return items.filter((i) => i.level === 'error').length; },
    get warns() { return items.filter((i) => i.level === 'warn').length; },
    print() {
      const icon = { error: '✗', warn: '△', ok: '✓' };
      console.log(`\n== ${title} ==`);
      for (const i of items) console.log(`${icon[i.level]} ${i.msg}`);
      const e = items.filter((i) => i.level === 'error').length;
      const w = items.filter((i) => i.level === 'warn').length;
      console.log(`-- ${e} 個錯誤, ${w} 個警告`);
      return e;
    },
  };
}

export const isIsoDate = (s) => typeof s === 'string' && !Number.isNaN(Date.parse(s));
