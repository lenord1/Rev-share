// robots.txt 解析（RFC 9309 的常用子集）：群組比對、Allow／Disallow 最長路徑優先、* 與 $、Crawl-delay。
export function parseRobots(text, userAgent = '*') {
  const groups = [];
  let cur = null;
  let lastUa = false;
  for (const lineRaw of String(text).split(/\r?\n/)) {
    const line = lineRaw.replace(/#.*/, '').trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === 'user-agent') {
      if (!lastUa) { cur = { agents: [], rules: [], delay: null }; groups.push(cur); }
      cur.agents.push(val.toLowerCase());
      lastUa = true;
      continue;
    }
    lastUa = false;
    if (!cur) continue;
    if (key === 'allow' || key === 'disallow') { if (val) cur.rules.push({ allow: key === 'allow', path: val }); }
    else if (key === 'crawl-delay') { const d = parseFloat(val); if (Number.isFinite(d) && d >= 0) cur.delay = d; }
  }
  const ua = String(userAgent).toLowerCase();
  const specific = groups.filter((g) => g.agents.some((a) => a !== '*' && ua.includes(a)));
  const chosen = specific.length ? specific : groups.filter((g) => g.agents.includes('*'));
  const delays = chosen.map((g) => g.delay).filter((d) => d != null);
  return { rules: chosen.flatMap((g) => g.rules), delay: delays.length ? Math.max(...delays) : null };
}

function ruleRegex(path) {
  const anchored = path.endsWith('$');
  const body = (anchored ? path.slice(0, -1) : path).split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp('^' + body + (anchored ? '$' : ''));
}

/** policy 可為 {allowAll} / {denyAll} / parseRobots 的結果。 */
export function robotsAllows(policy, pathWithQuery) {
  if (policy?.allowAll) return true;
  if (policy?.denyAll) return false;
  let best = null;
  for (const r of policy?.rules ?? []) {
    if (!ruleRegex(r.path).test(pathWithQuery)) continue;
    if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)) best = r;
  }
  return !best || best.allow;
}
