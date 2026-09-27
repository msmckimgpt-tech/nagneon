import { z } from 'zod';

export function nativeAudioRoutes(app, audio, studio) {
  app.post('/api/native-audio/config', async (req, res) => {
    audio.configure(req.body);
    if (audio.config.mode === 'remote') await audio.releaseLocal();
    res.json(audio.snapshot());
    studio.publish();
  });
  app.post('/api/native-audio/start', async (req, res) => {
    const controller = new AbortController();
    const disconnect = () => {
      if (!res.writableEnded) controller.abort();
    };
    res.on('close', disconnect);
    try {
      const result = await audio.start(req.body, controller.signal);
      if (!controller.signal.aborted) res.json(result);
    } finally {
      res.off('close', disconnect);
      studio.publish();
    }
  });

  const connect = (method) => async (req, res) => {
    const controller = new AbortController(),
      disconnect = () => {
        if (!res.writableEnded) controller.abort();
      };
    res.on('close', disconnect);
    try {
      const result = await audio.subscription[method](req.body, controller.signal);
      if (!controller.signal.aborted) res.json(result);
    } finally {
      res.off('close', disconnect);
    }
  };
  app.post('/api/native-audio/connection', connect('connect'));
  app.post('/api/native-audio/recovery/connection', connect('connectRecovery'));
  app.post('/api/native-audio/recovery', async (req, res) => {
    res.json(await audio.subscription.prepareRecovery(req.body));
  });
  app.post('/api/native-audio/recovery/audio', async (req, res) => {
    res.json(await audio.subscription.recoveryAudio(req.body));
  });
  app.post('/api/native-audio/recovery/finish', async (req, res) => {
    res.json(await audio.subscription.finishRecovery(req.body));
  });
  app.post('/api/native-audio/clock', async (req, res) => {
    res.json(await audio.subscription.clock(req.body));
  });
  app.post('/api/native-audio/events', async (req, res) => {
    res.json(await audio.subscription.events(req.body));
  });
  app.post('/api/native-audio/heartbeat', (req, res) => {
    const value = z
      .object({ inputEpoch: z.string().uuid(), runId: z.string().uuid() })
      .strict()
      .parse(req.body);
    res.json(audio.subscription.heartbeat(value.inputEpoch, value.runId));
  });
  app.post('/api/native-audio/context', (req, res) => {
    audio.attachContext(req.body);
    res.json({ ok: true });
  });
  app.post('/api/native-audio/stop', (req, res) => {
    const { inputEpoch } = z.object({ inputEpoch: z.string().uuid() }).strict().parse(req.body);
    if (
      audio.session?.inputEpoch === inputEpoch ||
      audio.subscription.session?.inputEpoch === inputEpoch
    )
      void audio.stop();
    res.json(audio.snapshot());
    studio.publish();
  });
}
