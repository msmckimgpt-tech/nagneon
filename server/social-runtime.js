import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Persona, Observation } from './schema.js';
import { communities, digest, SocialPreferencePatch } from './social-runtime-state.js';
import { transcriptAnomaly } from './transcript-correction.js';

const normalize = (s) => s.normalize('NFKC').toLocaleLowerCase();
const querySchema = z
  .object({
    q: z.string().max(120).default(''),
    communityId: z.enum(['', ...communities.map((c) => c.id)]).default(''),
    offset: z.coerce.number().int().min(0).max(2000).default(0),
    limit: z.coerce.number().int().min(1).max(50).default(30),
    revision: z.coerce.number().int().nonnegative().optional(),
    bookmarked: z.enum(['true', 'false']).default('false'),
  })
  .strict();
export class SocialRuntime {
  constructor(studio) {
    this.s = studio;
    this.world = studio.world;
  }
  data() {
    return this.world?.data.socialWorld;
  }
  enabled() {
    const d = this.data();
    return !!d && !d.quarantined && d.preferences.enabled;
  }
  change(fn) {
    return this.world.change((w) => {
      const d = w.socialWorld;
      const result = fn(d, w);
      d.revision++;
      return result;
    });
  }
  source(entry, witnessId) {
    return {
      id: entry.id,
      hash: digest({
        id: entry.id,
        text: entry.text,
        at: entry.at,
        transcription: entry.transcription,
        witnesses: entry.witnesses,
      }),
      at: entry.at,
      witnessId,
    };
  }
  validSource(ref) {
    const d = this.data(),
      s = this.s;
    if (!d || d.quarantined || !ref || d.tombstones.includes('journal:' + ref.id)) return false;
    const e = s.journal.data.entries.find((e) => e.id === ref.id);
    return (
      !!e &&
      !e.fictional &&
      e.personaId === 'streamer' &&
      e.kind === 'streamer' &&
      e.at <= s.now() &&
      s.now() - e.at <= 7 * 86400000 &&
      e.witnesses.includes(ref.witnessId) &&
      !(e.transcription?.source === 'microphone' && transcriptAnomaly(e.text)) &&
      this.source(e, ref.witnessId).hash === ref.hash
    );
  }
  visible(t) {
    const d = this.data();
    return (
      !d.quarantined &&
      !d.tombstones.includes('thread:' + t.id) &&
      !d.preferences.hiddenThreads.includes(t.id) &&
      (!t.source || !d.tombstones.includes('journal:' + t.source.id))
    );
  }
  projection(t) {
    const r = this.data().residents.find((r) => r.id === t.residentId);
    return {
      id: t.id,
      communityId: t.communityId,
      topicId: t.topicId,
      kind: t.kind,
      title: t.title,
      text: t.text,
      at: t.at,
      author: r?.persona.name || '주민',
      sourceStatus: !t.source
        ? 'daily'
        : this.validSource(t.source)
          ? 'public-broadcast'
          : 'historical',
      bookmarked: this.data().preferences.bookmarks.includes(t.id),
    };
  }
  summary() {
    const d = this.data();
    return d
      ? {
          enabled: d.preferences.enabled,
          arrivalsEnabled: d.preferences.arrivalsEnabled,
          quarantined: d.quarantined,
          revision: d.revision,
          blockedReason: this.s.ai.reason('community'),
          residents: d.residents.length,
          threads: d.threads.filter((t) => this.visible(t)).length,
          status: d.quarantined
            ? 'recovery-required'
            : !d.preferences.enabled
              ? 'off'
              : !this.s.provider.status().configured
                ? 'connection-required'
                : this.s.settings.mode !== 'live'
                  ? 'waiting-for-live-mode'
                  : 'active',
        }
      : null;
  }
  list(input = {}) {
    const q = querySchema.parse(input),
      d = this.data();
    if (!d) throw Error('커뮤니티 저장소가 연결되지 않았습니다.');
    const stale = q.revision !== undefined && q.revision !== d.revision;
    const items = stale
      ? []
      : d.threads
          .filter(
            (t) =>
              this.visible(t) &&
              (!q.communityId || t.communityId === q.communityId) &&
              (q.bookmarked !== 'true' || d.preferences.bookmarks.includes(t.id)) &&
              (!q.q || normalize(t.title + ' ' + t.text).includes(normalize(q.q))),
          )
          .sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));
    return {
      communities: communities.map(({ id, name, description, topics }) => ({
        id,
        name,
        description,
        topics: topics.map(({ id, label }) => ({ id, label })),
      })),
      preferences: structuredClone(d.preferences),
      ...this.summary(),
      stale,
      total: items.length,
      offset: q.offset,
      posts: items.slice(q.offset, q.offset + q.limit).map((t) => this.projection(t)),
    };
  }
  detail(id) {
    z.string().uuid().parse(id);
    const t = this.data()?.threads.find((t) => t.id === id && this.visible(t));
    return t ? this.projection(t) : null;
  }
  preferences(input) {
    const patch = SocialPreferencePatch.parse(input);
    this.change((d) => {
      Object.assign(d.preferences, patch);
    });
    const active = this.s.communityActivity.active;
    if (active?.social) this.s.communityActivity.interrupt();
    this.s.publish();
    return this.list();
  }
  forget(kind, ids) {
    if (!this.data() || !ids.length) return;
    const keys = ids.map((id) => kind + ':' + id);
    this.change((d) => {
      d.tombstones = [...new Set([...d.tombstones, ...keys])];
    });
    if (this.s.communityActivity.active?.social) this.s.communityActivity.interrupt();
  }
  startLive() {
    if (this.data())
      this.change((d) => {
        d.liveSequence++;
      });
  }
  candidates(now) {
    if (!this.enabled()) return [];
    const s = this.s,
      d = this.data(),
      out = [];
    if (d.threads.length >= 2000 || d.receipts.length >= 8000 || d.tombstones.length >= 4000)
      return out;
    const activeCommunities = communities.filter(
      (c) => !d.preferences.mutedCommunities.includes(c.id),
    );
    for (const c of activeCommunities) {
      const residents = d.residents.filter((r) => r.communityId === c.id),
        topic = c.topics.find((t) => !d.preferences.mutedTopics.includes(t.id));
      if (!topic) continue;
      if (residents.filter((r) => !r.admitted).length < 2 && d.residents.length < 128) {
        out.push({
          kind: 'social-birth',
          id: c.id,
          viewer: { id: 'social' },
          raw: { communityId: c.id, topicId: topic.id },
          revision: digest(c),
          weight: residents.length ? 2 : 5,
        });
      }
      for (const r of residents) {
        if (s.settings.personas.some((p) => p.id === r.persona.id && !p.enabled)) continue;
        const latest = d.threads.filter((t) => t.residentId === r.id).at(-1);
        if (!latest || now - latest.at >= 2 * 3600000)
          out.push({
            kind: 'social-daily',
            id: r.id,
            viewer: r.persona,
            raw: { residentId: r.id, communityId: c.id, topicId: topic.id },
            revision: digest({ r: r.id, day: Math.floor(now / 7200000) }),
            weight: 6,
          });
        const entry = s.journal.data.entries
          .slice()
          .reverse()
          .find(
            (e) =>
              e.witnesses.includes(r.persona.id) &&
              this.validSource(this.source(e, r.persona.id)) &&
              !d.threads.some((t) => t.source?.id === e.id),
          );
        if (entry && (!latest || now - latest.at >= 3600000))
          out.push({
            kind: 'social-mention',
            id: r.id,
            viewer: r.persona,
            raw: {
              residentId: r.id,
              communityId: c.id,
              topicId: topic.id,
              source: this.source(entry, r.persona.id),
            },
            revision: digest(entry),
            weight: 1,
          });
        if (!r.admitted) {
          const t = d.threads.find(
            (t) =>
              t.residentId !== r.id &&
              t.communityId === c.id &&
              this.visible(t) &&
              this.validSource(t.source) &&
              !d.preferences.mutedTopics.includes(t.topicId) &&
              !d.receipts.some(
                (x) => x.residentId === r.id && x.threadId === t.id && x.threadHash === digest(t),
              ),
          );
          if (t)
            out.push({
              kind: 'social-read',
              id: t.id,
              viewer: r.persona,
              raw: {
                residentId: r.id,
                communityId: c.id,
                topicId: t.topicId,
                threadId: t.id,
                threadHash: digest(t),
                source: t.source,
              },
              revision: digest(t),
              weight: 3,
            });
        }
      }
      // A real returning viewer can participate in one community; no invented witness.
      if (d.residents.length < 128) {
        const viewer = s.settings.personas.find(
          (p) =>
            p.enabled &&
            !p.system &&
            s.audience.data.members[p.id]?.sessions > 0 &&
            !d.residents.some((r) => r.persona.id === p.id) &&
            parseInt(digest(p.id).slice(0, 6), 16) % communities.length === communities.indexOf(c),
        );
        if (viewer)
          out.push({
            kind: 'social-daily',
            id: viewer.id,
            viewer,
            raw: { adopt: true, communityId: c.id, topicId: topic.id },
            revision: digest(viewer.id + c.id),
            weight: 4,
          });
      }
    }
    const attempts = s.communityActivity.data().attempts;
    return out.filter(
      (t) =>
        !attempts.some(
          (a) =>
            a.kind === t.kind &&
            a.id === t.id &&
            a.viewerId === t.viewer.id &&
            now - a.at < 1800000,
        ),
    );
  }
  async run(target, operation) {
    const s = this.s,
      d = this.data(),
      input = structuredClone(target.raw),
      generation = d.profileGeneration,
      c = communities.find((c) => c.id === input.communityId),
      topic = c.topics.find((t) => t.id === input.topicId),
      birth = target.kind === 'social-birth';
    operation.social = true;
    const signal = AbortSignal.any([operation.controller.signal, AbortSignal.timeout(90000)]);
    const opId = randomUUID();
    const source = input.source,
      thread = input.threadId ? d.threads.find((t) => t.id === input.threadId) : null;
    const original = source ? s.journal.data.entries.find((e) => e.id === source.id) : null;
    const delivered = thread
      ? { id: thread.id, title: thread.title, text: thread.text }
      : original
        ? { text: original.text.slice(0, 600), speaker: original.name }
        : null;
    const valid = () =>
      !signal.aborted &&
      !s.communityActivity.closed &&
      s.epoch === operation.epoch &&
      this.enabled() &&
      this.data().profileGeneration === generation &&
      !this.data().preferences.mutedCommunities.includes(c.id) &&
      !this.data().preferences.mutedTopics.includes(topic.id) &&
      (!source || this.validSource(source)) &&
      (!thread ||
        this.data().threads.some(
          (t) => t.id === thread.id && digest(t) === input.threadHash && this.visible(t),
        )) &&
      (!input.adopt || s.settings.personas.some((p) => p.id === target.viewer.id && p.enabled));
    if (!valid()) return;
    // Explicit neutral settings prevent the stream title, nickname and private history entering daily life.
    const settings = {
      ...s.settings,
      title: '가상 공동체의 일상',
      streamer: '방송인',
      streamerStyle: '',
      managerRules: '',
      communityCulture: c.norms,
      managerId: 'social',
      gameId: 'community',
      games: [
        { id: 'community', name: c.name, genre: '일상', context: c.description, popularity: 0.5 },
      ],
      personas: birth ? [] : [target.viewer],
      chatPace: 1,
      webSearch: false,
      memesEnabled: false,
    };
    const instruction = birth
      ? '이 공동체에 사는 새로운 가상 주민 한 명을 arrival에 구성한다. 기존 관객/실제 이용자를 복제하지 말고 방송인과의 친분이나 시청 경험을 만들지 않는다. messages는 비운다.'
      : target.kind === 'social-read'
        ? '제공된 게시글을 실제로 읽는 가상 사건이다. 본인 취향으로 방송에 관심이 생겼으면 communityVotes에 자신의 personaId와 recommended=true, 아니면 false를 반환한다. messages는 비운다. 직접 방송을 목격했다고 주장하지 않는다.'
        : target.kind === 'social-mention'
          ? '제공된 공개 방송 발언만 직접 목격 근거다. 공동체 취향에 맞는 짧은 감상 글 하나를 messages에 쓰거나 침묵한다. 다른 사건/영상/관객/친분을 지어내지 않는다.'
          : '방송인과 무관한 이 공동체의 일상 글 하나를 messages에 쓴다. 주제에 대한 독립적인 취향·시행착오를 한국어 게시글 말투로 표현한다. 현실 뉴스/유행/날짜/실제 사이트 방문을 지어내지 않는다. 침묵도 정상이다.';
    s.reserveCall();
    const result = await s.provider.react(
      {
        aiFeature: 'community',
        settings,
        history: [],
        previous: null,
        speech: '',
        offStream: true,
        frames: [],
        culture: { enabled: false },
        special: {
          kind: target.kind,
          community: { name: c.name, norms: c.norms },
          topic,
          delivered,
          instruction,
        },
      },
      signal,
    );
    if (!valid()) return;
    s.ai.assertCurrent(result);
    const observation = Observation.parse(result.observation);
    const message = observation.messages.find(
      (m) =>
        m.personaId === target.viewer.id &&
        m.kind === 'chat' &&
        !m.spoiler &&
        !m.meme &&
        !s.settings.blockedWords.some((w) => normalize(m.text).includes(normalize(w))),
    );
    if (birth && !observation.arrival)
      throw Error('커뮤니티 주민을 구성하지 못했습니다. 잠시 뒤 다시 시도합니다.');
    this.change((next, w) => {
      if (!valid()) throw Error('커뮤니티 작업의 상태가 바뀌었습니다.');
      const now = s.now();
      let resident = next.residents.find((r) => r.id === input.residentId);
      if (birth) {
        const p = Persona.parse({
          ...observation.arrival,
          id: randomUUID(),
          color: '#8bcdd2',
          role: 'viewer',
          enabled: true,
          system: false,
        });
        if (s.settings.blockedWords.some((word) => normalize(p.name).includes(normalize(word))))
          throw Error('주민 이름이 방송 규칙에 맞지 않습니다.');
        if (
          next.residents.some((r) => r.persona.name === p.name) ||
          w.settings.personas.some((r) => r.name === p.name)
        )
          throw Error('이미 사용 중인 주민 이름입니다.');
        next.residents.push({
          id: randomUUID(),
          communityId: c.id,
          persona: p,
          joinedAt: now,
          admitted: false,
        });
        return;
      }
      if (input.adopt) {
        resident = next.residents.find((r) => r.persona.id === target.viewer.id);
        if (!resident) {
          resident = {
            id: randomUUID(),
            communityId: c.id,
            persona: target.viewer,
            joinedAt: now,
            admitted: true,
          };
          next.residents.push(resident);
        }
      }
      if (!resident) throw Error('주민을 찾을 수 없습니다.');
      if (target.kind === 'social-read') {
        if (next.receipts.some((r) => r.operationId === opId)) return;
        next.receipts.push({
          id: randomUUID(),
          residentId: resident.id,
          threadId: thread.id,
          threadHash: input.threadHash,
          deliveredHash: digest(delivered),
          operationId: opId,
          receivedAt: now,
          receivedLiveSequence: next.liveSequence,
          eligibleFromLiveSequence: next.liveSequence + 1,
          interested: !!observation.communityVotes.find(
            (v) => v.personaId === resident.persona.id && v.recommended,
          ),
          source,
        });
      } else if (message) {
        next.threads.push({
          id: randomUUID(),
          communityId: c.id,
          topicId: topic.id,
          residentId: resident.id,
          kind: source ? 'mention' : 'daily',
          title: message.text.split('\n')[0].slice(0, 70),
          text: message.text,
          at: now,
          source: source || null,
        });
      }
    });
    s.tokens += Number(result.usage?.total_tokens) || 0;
    s.ai.accepted(result);
    s.publish();
  }
  memory(personaId) {
    const d = this.data();
    if (!d || d.quarantined) return [];
    const r = d.residents.find((r) => r.persona.id === personaId);
    if (!r) return [];
    return d.receipts
      .filter((x) => x.residentId === r.id && this.validReceipt(x))
      .slice(-3)
      .map((x) => {
        const t = d.threads.find((t) => t.id === x.threadId);
        return {
          experience: 'heard-from-community',
          community: communities.find((c) => c.id === t.communityId).name,
          text: t.text,
          receivedAt: x.receivedAt,
        };
      });
  }
  validReceipt(r) {
    const d = this.data(),
      t = d.threads.find((t) => t.id === r.threadId);
    return (
      !!t &&
      !d.preferences.mutedCommunities.includes(t.communityId) &&
      !d.preferences.mutedTopics.includes(t.topicId) &&
      this.visible(t) &&
      digest(t) === r.threadHash &&
      digest({ id: t.id, title: t.title, text: t.text }) === r.deliveredHash &&
      digest(t.source) === digest(r.source) &&
      this.validSource(r.source)
    );
  }
  arrive() {
    const s = this.s,
      d = this.data();
    if (
      !this.enabled() ||
      !d.preferences.arrivalsEnabled ||
      !s.running ||
      s.settings.mode !== 'live' ||
      s.busy ||
      s.autonomy?.waiting ||
      s.autonomy?.pending ||
      s.autonomy?.firstTutorialPending ||
      !s.tutorialReady?.() ||
      !s.settings.personas.some((p) => !p.system && s.audience.data.members[p.id]?.sessions > 0) ||
      s.now() - this.world.data.autonomy.lastArrivalAt < 300000
    )
      return false;
    const receipt = d.receipts.find(
      (r) =>
        r.interested &&
        r.eligibleFromLiveSequence <= d.liveSequence &&
        this.validReceipt(r) &&
        d.residents.some(
          (p) =>
            p.id === r.residentId &&
            !p.admitted &&
            !s.settings.personas.some((v) => v.id === p.persona.id),
        ),
    );
    if (!receipt) return false;
    const resident = d.residents.find((r) => r.id === receipt.residentId),
      c = communities.find((c) => c.id === resident.communityId),
      id = randomUUID(),
      now = s.now();
    this.change((next, w) => {
      if (!this.validReceipt(receipt)) throw Error('유입 근거가 바뀌었습니다.');
      const r = next.residents.find((r) => r.id === resident.id);
      if (r.admitted || w.settings.personas.some((p) => p.id === r.persona.id)) return;
      r.admitted = true;
      r.arrivalReceiptId = id;
      const p = r.persona;
      w.settings.personas.push(p);
      w.audience.members[p.id] = {
        sessions: 1,
        seconds: 0,
        recognized: 0,
        affinity: 0.15,
        peers: {},
        memories: [],
        note: '',
        aliases: [],
        joinedAt: now,
        origin: { path: 'community', key: c.id, label: c.name, firstSeenAt: now },
      };
      s.economy.wallet(w.economy, p.id);
      w.autonomy.receipts[id] = {
        status: 'completed',
        cost: 0,
        at: now,
        personaId: p.id,
        source: { path: 'community', key: c.id, label: c.name },
      };
      w.autonomy.lastArrivalAt = now;
      s.economy.entry(w.economy, 'purchase', 0, '커뮤니티에서 새로운 관객 방문 · 0P');
    });
    s.audience.presence[resident.persona.id] =
      s.random() < s.settings.lurkRatio ? 'lurking' : 'active';
    s.log(`${resident.persona.name} · ${c.name}에서 첫 방문`);
    s.publish();
    return true;
  }
}
export function socialRoutes(app, studio) {
  app.get('/api/social/communities', (_req, res) => res.json(studio.social.list()));
  app.get('/api/social/search', (req, res) => res.json(studio.social.list(req.query)));
  app.get('/api/social/threads/:id', (req, res) => {
    const post = studio.social.detail(req.params.id);
    res.status(post ? 200 : 404).json(post || { error: '글을 찾을 수 없습니다.' });
  });
  app.patch('/api/social/preferences', (req, res) => res.json(studio.social.preferences(req.body)));
  app.delete('/api/social/threads/:id', (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    studio.social.forget('thread', [id]);
    studio.publish();
    res.json({ ok: true });
  });
}
