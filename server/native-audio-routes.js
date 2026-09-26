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
  app.post('/api/native-audio/context', (req, res) => {
    audio.attachContext(req.body);
    res.json({ ok: true });
  });
  app.post('/api/native-audio/stop', (req, res) => {
    const { inputEpoch } = z.object({ inputEpoch: z.string().uuid() }).strict().parse(req.body);
    if (audio.session?.inputEpoch === inputEpoch) audio.stop();
    res.json(audio.snapshot());
    studio.publish();
  });
}
