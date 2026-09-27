import { z } from 'zod';
import { SubscriptionVoice } from './subscription-voice.js';

// A separate source preserves game dialogue attribution and microphone order.
// It shares the bounded subscription transport and durable recovery contract.
export class SubscriptionSound extends SubscriptionVoice {
  constructor(options) {
    super({ ...options, inputSource: 'system-output' });
  }
  allowed() {
    super.allowed();
    if (this.config().consentVersion !== 2)
      throw new Error('연결 설정에서 마이크와 게임·시스템 소리의 전송 범위를 확인해주세요.');
  }
  async start(value, signal) {
    const result = await super.start(value, signal);
    this.studio.sound.start(this.session.inputEpoch);
    return result;
  }
  receivePlan(plan, source) {
    return this.studio.sound.receiveSubscription({
      id: plan.id,
      sessionId: source.sessionId,
      inputEpoch: source.inputEpoch,
      text: plan.text,
      capture: plan.capture,
      witnesses: plan.hearers,
    });
  }
  stop(reason) {
    if (this.session) this.studio.sound.stop(this.session.inputEpoch);
    return super.stop(reason);
  }
}

export function subscriptionSoundRoutes(app, voice, studio) {
  const call = (method) => async (req, res) => {
    const controller = new AbortController();
    const disconnect = () => {
      if (!res.writableEnded) controller.abort();
    };
    res.on('close', disconnect);
    try {
      const result = await voice[method](req.body, controller.signal);
      if (!controller.signal.aborted) res.json(result);
    } finally {
      res.off('close', disconnect);
      studio.publish();
    }
  };
  for (const [path, method] of [
    ['start', 'start'],
    ['connection', 'connect'],
    ['clock', 'clock'],
    ['events', 'events'],
    ['recovery', 'prepareRecovery'],
    ['recovery/connection', 'connectRecovery'],
    ['recovery/audio', 'recoveryAudio'],
    ['recovery/finish', 'finishRecovery'],
  ])
    app.post('/api/subscription-sound/' + path, call(method));
  app.post('/api/subscription-sound/context', (req, res) => {
    voice.attachContext(req.body);
    res.json({ ok: true });
  });
  app.post('/api/subscription-sound/heartbeat', (req, res) => {
    const value = z
      .object({ inputEpoch: z.string().uuid(), runId: z.string().uuid() })
      .strict()
      .parse(req.body);
    res.json(voice.heartbeat(value.inputEpoch, value.runId));
  });
  app.post('/api/subscription-sound/stop', async (req, res) => {
    const value = z.object({ inputEpoch: z.string().uuid() }).strict().parse(req.body);
    if (voice.session?.inputEpoch === value.inputEpoch) await voice.stop('system-audio-ended');
    res.json(voice.snapshot());
    studio.publish();
  });
}
