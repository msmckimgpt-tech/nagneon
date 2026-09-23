import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import ipaddr from 'ipaddr.js';
import robotsParser from 'robots-parser';
import { Parser } from 'htmlparser2';

export const AGENT = 'NagneonCulture';
export function domainOrigin(value) {
  const u = new URL(value.includes('://') ? value : `https://${value}`);
  if (u.protocol !== 'https:' || u.port || u.username || u.password || u.search || u.hash || u.pathname !== '/' ||
      !u.hostname.includes('.') || ipaddr.isValid(u.hostname.replace(/^\[|\]$/g, '')) ||
      /(^|\.)(localhost|local|internal|test|invalid|example|onion)$/.test(u.hostname)) throw Error('공개 HTTPS 커뮤니티 도메인만 입력하세요.');
  return u.origin;
}
export function publicAddress(address) {
  try { return ipaddr.parse(address).range() === 'unicast'; } catch { return false; }
}
// Resolve once and pin the socket address. Reject mixed public/private answers.
export async function getPublic(url, { signal, headers = {}, resolve = lookup } = {}) {
  const u = new URL(url);
  domainOrigin(u.origin);
  signal = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(15000)]);
  signal.throwIfAborted();
  const addresses = await Promise.race([
    resolve(u.hostname, { all: true, verbatim: true }),
    new Promise((_, reject) => { if (signal.aborted) reject(signal.reason); else signal.addEventListener('abort', () => reject(signal.reason), { once: true }); }),
  ]);
  signal.throwIfAborted();
  if (!addresses.length || addresses.some(a => !publicAddress(a.address))) throw Error('공개 인터넷 주소가 아닙니다.');
  return new Promise((done, fail) => {
    const req = https.get(u, {
      signal, agent: false,
      headers: { 'User-Agent': `${AGENT}/1.0`, Accept: 'text/html, application/rss+xml, application/atom+xml, text/plain', 'Accept-Encoding': 'identity', ...headers },
      lookup: (_host, options, cb) => options.all ? cb(null, [addresses[0]]) : cb(null, addresses[0].address, addresses[0].family),
    }, res => {
      if (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity') { res.destroy(); fail(Error('압축 응답은 수집하지 않습니다.')); return; }
      const chunks = []; let size = 0;
      res.on('data', chunk => { size += chunk.length; if (size > 256 * 1024) res.destroy(Error('문서 크기 제한을 초과했습니다.')); else chunks.push(chunk); });
      res.on('error', fail);
      res.on('end', () => done({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', fail);
  });
}

export function extractDocument(html, base) {
  const links = [], text = []; let hidden = 0, denied = false, length = 0;
  const suppress = new Set(['script', 'style', 'noscript', 'form', 'nav', 'footer', 'svg']);
  const parser = new Parser({
    onopentag(name, attrs) {
      if (suppress.has(name)) hidden++;
      if (name === 'meta' && /^(robots|nagneonculture)$/i.test(attrs.name || '') && /noindex|noai|noarchive|nosnippet/i.test(attrs.content || '')) denied = true;
      if (!hidden && ((name === 'a' && attrs.href) || (name === 'link' && /rss|atom/.test(attrs.type || '')))) {
        try { const u = new URL(attrs.href, base); u.hash = ''; if (u.origin === new URL(base).origin && !u.search && !u.username && !/login|sign.?in|logout|admin|download|account|register/i.test(u.pathname)) links.push(u.href); } catch {}
      }
    },
    onclosetag(name) { if (suppress.has(name)) hidden = Math.max(0, hidden - 1); },
    ontext(value) { if (!hidden && length < 18000) { text.push(value); length += value.length; } },
  }, { decodeEntities: true });
  parser.end(html);
  return { denied, text: text.join(' ').replace(/\s+/g, ' ').trim().slice(0, 6000), links: [...new Set(links)].slice(0, 40) };
}

export async function collectDomain(origin, { signal, request = getPublic, wait = delay } = {}) {
  origin = domainOrigin(origin);
  let requests = 0, spacing = 10000;
  const read = async (url) => {
    if (requests++) await wait(spacing, undefined, { signal });
    signal?.throwIfAborted();
    if (requests > 4) throw Error('수집 요청 한도를 초과했습니다.');
    const r = await request(url, { signal });
    if ([401, 403, 429].includes(r.status) || r.status >= 500) {
      const value = r.headers['retry-after'];
      const retryAt = /^\d+$/.test(value || '') ? Date.now() + Number(value) * 1000 : Date.parse(value);
      throw Object.assign(Error('사이트가 수집을 제한하거나 응답하지 않습니다.'), { retryAt });
    }
    // Redirects are deliberately not followed: every path requires its own robots check.
    if (r.status >= 300 && r.status < 400) throw Error('주소 이동은 자동으로 따라가지 않습니다. 최종 도메인을 입력하세요.');
    return r;
  };
  const robotsUrl = `${origin}/robots.txt`, robotsResponse = await read(robotsUrl);
  if (robotsResponse.status !== 200 && robotsResponse.status !== 404) throw Error('수집 규칙을 확인하지 못했습니다.');
  if (robotsResponse.status === 200 && /<html|<!doctype/i.test(robotsResponse.body)) throw Error('수집 규칙 대신 안내 페이지가 반환되었습니다.');
  const robots = robotsParser(robotsUrl, robotsResponse.status === 404 ? '' : robotsResponse.body);
  spacing = Math.max(spacing, (robots.getCrawlDelay(AGENT) || 0) * 1000);
  if (spacing > 60000) throw Error('사이트의 긴 수집 대기 정책으로 수집을 보류했습니다.');
  const pending = [`${origin}/`], visited = new Set(), documents = [];
  while (pending.length && documents.length < 3 && requests < 4) {
    const url = pending.shift();
    if (visited.has(url) || robots.isAllowed(url, AGENT) === false) continue;
    visited.add(url);
    const response = await read(url);
    if (response.status !== 200) continue;
    if (!/text\/html|application\/(rss\+xml|atom\+xml)|text\/xml/.test(response.headers['content-type'] || '')) continue;
    if (/noindex|noai|noarchive|nosnippet/i.test(response.headers['x-robots-tag'] || '')) continue;
    const doc = extractDocument(response.body, url);
    if (doc.denied) continue;
    if (doc.text) documents.push({ url, text: doc.text });
    pending.push(...doc.links);
  }
  if (!documents.length) throw Error('수집 가능한 공개 문서가 없습니다.');
  return { documents, digest: createHash('sha256').update(JSON.stringify(documents)).digest('hex') };
}
