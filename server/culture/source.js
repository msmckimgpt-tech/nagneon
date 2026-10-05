import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import ipaddr from 'ipaddr.js';
import robotsParser from 'robots-parser';
import { Parser } from 'htmlparser2';

export const AGENT = 'NagneonCulture';
// Community documents contain substantial scripts/styles before the public post.
// Bound transfer independently from the much smaller 6,000-character model input.
const MAX_DOCUMENT_BYTES = 1024 * 1024;
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
// Public board navigation needs query IDs, but login/session/search/action
// parameters must not be copied into requests or persisted source references.
const publicQueryKeys = new Set(['id', 'no', 'num', 'document_srl', 'mid', 'board', 'board_id', 'bo_table', 'wr_id', 'category', 'page', 'p', 'page_no', 'come_idx', 'l']);
export function publicDocumentLink(href, base) {
  try {
    const u = new URL(href, base);
    if (u.origin !== new URL(base).origin || u.protocol !== 'https:' || u.username || u.password || u.href.length > 2000) return null;
    const path = decodeURIComponent(u.pathname);
    if (/login|sign.?in|logout|admin|download|account|register|(?:^|[\/_\-.])(?:write|edit|delete|remove|vote|report|subscribe|unsubscribe|message|profile)(?:[\/_\-.]|$)/i.test(path)) return null;
    const seen = new Set();
    for (const [key, value] of u.searchParams) {
      if (seen.has(key) || seen.size >= 6) return null;
      seen.add(key);
      if (key === 'act') {
        if (!['dispBoardContent', 'dispBoardCategory'].includes(value)) return null;
      } else if (!publicQueryKeys.has(key) || !/^[a-zA-Z0-9_-]{1,80}$/.test(value)) return null;
      if (/^(?:page|p|page_no)$/.test(key) && !/^\d{1,6}$/.test(value)) return null;
    }
    u.hash = '';
    return u.href;
  } catch { return null; }
}
const unrelatedPath = /^\/+(?:notice|contact|event|market|family|game|news)(?:\/|$)|\/(?:calendar|category)(?:\/|$)/i;
function documentPriority(link) {
  const u = new URL(link), path = u.pathname;
  if (unrelatedPath.test(path)) return 4;
  if (['document_srl', 'wr_id', 'no', 'num', 'l'].some(key => /^\d+$/.test(u.searchParams.get(key) || '')) ||
      /\/(?:read|view)(?:\/\d+|\/?$)|\/board\/[^/]+\/\d+\/\d+\/?$|^\/[\w-]+\/\d+\/?$/.test(path)) return 0;
  if (/\/(?:hot|square|talk|free|community|userboard)(?:\/|$)/i.test(path)) return 1;
  if (/\/(?:rss|atom|feed)(?:\/|$)/i.test(path)) return 2;
  return 3;
}
// Large landing pages may contain much executable markup before their public
// links. Keep the byte limit; a truncated prefix is navigation, never evidence.
export function readPublicDocument(res) {
  return new Promise((done, fail) => {
    const chunks = []; let size = 0, finished = false;
    const finish = truncated => { finished = true; done({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8'), ...(truncated ? { truncated: true } : {}) }); };
    res.on('data', chunk => {
      if (finished) return;
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const remaining = MAX_DOCUMENT_BYTES - size;
      chunks.push(bytes.subarray(0, remaining)); size += Math.min(bytes.length, remaining);
      if (bytes.length > remaining) { finish(true); res.destroy(); }
    });
    res.on('error', fail);
    res.on('end', () => { if (!finished) finish(false); });
    res.on('aborted', () => fail(Error('문서 전송이 중단되었습니다.')));
    res.on('close', () => { if (!finished) fail(Error('문서 전송이 중단되었습니다.')); });
  });
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
      readPublicDocument(res).then(done, fail);
    });
    req.on('error', fail);
  });
}

export function extractDocument(html, base) {
  const links = [], text = [], stack = [], blocks = [], activeBlocks = [];
  let denied = false, length = 0, feed = false;
  const suppress = new Set(['script', 'style', 'noscript', 'form', 'nav', 'footer', 'svg', 'button']);
  const contentNames = /^(?:powerbbscontent|articlecontent|article[-_]content|post[-_]content|view[-_]content|write_div|read[-_]body|xe_content|rhymix_content|comment[-_](?:body|text|content))$/i;
  const parser = new Parser({
    onopentag(name, attrs) {
      if (['rss', 'feed', 'rdf:rdf'].includes(name)) feed = true;
      const parent = stack.at(-1);
      const names = [attrs.id, ...(attrs.class || '').split(/\s+/)];
      const hidden = parent?.hidden || suppress.has(name) || attrs['aria-hidden'] === 'true' || Object.hasOwn(attrs, 'hidden') || Object.hasOwn(attrs, 'data-nosnippet') ||
        /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(attrs.style || '') ||
        names.some(v => /^(?:p_nick|nick|nick_info|user_info|writer_info|signature)$/i.test(v || '')) ||
        (['tr', 'li'].includes(name) && names.includes('notice'));
      if (name === 'table' || names.some(v => /(?:bbs|gall|board)[-_]?list|^list[-_](?:table|wrap)$/i.test(v || ''))) {
        for (const block of activeBlocks) block.listing = true;
      }
      const row = { hidden, linked: parent?.linked || name === 'a', block: null,
        comment: parent?.comment || names.some(v => /^comment(?:[-_](?:element|view))?$/.test(v || '')),
        commentKey: /^ct_\d+$/.test(attrs.id || '') ? attrs.id : parent?.commentKey };
      const specific = attrs.itemprop === 'articleBody' || names.some(v => contentNames.test(v || '')) || (row.comment && names.includes('text'));
      if (!hidden && blocks.length < 200 && (['article', 'item', 'entry'].includes(name) || specific)) {
        for (const block of activeBlocks) block.hasChild = true;
        row.block = { text: [], length: 0, prose: 0, content: 0, hasChild: false, specific, listing: false, commentKey: row.commentKey };
        blocks.push(row.block); activeBlocks.push(row.block);
      }
      stack.push(row);
      if (name === 'meta' && /^(robots|nagneonculture)$/i.test(attrs.name || '') && /noindex|noai|noarchive|nosnippet/i.test(attrs.content || '')) denied = true;
      if (!hidden && ((name === 'a' && attrs.href) || (name === 'link' && /rss|atom/.test(attrs.type || '')))) {
        const link = publicDocumentLink(attrs.href, base);
        if (link) links.push(link);
      }
    },
    onclosetag() { if (stack.pop()?.block) activeBlocks.pop(); },
    ontext(value) {
      const row = stack.at(-1);
      if (row?.hidden) return;
      if (length < 18000) { text.push(value); length += value.length; }
      for (const block of activeBlocks) {
        if (block.length >= 12000) continue;
        const bounded = value.slice(0, 12000 - block.length);
        block.text.push(bounded); block.length += bounded.length; block.content += bounded.trim().length;
        if (!row?.linked) block.prose += bounded.trim().length;
      }
    },
  }, { decodeEntities: true });
  parser.end(html);
  // Prefer the innermost post/comment body. Never let navigation, account labels,
  // signatures or a disabled feed's description become a culture sample.
  const commentKeys = new Set();
  const selected = blocks.filter(b => {
    if (b.hasChild || (!b.specific && b.listing) || b.prose <= 0 || b.prose / Math.max(1, b.content) < .35 || (b.commentKey && commentKeys.has(b.commentKey))) return false;
    if (b.commentKey) commentKeys.add(b.commentKey);
    return true;
  });
  const normalize = parts => parts.join(' ').replace(/\s+/g, ' ').trim();
  const content = (selected.length ? selected.slice(0, 40).map(b => normalize(b.text).slice(0, 1000)).join('\n') : normalize(text)).slice(0, 6000);
  const usable = selected.reduce((sum, b) => sum + b.prose, 0) >= 20 &&
    !(content.length < 800 && /verify (?:that )?you are human|access denied|enable javascript|로그인.{0,12}(?:필요|하세요)|접근이?\s*(?:제한|차단)|(?:피드|feed).{0,40}(?:잠겨|잠금|disabled|unavailable)/iu.test(content));
  return { denied, text: content, usable, feed, links: [...new Set(links)].sort((a, b) => documentPriority(a) - documentPriority(b)).slice(0, 40) };
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
  if (robotsResponse.truncated) throw Error('수집 규칙의 전체 내용을 확인하지 못했습니다.');
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
    const page = new URL(url);
    if (doc.usable && !response.truncated && !unrelatedPath.test(page.pathname) && (doc.feed || page.pathname !== '/' || page.search)) documents.push({ url, text: doc.text });
    pending.push(...doc.links);
    pending.sort((a, b) => documentPriority(a) - documentPriority(b));
  }
  if (!documents.length) throw Error('수집 가능한 공개 문서가 없습니다.');
  return { documents, digest: createHash('sha256').update(JSON.stringify(documents)).digest('hex') };
}
