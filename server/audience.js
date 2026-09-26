import { randomUUID } from 'node:crypto';
import { normalizeLore, relevantLore, LEGACY_NO_EXPIRY } from './community-lore.js';
import profiles from '../shared/discovery.json' with { type: 'json' };
import { createViewerAddressResolver } from './viewer-addressing.js';
import {
  resetPresenceRuntime,
  tickAutonomousPresence,
  observePresence,
} from './audience-presence.js';

/** Research-inspired simulation. Probabilities are product choices, not measured conversion rates. */
export class Audience {
  constructor(data = { members: {}, lore: [], posts: [] }, save = () => {}, random = Math.random) {
    this.data = { ...data, lore: normalizeLore(data.lore) };
    this.save = save;
    this.random = random;
    this.presence = {};
    this.presenceRevision = 0;
    this.lastTick = 0;
    this.lastPresence = 0;
    this.nextArrival = 0;
    this.lastStart = 0;
  }
  setPresence(id, next, now) {
    const before = this.presence[id];
    if (before === next) return;
    const member = this.data.members[id];
    if (member && ['active', 'lurking'].includes(next) && !['active', 'lurking'].includes(before)) {
      // Returning within a broadcast starts a new observation interval, not a
      // second broadcast visit. Known viewers can also arrive after its opening.
      if (!(member.joinedAt >= this.lastStart)) member.sessions++;
      member.joinedAt = Math.max(now, (before === undefined ? -1 : (member.joinedAt ?? -1)) + 1);
    }
    this.presence[id] = next;
    this.presenceRevision++;
  }
  chooseOrigin(settings, now) {
    const entries = Object.entries(settings.discovery.mix).filter(([, w]) => w > 0);
    let pick = this.random() * entries.reduce((sum, [, w]) => sum + w, 0);
    let key = entries.at(-1)?.[0] || 'browse';
    for (const [id, weight] of entries) {
      pick -= weight;
      if (pick < 0) {
        key = id;
        break;
      }
    }
    return { key, label: profiles[key].label, firstSeenAt: now };
  }
  join(p, settings, now) {
    const m = this.data.members[p.id];
    const first = m.sessions === 0;
    if (!m.origin)
      m.origin =
        first && settings.discovery.enabled && p.id !== settings.managerId
          ? this.chooseOrigin(settings, now)
          : { key: 'direct', label: '직접 초대 · 기존 관객', firstSeenAt: now };
    m.sessions++;
    m.joinedAt = now;
    this.setPresence(
      p.id,
      p.id === settings.managerId
        ? 'active'
        : this.random() < settings.lurkRatio
          ? 'lurking'
          : 'active',
      now,
    );
    return `${p.name} ${first ? '첫 방문' : '재방문'}${this.autonomous ? '' : ` · ${m.origin.label}`}`;
  }
  start(settings, now) {
    if (this.autonomous) {
      const before = structuredClone(this.data);
      this.presence = {};
      this.lastTick = now;
      this.lastPresence = now;
      this.lastStart = now;
      resetPresenceRuntime(this, now);
      const events = [];
      try {
        for (const p of settings.personas) {
          const m = this.data.members[p.id];
          if (p.system) {
            this.data.members[p.id] ||= {
              sessions: 0,
              seconds: 0,
              recognized: 0,
              affinity: 0,
              peers: {},
              memories: [],
            };
            events.push(this.join(p, settings, now));
            continue;
          }
          if (!p.enabled || !m?.sessions) {
            this.presence[p.id] = 'away';
            continue;
          }
          if (
            p.id === settings.managerId ||
            (!(m.presenceMemory?.cooldownSeconds > 0) &&
              this.random() <
                Math.min(0.95, 0.5 + m.affinity * 0.35 + Math.min(0.1, m.seconds / 7200)))
          )
            events.push(this.join(p, settings, now));
          else this.presence[p.id] = 'away';
        }
        this.save(this.data);
        return events;
      } catch (error) {
        this.data = before;
        this.presence = {};
        this.presenceRuntime = null;
        throw error;
      }
    }
    this.presence = {};
    this.lastTick = now;
    this.lastPresence = now;
    this.lastStart = now;
    this.nextArrival = now + settings.discovery.arrivalSeconds * 1000;
    const events = [];
    let openingViewer = false;
    for (const p of settings.personas) {
      const m = (this.data.members[p.id] ||= {
        sessions: 0,
        seconds: 0,
        recognized: 0,
        affinity: 0.15,
        peers: {},
        memories: [],
      });
      if (!p.enabled) {
        this.presence[p.id] = 'away';
        continue;
      }
      const returning =
        m.sessions > 0 &&
        this.random() < Math.min(0.95, 0.4 + m.affinity * 0.4 + Math.min(0.15, m.seconds / 7200));
      const opening = p.id !== settings.managerId && !openingViewer;
      if (!settings.discovery.enabled || p.id === settings.managerId || returning || opening) {
        events.push(this.join(p, settings, now));
        if (p.id !== settings.managerId) openingViewer = true;
      } else this.presence[p.id] = 'waiting';
    }
    this.save(this.data);
    return settings.discovery.enabled ? events : [];
  }
  stop() {
    this.presence = {};
    this.presenceRuntime = null;
    this.save(this.data);
  }
  observePresence(observation, witnesses, capturedAt, now, options) {
    observePresence(this, observation, witnesses, capturedAt, now, options);
  }
  tick(settings, now, excitement = 0) {
    if (this.autonomous)
      return this.presenceRuntime ? tickAutonomousPresence(this, settings, now) : [];
    if (now - this.lastTick < 1000) return [];
    const dt = Math.min(60, Math.max(0, (now - this.lastTick) / 1000));
    this.lastTick = now;
    const events = [];
    const changePresence = now - this.lastPresence >= 10000;
    if (changePresence) this.lastPresence = now;
    for (const p of settings.personas) {
      if (!p.enabled) {
        this.setPresence(p.id, 'away', now);
        continue;
      }
      const m = this.data.members[p.id];
      if (!m) continue;
      const present = ['active', 'lurking'].includes(this.presence[p.id]);
      if (present) m.seconds += dt;
      if (p.id === settings.managerId) {
        this.setPresence(p.id, 'active', now);
        continue;
      }
      if (this.presence[p.id] === 'waiting') continue;
      if (changePresence) {
        if (excitement > 0.75 && present && this.random() < 0.4)
          this.setPresence(p.id, 'active', now);
        else if (this.random() < 0.08)
          this.setPresence(
            p.id,
            this.random() < settings.lurkRatio
              ? 'lurking'
              : this.random() < 0.12
                ? 'away'
                : 'active',
            now,
          );
      }
    }
    if (!this.autonomous && settings.discovery.enabled && now >= this.nextArrival) {
      const waiting = settings.personas.filter(
        (p) => p.enabled && this.presence[p.id] === 'waiting',
      );
      if (waiting.length) {
        const p = waiting[Math.min(waiting.length - 1, Math.floor(this.random() * waiting.length))];
        events.push(this.join(p, settings, now));
        this.save(this.data);
      }
      // Avoid catch-up floods after system suspend or a slow request.
      this.nextArrival = now + settings.discovery.arrivalSeconds * 1000;
    }
    return events;
  }
  addressing(settings, now = Date.now()) {
    return createViewerAddressResolver(settings.personas, this.data.members, now);
  }
  context(
    settings,
    speech = '',
    excitement = 0,
    {
      hearers = null,
      company = false,
      continuousCompany = false,
      reactive = false,
      addressViewers = this.addressing(settings),
    } = {},
  ) {
    const candidates = [],
      lurkers = [],
      addressed = addressViewers(speech);
    for (const p of settings.personas.filter((p) => p.enabled)) {
      if (hearers && !hearers.includes(p.id)) continue;
      const member = this.data.members[p.id];
      const named =
        addressed.has(p.id) &&
        ['active', 'lurking'].includes(this.presence[p.id]) &&
        member?.joinedAt >= this.lastStart;
      if (named) {
        this.presence[p.id] = 'active';
        member.recognized++;
        member.affinity = Math.min(1, member.affinity + 0.025);
      }
      const interest = profiles[member?.origin?.key];
      const active = this.presence[p.id] === 'active';
      const occasional =
        (company || reactive) &&
        this.presence[p.id] === 'lurking' &&
        !p.system &&
        p.id !== settings.managerId &&
        member?.joinedAt >= this.lastStart;
      if (active || occasional)
        (active ? candidates : lurkers).push({
          id: p.id,
          score:
            this.random() +
            (p.sociability ?? 0.6) * 0.4 +
            (interest?.sociability ?? 0.5) * 0.15 +
            (named ? 2 : 0) +
            (p.id === settings.managerId ? -0.4 : 0),
        });
    }
    // Watching quietly does not mean unable to speak. With fresh witnessed
    // input or a company opportunity, one lurker may volunteer without changing their presence,
    // affinity or visit. The model can still choose silence or current gameplay.
    const volunteers = lurkers
      .sort((a, b) => b.score - a.score)
      .slice(0, company && continuousCompany ? 2 : 1);
    candidates.push(...volunteers);
    const eligible = candidates
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.min(settings.chatPace + 1, settings.personas.length))
      .map((p) => p.id);
    return {
      eligible,
      members: settings.personas
        .filter((p) => p.enabled)
        .map((p) => {
          const {
            presenceMemory,
            speechStyleAdaptation,
            speechStyleOverlay,
            speechStyleBoundary,
            lastBanterAt,
            ...m
          } = this.data.members[p.id] || {};
          return {
            id: p.id,
            presence: this.presence[p.id] || 'away',
            ...m,
            relationship:
              m?.sessions >= 3 && m?.seconds >= 600
                ? '단골'
                : m?.sessions > 1
                  ? '재방문'
                  : '첫 방문',
            arrivalInterest:
              profiles[m?.origin?.key]?.intent ||
              '직접 초대한 관객. 개인 설정과 실제 기억을 따른다.',
          };
        }),
      lore: relevantLore(this.data.lore, speech),
      offStreamPosts: this.data.posts.slice(-8),
      rhythm: excitement > 0.75 ? '짧은 공동 반응 뒤 안정' : '평소 대화. 침묵과 관망도 자연스럽다',
    };
  }
  message(personaId, text, settings) {
    const m = this.data.members[personaId];
    if (!m) return;
    m.memories.push(text);
    m.memories = m.memories.slice(-8);
    for (const id of this.addressing(settings)(text))
      if (id !== personaId) m.peers[id] = Math.min(20, (m.peers[id] || 0) + 1);
  }
  post(post) {
    if (this.data.posts.length >= 200)
      throw Error('게시판 글은 200개까지 보관합니다. 이전 글을 정리해주세요.');
    const next = structuredClone(this.data);
    next.posts.push(post);
    this.save(next);
    this.data = next;
  }
  lore(text) {
    const next = structuredClone(this.data),
      entry = { id: randomUUID(), text, createdAt: Date.now(), expiresAt: LEGACY_NO_EXPIRY };
    next.lore.push(entry);
    this.save(next);
    this.data = next;
    return entry;
  }
  forgetLore(id) {
    const next = structuredClone(this.data);
    next.lore = next.lore.filter((item) => item.id !== id);
    if (next.lore.length === this.data.lore.length) return false;
    this.save(next);
    this.data = next;
    return true;
  }
}
