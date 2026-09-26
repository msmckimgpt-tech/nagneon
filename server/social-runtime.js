import { communityInterest, communityProjection } from './decision/policies.js';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import express from 'express';
import { existsSync, statSync } from 'node:fs';
import { SocialMedia, pixelPng } from './social-media.js';
import { socialContentHash, socialDiscussionHash, similarSocialText } from './social-content.js';
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
    this.media = new SocialMedia();
    this.recalledSources = new WeakMap();
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
  isViewer(r) {
    return (
      !!r &&
      this.s.settings.personas.some((p) => p.id === r.persona.id && !p.system) &&
      this.s.audience.data.members[r.persona.id]?.sessions > 0
    );
  }
  mediaFile(a) {
    if (!a.clipId) return this.media.dir && this.media.exists(a) ? this.media.file(a.id) : null;
    const clip = this.s.clips.data.find((c) => c.id === a.clipId);
    if (!clip) return null;
    const ext =
      a.kind === 'video' && clip.video ? 'webm' : a.kind === 'image' ? clip.thumbnail : null;
    if (!ext || !this.s.clips.dir) return null;
    const path = this.s.clips.file(clip.id, ext);
    return existsSync(path) ? path : null;
  }
  sharedClip(source, viewerId) {
    if (!source || !this.s.clips.dir) return null;
    const c = this.s.clips.data.find(
      (c) =>
        c.participants.some((p) => p.id === viewerId) && c.messages.some((m) => m.id === source.id),
    );
    if (!c) return null;
    const kind = c.video ? 'video' : c.thumbnail ? 'image' : null;
    if (!kind) return null;
    const path = this.s.clips.file(c.id, kind === 'video' ? 'webm' : c.thumbnail);
    if (!existsSync(path)) return null;
    return {
      id: randomUUID(),
      clipId: c.id,
      kind,
      name: c.title,
      mime: kind === 'video' ? 'video/webm' : c.thumbnail === 'png' ? 'image/png' : 'image/jpeg',
      bytes: statSync(path).size,
    };
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
      authorIsViewer:
        !!r &&
        this.s.settings.personas.some((p) => p.id === r.persona.id && !p.system) &&
        this.s.audience.data.members[r.persona.id]?.sessions > 0,
      sourceStatus: !t.source
        ? 'daily'
        : this.validSource(t.source)
          ? 'public-broadcast'
          : 'historical',
      bookmarked: this.data().preferences.bookmarks.includes(t.id),
      comments: (t.comments || []).map((c) => ({
        ...c,
        authorIsViewer: this.isViewer(this.data().residents.find((r) => r.id === c.residentId)),
        residentId: undefined,
      })),
      recommendationCount: (t.votes || []).length,
      recommended: (t.votes || []).includes('streamer'),
      attachments: (t.attachments || []).map((a) => ({
        ...a,
        available: !!this.mediaFile(a) || (!a.clipId && this.media.exists(a)),
        url: '/api/social/threads/' + t.id + '/attachments/' + a.id,
      })),
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
  editable(id) {
    z.string().uuid().parse(id);
    const t = this.data()?.threads.find((t) => t.id === id && this.visible(t));
    if (!t) throw Error('글을 찾을 수 없습니다.');
    return t;
  }
  comment(id, input) {
    const body = z
      .object({
        text: z.string().trim().min(1).max(600),
        parentId: z.string().uuid().nullable().default(null),
      })
      .strict()
      .parse(input);
    this.editable(id);
    this.change((d) => {
      const t = d.threads.find((t) => t.id === id),
        comments = (t.comments ||= []);
      if (comments.length >= 150) throw Error('댓글은 150개까지 남길 수 있습니다.');
      const parent = body.parentId
        ? comments.find((c) => c.id === body.parentId && !c.deleted)
        : null;
      if (body.parentId && !parent) throw Error('답글 대상이 없습니다.');
      comments.push({
        id: randomUUID(),
        residentId: null,
        name: this.s.settings.streamer,
        text: body.text,
        parentId: parent?.parentId || parent?.id || null,
        at: this.s.now(),
      });
    });
    this.s.publish();
    return this.detail(id);
  }
  recommend(id, input) {
    const { recommended } = z.object({ recommended: z.boolean() }).strict().parse(input);
    this.editable(id);
    this.change((d) => {
      const t = d.threads.find((t) => t.id === id);
      t.votes = (t.votes || []).filter((v) => v !== 'streamer');
      if (recommended) t.votes.push('streamer');
    });
    this.s.publish();
    return this.detail(id);
  }
  removeComment(id, commentId) {
    this.editable(id);
    z.string().uuid().parse(commentId);
    this.change((d) => {
      const t = d.threads.find((t) => t.id === id),
        c = t.comments?.find((c) => c.id === commentId);
      if (!c) throw Error('댓글이 없습니다.');
      c.deleted = true;
      c.text = '삭제된 댓글입니다.';
    });
    if (this.s.communityActivity.active?.social) this.s.communityActivity.interrupt();
    this.s.publish();
    return this.detail(id);
  }
  attach(id, buffer, name) {
    const t = this.editable(id);
    if ((t.attachments || []).length >= 4) throw Error('첨부는 글당 4개까지 가능합니다.');
    const a = this.media.save(buffer, name);
    try {
      this.change((d) => {
        (d.threads.find((t) => t.id === id).attachments ||= []).push(a);
      });
    } catch (e) {
      this.media.remove(a);
      throw e;
    }
    this.s.publish();
    return this.detail(id);
  }
  removeAttachment(id, attachmentId) {
    const t = this.editable(id),
      a = t.attachments?.find((a) => a.id === attachmentId);
    if (!a) throw Error('첨부를 찾을 수 없습니다.');
    this.change((d) => {
      const t = d.threads.find((t) => t.id === id);
      t.attachments = t.attachments.filter((a) => a.id !== attachmentId);
    });
    if (!a.clipId) this.media.remove(a);
    this.s.publish();
    return this.detail(id);
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
    for (const thread of this.data().threads) {
      if (
        (kind === 'thread' && ids.includes(thread.id)) ||
        (kind === 'journal' && ids.includes(thread.source?.id))
      )
        for (const attachment of thread.attachments || [])
          if (!attachment.clipId)
            try {
              this.media.remove(attachment);
            } catch {
              this.s.log('삭제한 게시글의 첨부 정리를 완료하지 못했습니다.');
            }
    }
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
        topics = c.topics.filter((t) => !d.preferences.mutedTopics.includes(t.id)),
        recent = d.threads.filter((t) => t.communityId === c.id && this.visible(t)),
        lastCommunity = recent.at(-1),
        topic = [...topics].sort(
          (a, b) =>
            (recent.filter((t) => t.topicId === a.id).at(-1)?.at || 0) -
            (recent.filter((t) => t.topicId === b.id).at(-1)?.at || 0),
        )[0],
        canPost = !lastCommunity || now - lastCommunity.at >= 20 * 60000;
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
        const ownPosts = d.threads.filter((t) => t.residentId === r.id),
          latest = ownPosts.at(-1),
          lastDaily = ownPosts.filter((t) => t.kind === 'daily').at(-1),
          dailyTopic =
            topics.find((t) => t.id === topic.id && t.id !== lastDaily?.topicId) ||
            topics[(topics.findIndex((t) => t.id === lastDaily?.topicId) + 1) % topics.length];
        if (canPost && (!latest || now - latest.at >= 2 * 3600000))
          out.push({
            kind: 'social-daily',
            id: r.id,
            viewer: r.persona,
            raw: { residentId: r.id, communityId: c.id, topicId: dailyTopic.id },
            revision: digest({ r: r.id, day: Math.floor(now / 7200000) }),
            weight: r.admitted ? 4 : 12,
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
        if (canPost && entry && (!latest || now - latest.at >= 3600000))
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
        const discussion = d.threads
          .slice()
          .reverse()
          .find(
            (t) =>
              t.communityId === c.id &&
              this.visible(t) &&
              !d.preferences.mutedTopics.includes(t.topicId) &&
              (t.comments || []).length < 150 &&
              (t.residentId !== r.id ||
                (t.comments || []).some((c) => !c.deleted && c.residentId !== r.id)) &&
              !(t.activityReads || []).some(
                (read) =>
                  read.residentId === r.id && read.revision === socialDiscussionHash(t, r.id),
              ),
          );
        if (discussion)
          out.push({
            kind: 'social-discuss',
            id: discussion.id,
            viewer: r.persona,
            raw: {
              residentId: r.id,
              communityId: c.id,
              topicId: discussion.topicId,
              threadId: discussion.id,
              threadHash: socialContentHash(discussion),
              discussionHash: socialDiscussionHash(discussion, r.id),
            },
            revision: socialDiscussionHash(discussion, r.id),
            weight: 5,
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
                (x) =>
                  x.residentId === r.id &&
                  x.threadId === t.id &&
                  x.threadHash === socialContentHash(t),
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
                threadHash: socialContentHash(t),
                source: t.source,
              },
              revision: digest(t),
              weight: 3,
            });
        }
      }
      // A real returning viewer can participate in one community; no invented witness.
      if (canPost && d.residents.length < 128) {
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
      liveSequence = d.liveSequence,
      c = communities.find((c) => c.id === input.communityId),
      topic = c.topics.find((t) => t.id === input.topicId),
      birth = target.kind === 'social-birth';
    operation.social = true;
    const signal = AbortSignal.any([operation.controller.signal, AbortSignal.timeout(90000)]);
    const opId = randomUUID();
    const source = input.source,
      thread = input.threadId ? d.threads.find((t) => t.id === input.threadId) : null;
    const original = source ? s.journal.data.entries.find((e) => e.id === source.id) : null;
    const discussing = target.kind === 'social-discuss';
    const delivered = thread
      ? {
          id: thread.id,
          title: thread.title,
          text: thread.text,
          ...(discussing
            ? {
                author: this.data().residents.find((r) => r.id === thread.residentId)?.persona.name,
                authorPersonaId: this.data().residents.find((r) => r.id === thread.residentId)
                  ?.persona.id,
                comments: (thread.comments || [])
                  .filter((c) => !c.deleted)
                  .slice(-30)
                  .map(({ id, name, text, parentId }) => ({ id, name, text, parentId })),
                attachments: (thread.attachments || []).map((a) => ({
                  kind: a.kind,
                  name: a.name,
                })),
              }
            : {}),
        }
      : original
        ? { text: original.text.slice(0, 600), speaker: original.name }
        : null;
    const valid = () =>
      !signal.aborted &&
      !s.communityActivity.closed &&
      s.epoch === operation.epoch &&
      this.enabled() &&
      this.data().profileGeneration === generation &&
      this.data().liveSequence === liveSequence &&
      s.ai.allowed('community') &&
      !s.settings.personas.some(p=>p.id===target.viewer.id&&!p.enabled) &&
      !this.data().preferences.mutedCommunities.includes(c.id) &&
      !this.data().preferences.mutedTopics.includes(topic.id) &&
      (!source || this.validSource(source)) &&
      (!thread ||
        this.data().threads.some(
          (t) => t.id === thread.id && socialContentHash(t) === input.threadHash && this.visible(t),
        )) &&
      (!discussing ||
        socialDiscussionHash(
          this.data().threads.find((t) => t.id === thread.id),
          input.residentId,
        ) === input.discussionHash) &&
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
      : discussing
        ? '제공된 게시글과 댓글을 읽고 본인 취향에 따라 짧은 댓글 하나를 messages에 쓰거나 침묵한다. delivered.authorPersonaId는 원글 작성자이고 너의 personaId와 다르면 타인의 글이다. 원글의 경험이나 제작물을 자신의 일로 말하거나 작성자인 척 답하지 않는다. 답글이면 제공된 댓글 id를 replyTo에 쓴다. communityVotes에는 게시글 추천 여부를 독립적으로 판단한다. 첨부는 파일 이름만 전달됐으며 이미지나 영상을 봤다고 주장하지 않는다. 직접 방송을 본 것으로 기억하지 않는다.'
        : target.kind === 'social-read'
          ? '제공된 게시글을 실제로 읽는 가상 사건이다. 방송 방문은 의무가 아니다. 글을 읽고 그냥 지나쳐도 정상이며, 본인 취향과 맞아 방송에 관심이 생겼을 때만 communityVotes에 자신의 personaId와 recommended=true, 아니면 false를 반환한다. messages는 비운다. 직접 방송을 목격했다고 주장하지 않는다.'
          : target.kind === 'social-mention'
            ? '제공된 공개 방송 발언만 직접 목격 근거다. 공동체 취향에 맞는 짧은 감상 글 하나를 messages에 쓰거나 침묵한다. 다른 사건/영상/관객/친분을 지어내지 않는다.'
            : '이곳은 특정 방송인의 팬 게시판이 아니다. 방송을 보거나 관객이 되지 않아도 계속 머무는 일반 주민으로서, 방송인과 무관한 이 공동체의 일상 글 하나를 messages에 쓴다. 공동체의 말투와 규범을 반영하되 홍보나 방문 예고로 마무리하지 않는다. 주제에 대한 독립적인 취향·시행착오를 한국어 게시글 말투로 표현한다. 현실 뉴스/유행/날짜/실제 사이트 방문을 지어내지 않는다. 침묵도 정상이다.';
    let readDecision = null;
    if(target.kind === 'social-read' && delivered && s.decision?.enabled('community-affinity','community')) {
      readDecision = await communityInterest(s, {
        state:communityProjection(target.viewer,delivered),
        scope:{epoch:operation.epoch,generation,liveSequence,threadId:thread.id,hash:input.threadHash,residentId:input.residentId}, signal, valid,
      });
      if(!valid())return;
    }
    let result = null;
    if(!readDecision) {
    s.reserveCall();
    result = await s.provider.react(
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
          recentPosts: !thread
            ? d.threads
                .filter((t) => this.visible(t) && t.kind === 'daily' && s.now() - t.at < 86400000)
                .slice(-12)
                .map((t) => ({ communityId: t.communityId, topicId: t.topicId, text: t.text }))
            : [],
          instruction:
            instruction +
            (!birth && !thread
              ? ' 최근 글과 같은 사건·질문·결론을 표현만 바꿔 반복하지 않는다. 다른 관심사나 구체적인 소재를 선택하고 차이가 없으면 침묵한다.'
              : '') +
            (d.preferences.creativeImages && target.kind === 'social-daily'
              ? ' 창작 이미지 옵션이 켜져 있다. 이번 일상 글과 관련된 작은 창작 픽셀 그림을 직접 구성하고 scene 문자열에 JSON으로 담는다: {"palette":["#112233","#aabbcc"],"pixels":["0000000000000000",...16줄]}. palette는 2~8색, pixels는 0~7 색번호 16글자씩 정확히16줄이다. scene에는 설명이나 코드펜스 없이 JSON만 쓴다. 그림을 언급만 하고 실제 데이터를 생략하지 않는다. 글은 messages에 쓴다. 글 자체를 쓰지 않으면 그림도 생략한다.'
              : ''),
        },
      },
      signal,
    );
    }
    if (!valid()) return;
    if(readDecision) s.decision.assertCurrent(readDecision.result);
    else s.ai.assertCurrent(result);
    const observation = Observation.parse(result?.observation || {game:'일상',scene:'',confidence:0,excitement:0,messages:[]});
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
    let applied = 'no-post',
      generated = null;
    const duplicate =
      message &&
      !thread &&
      this.data().threads.some(
        (t) =>
          this.visible(t) && s.now() - t.at < 86400000 && similarSocialText(t.text, message.text),
      );
    if (
      message &&
      !duplicate &&
      !thread &&
      target.kind === 'social-daily' &&
      this.data().preferences.creativeImages
    ) {
      const png = pixelPng(observation.scene);
      if (png) generated = this.media.save(png, '주민 창작 그림.png', true);
    }
    try {
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
          applied = 'resident-created';
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
        if (discussing) {
          const t = next.threads.find((t) => t.id === thread.id),
            comments = (t.comments ||= []);
          let m = message,
            parent = m?.replyTo ? comments.find((c) => c.id === m.replyTo && !c.deleted) : null;
          if (m?.replyTo && !parent) m = null;
          if (m && comments.some((c) => !c.deleted && similarSocialText(c.text, m.text))) m = null;
          if (m && comments.length < 150)
            comments.push({
              id: randomUUID(),
              residentId: resident.id,
              name: resident.persona.name,
              text: m.text,
              parentId: parent?.parentId || parent?.id || null,
              at: now,
            });
          const vote = observation.communityVotes.find((v) => v.personaId === resident.persona.id);
          if (vote) {
            t.votes = (t.votes || []).filter((id) => id !== resident.id);
            if (vote.recommended) t.votes.push(resident.id);
          }
          t.activityReads = (t.activityReads || []).filter((r) => r.residentId !== resident.id);
          t.activityReads.push({
            residentId: resident.id,
            revision: socialDiscussionHash(t, resident.id),
            at: now,
          });
          applied = m ? 'comment-created' : 'read-only';
        } else if (target.kind === 'social-read') {
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
            interested: readDecision?.interested ?? !!observation.communityVotes.find(
              (v) => v.personaId === resident.persona.id && v.recommended,
            ),
            source,
          });
          applied = 'read-only';
        } else if (message && !duplicate) {
          const attachment = generated || this.sharedClip(source, resident.persona.id);
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
            ...(attachment ? { attachments: [attachment] } : {}),
          });
          applied = 'post-created';
        }
      });
    } catch (error) {
      if (generated) this.media.remove(generated);
      throw error;
    }
    s.tokens += Number(result?.usage?.total_tokens) || 0;
    if(readDecision)s.decision.accepted(readDecision.result);
    else s.ai.accepted(result, applied);
    s.publish();
  }
  memoryCandidates(personaId) {
    const d = this.data();
    if (!d || d.quarantined) return [];
    const resident = d.residents.find((r) => r.persona.id === personaId);
    if (!resident) return [];
    return d.receipts
      .filter((r) => r.residentId === resident.id && this.validReceipt(r))
      .map((receipt) => {
        const thread = d.threads.find((t) => t.id === receipt.threadId);
        return {
          id: receipt.id,
          fingerprint: digest({ receipt, content: socialContentHash(thread) }),
          text: thread.text,
          project: () => {
            const row = {
              experience: 'heard-from-community',
              community: communities.find((c) => c.id === thread.communityId).name,
              text: thread.text,
              receivedAt: receipt.receivedAt,
            };
            this.recalledSources.set(row, {
              personaId,
              id: receipt.id,
              fingerprint: digest({ receipt, content: socialContentHash(thread) }),
            });
            return row;
          },
        };
      });
  }
  memoryCandidatesCurrent(personaId, candidates) {
    if (!candidates.length) return true;
    const current = new Map(this.memoryCandidates(personaId).map((c) => [c.id, c.fingerprint]));
    return candidates.every((c) => c && current.get(c.id) === c.fingerprint);
  }
  captureMemory(personaId, rows) {
    const sources = rows.map((row) => this.recalledSources.get(row));
    return () =>
      sources.every((source) => source?.personaId === personaId) &&
      this.memoryCandidatesCurrent(personaId, sources);
  }
  memory(personaId, { preferredIds = [] } = {}) {
    const candidates = this.memoryCandidates(personaId),
      preferred = new Set(preferredIds);
    const selected = new Set(
      [
        ...candidates.filter((c) => preferred.has(c.id)),
        ...candidates.filter((c) => !preferred.has(c.id)).reverse(),
      ]
        .slice(0, 3)
        .map((c) => c.id),
    );
    // Preserve the original receipt chronology, including an unchanged baseline.
    return candidates.filter((c) => selected.has(c.id)).map((c) => c.project());
  }
  validReceipt(r) {
    const d = this.data(),
      t = d.threads.find((t) => t.id === r.threadId);
    return (
      !!t &&
      !d.preferences.mutedCommunities.includes(t.communityId) &&
      !d.preferences.mutedTopics.includes(t.topicId) &&
      this.visible(t) &&
      socialContentHash(t) === r.threadHash &&
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
export function socialRoutes(app, studio, mediaDir) {
  studio.social.media = new SocialMedia(mediaDir);
  app.post('/api/social/threads/:id/comments', (req, res) =>
    res.json(studio.social.comment(req.params.id, req.body)),
  );
  app.delete('/api/social/threads/:id/comments/:commentId', (req, res) =>
    res.json(studio.social.removeComment(req.params.id, req.params.commentId)),
  );
  app.put('/api/social/threads/:id/recommendation', (req, res) =>
    res.json(studio.social.recommend(req.params.id, req.body)),
  );
  app.post(
    '/api/social/threads/:id/attachments',
    express.raw({ type: 'application/octet-stream', limit: '24mb' }),
    (req, res) =>
      res.json(
        studio.social.attach(
          req.params.id,
          req.body,
          decodeURIComponent(req.get('X-File-Name') || '첨부파일'),
        ),
      ),
  );
  app.delete('/api/social/threads/:id/attachments/:attachmentId', (req, res) =>
    res.json(studio.social.removeAttachment(req.params.id, req.params.attachmentId)),
  );
  app.get('/api/social/threads/:id/attachments/:attachmentId', (req, res) => {
    const t = studio.social.editable(req.params.id),
      a = t.attachments?.find((a) => a.id === req.params.attachmentId);
    if (!a) return res.status(404).json({ error: '첨부를 찾을 수 없습니다.' });
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    res.type(a.mime);
    const file = studio.social.mediaFile(a);
    if (file) return res.sendFile(file);
    if (!a.clipId && studio.social.media.exists(a)) return res.send(studio.social.media.read(a));
    res.status(404).json({ error: '원본 첨부파일이 없습니다.' });
  });
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
