// 禮貌且安全的抓取：robots.txt、同網域間隔、大小與逾時上限、轉址逐跳檢查、擋內網位址、不碰蝦皮／酷澎網頁。
// 已知限制：DNS 檢查與實際連線之間有極短空窗（DNS rebinding），本工具只在你自己的機器／GitHub runner 上跑，風險可接受。
import dns from 'node:dns/promises';
import net from 'node:net';
import { parseRobots, robotsAllows } from './robots.mjs';
import { literalHostProblem } from './url.mjs';

export class ImportError extends Error {
  constructor(code, message) { super(message); this.name = 'ImportError'; this.code = code; }
}

export function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b, c] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0 && c === 0) ||
      (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    if (l === '::' || l === '::1') return true;
    if (l.startsWith('::ffff:')) return true; // IPv4 對映位址一律當作不安全
    return /^f[cd]/.test(l) || /^fe[89ab]/.test(l) || l.startsWith('ff');
  }
  return true;
}

export async function assertPublicHost(host, lookup = (h, o) => dns.lookup(h, o)) {
  const h = host.replace(/^\[|\]$/g, '');
  if (net.isIP(h)) { if (isPrivateIp(h)) throw new ImportError('private-host', `${host} 是內部位址`); return; }
  let addrs;
  try { addrs = await lookup(h, { all: true }); } catch { throw new ImportError('dns', `找不到主機 ${host}`); }
  if (!addrs?.length) throw new ImportError('dns', `找不到主機 ${host}`);
  if (addrs.some((a) => isPrivateIp(a.address))) throw new ImportError('private-host', `${host} 解析到內部位址，已拒絕`);
}

export const DEFAULT_BLOCKED_HOSTS = ['shopee.tw', 'shp.ee', 'coupang.com', 'coupa.ng'];

export function createFetcher(opts = {}) {
  const o = {
    userAgent: 'affiliate-product-importer/1.0', delayMs: 3000, timeoutMs: 15000, maxRedirects: 4,
    fetchImpl: globalThis.fetch, lookup: undefined, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), now: () => Date.now(),
    blockedHosts: DEFAULT_BLOCKED_HOSTS, ...opts,
  };
  const lastAt = new Map();
  const robotsCache = new Map();
  const isBlocked = (host) => o.blockedHosts.some((b) => host === b || host.endsWith('.' + b));

  async function politeWait(host, minMs = 0) {
    const gap = Math.max(o.delayMs, minMs);
    const last = lastAt.get(host);
    if (last != null) { const d = last + gap - o.now(); if (d > 0) await o.sleep(d); }
    lastAt.set(host, o.now());
  }

  function checkUrl(u) {
    if (!/^https?:$/.test(u.protocol)) throw new ImportError('protocol', '只接受 http／https');
    const host = u.hostname.toLowerCase();
    if (isBlocked(host)) throw new ImportError('marketplace', `${host} 是蝦皮／酷澎網域：本工具不抓取其網頁，請改用官方 API 或手動填寫。`);
    const bad = literalHostProblem(host);
    if (bad) throw new ImportError('host', `${host}：${bad}`);
  }

  async function rawGet(url, accept) {
    try {
      return await o.fetchImpl(url, {
        redirect: 'manual', signal: AbortSignal.timeout(o.timeoutMs),
        headers: { 'user-agent': o.userAgent, accept, 'accept-language': 'zh-TW,zh;q=0.9,en;q=0.5' },
      });
    } catch (e) {
      throw new ImportError(e?.name === 'TimeoutError' || e?.name === 'AbortError' ? 'timeout' : 'network', `連線失敗：${e?.message ?? e}`);
    }
  }

  async function request(url, { accept, robots }) {
    let cur = new URL(url);
    for (let hop = 0; hop <= o.maxRedirects; hop++) {
      checkUrl(cur);
      await assertPublicHost(cur.hostname, o.lookup);
      if (robots) {
        const pol = await robotsPolicy(cur);
        if (!robotsAllows(pol, cur.pathname + cur.search)) throw new ImportError('robots', `robots.txt 不允許抓取 ${cur.origin}${cur.pathname}`);
        await politeWait(cur.hostname, (pol.delay ?? 0) * 1000);
      } else await politeWait(cur.hostname);
      const res = await rawGet(cur, accept);
      const loc = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && loc) {
        try { await res.body?.cancel?.(); } catch { /* ignore */ }
        cur = new URL(loc, cur);
        continue;
      }
      return { res, url: cur.toString() };
    }
    throw new ImportError('redirects', '轉址次數過多');
  }

  async function robotsPolicy(u) {
    if (robotsCache.has(u.origin)) return robotsCache.get(u.origin);
    let pol;
    try {
      const { res } = await request(u.origin + '/robots.txt', { accept: 'text/plain', robots: false });
      if (res.status === 200) pol = parseRobots((await readBody(res, 512 * 1024)).toString('utf8'), o.userAgent);
      else if (res.status === 401 || res.status === 403 || res.status >= 500) pol = { denyAll: true };
      else pol = { allowAll: true };
    } catch (e) {
      if (e instanceof ImportError && ['marketplace', 'private-host', 'host', 'protocol'].includes(e.code)) throw e;
      pol = { denyAll: true }; // 讀不到 robots.txt（逾時等）時保守處理
    }
    robotsCache.set(u.origin, pol);
    return pol;
  }

  async function readBody(res, maxBytes) {
    const len = Number(res.headers.get('content-length'));
    if (len > maxBytes) throw new ImportError('too-large', `檔案太大（${len} bytes）`);
    if (!res.body?.getReader) {
      const b = Buffer.from(await res.arrayBuffer());
      if (b.length > maxBytes) throw new ImportError('too-large', '檔案太大');
      return b;
    }
    const reader = res.body.getReader();
    const chunks = [];
    let n = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      n += value.length;
      if (n > maxBytes) { await reader.cancel(); throw new ImportError('too-large', `檔案超過上限 ${maxBytes} bytes`); }
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  }

  return {
    async get(url, { accept = 'text/html,application/xhtml+xml', maxBytes = 2 * 1024 * 1024, robots = true } = {}) {
      const { res, url: finalUrl } = await request(url, { accept, robots });
      if (res.status < 200 || res.status >= 300) {
        const hint = [401, 403, 429].includes(res.status) ? '（站方拒絕或限流，不重試；請改手動貼資料）' : '';
        throw new ImportError(`http-${res.status}`, `HTTP ${res.status}${hint}`);
      }
      return { url: finalUrl, status: res.status, contentType: res.headers.get('content-type') ?? '', body: await readBody(res, maxBytes) };
    },
  };
}
