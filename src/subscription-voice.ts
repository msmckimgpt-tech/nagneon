type Recovery = {
  runId: string;
  inputEpoch: string;
  sessionId: string;
  frameStart: number;
  frameEnd: number;
  startedAt: number;
  leadMs: number;
};
type Options = {
  endpoint?: 'native-audio' | 'subscription-sound';
  inputEpoch: string;
  signal: AbortSignal;
  onError: (message: string) => void;
  onRecoveryError?: (message: string) => void;
  recovery?: Recovery;
  ownerEpoch?: string;
};

// The provider uses a bidirectional RTP session. Incoming tracks are disabled
// and stopped, and no audio element or speaker destination is ever created.
export class SubscriptionVoiceStream {
  private pc: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private sender: RTCRtpSender | null = null;
  private track: MediaStreamTrack | null = null;
  private lifetime = new AbortController();
  private queue: unknown[] = [];
  private queueBytes = 0;
  private sending = false;
  private sequence = 0;
  private runId = '';
  private closed = false;
  private failed = false;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private abort: () => void;
  private replay: SubscriptionVoiceStream | null = null;
  private context: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private options: Options;
  constructor(options: Options) {
    this.options = options;
    this.abort = () => this.close();
    options.signal.addEventListener('abort', this.abort, { once: true });
  }
  private async request<T>(path: string, body: unknown, timeoutMs = 5000): Promise<T> {
    const signal = AbortSignal.any([
      this.options.signal,
      this.lifetime.signal,
      AbortSignal.timeout(timeoutMs),
    ]);
    signal.throwIfAborted();
    const response = await fetch('/api/' + (this.options.endpoint || 'native-audio') + '/' + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Backseat-Client': 'studio' },
      body: JSON.stringify(body),
      signal,
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '구독 음성 연결에 실패했습니다.');
    return result as T;
  }
  async connect() {
    this.options.signal.throwIfAborted();
    this.pc = new RTCPeerConnection({ iceServers: [] });
    this.sender = this.pc.addTransceiver('audio', { direction: 'sendrecv' }).sender;
    this.pc.ontrack = (event) => {
      event.track.enabled = false;
      event.track.stop();
    };
    this.pc.onconnectionstatechange = () => {
      if (
        !this.closed &&
        this.pc &&
        ['failed', 'closed', 'disconnected'].includes(this.pc.connectionState)
      )
        this.fail('구독 음성 연결이 끊겼습니다. 보존한 원음을 확인하고 다시 연결해주세요.');
    };
    this.channel = this.pc.createDataChannel('oai-events', { ordered: true });
    this.channel.onmessage = (event) => this.receive(event.data);
    this.channel.onclose = () => {
      if (!this.closed) this.fail('구독 음성 수신 연결이 종료됐습니다.');
    };
    await this.pc.setLocalDescription(await this.pc.createOffer());
    await new Promise<void>((resolve) => {
      if (this.pc?.iceGatheringState === 'complete') return resolve();
      const timer = setTimeout(resolve, 1000);
      this.pc!.onicegatheringstatechange = () => {
        if (this.pc?.iceGatheringState === 'complete') {
          clearTimeout(timer);
          resolve();
        }
      };
    });
    if (this.closed || !this.pc.localDescription) throw new Error('음성 연결을 취소했습니다.');
    const result = await this.request<{ sdp: string; runId: string }>(
      this.options.recovery ? 'recovery/connection' : 'connection',
      {
        inputEpoch: this.options.ownerEpoch || this.options.inputEpoch,
        sdp: this.pc.localDescription.sdp,
        ...(this.options.recovery ? { runId: this.options.recovery.runId } : {}),
      },
      35000,
    );
    if (this.closed) throw new Error('음성 연결을 취소했습니다.');
    this.runId = result.runId;
    await this.pc.setRemoteDescription({ type: 'answer', sdp: result.sdp });
    const deadline = Date.now() + 10000;
    while (!this.closed && this.channel.readyState !== 'open' && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 50));
    if (this.closed || this.channel.readyState !== 'open')
      throw new Error('구독 음성 통신을 시작하지 못했습니다.');
    this.heartbeat = setInterval(() => {
      void this.request(
        'heartbeat',
        { inputEpoch: this.options.inputEpoch, runId: this.runId },
        3000,
      ).catch(() => this.fail('구독 음성 상태 확인이 끊겨 마이크를 중지했습니다.'));
    }, 2000);
  }
  async registerClock(startedAt: number) {
    await this.request('clock', {
      inputEpoch: this.options.inputEpoch,
      runId: this.runId,
      startedAt,
      monotonicMs: performance.now(),
    });
  }
  async attach(track: MediaStreamTrack) {
    if (this.closed || !this.sender) throw new Error('구독 음성 연결이 종료됐습니다.');
    this.track = track.clone();
    await this.sender.replaceTrack(this.track);
    if (this.closed) {
      this.track.stop();
      throw new Error('음성 연결을 취소했습니다.');
    }
  }
  async recover() {
    for (let attempt = 0; attempt < 2 && !this.closed; attempt++) {
      try {
        const { recovery } = await this.request<{ recovery: Recovery | null }>('recovery', {
          inputEpoch: this.options.inputEpoch,
        });
        if (!recovery || this.closed) return;
        const replay = new SubscriptionVoiceStream({
          endpoint: this.options.endpoint,
          inputEpoch: recovery.inputEpoch,
          ownerEpoch: this.options.inputEpoch,
          recovery,
          signal: AbortSignal.any([this.options.signal, this.lifetime.signal]),
          onError: (message) => this.options.onRecoveryError?.(message),
        });
        this.replay = replay;
        try {
          await replay.replayOriginal();
        } finally {
          replay.close();
          if (this.replay === replay) this.replay = null;
        }
      } catch {
        if (!this.closed)
          this.options.onRecoveryError?.(
            '남은 원음을 자동 복구하지 못했습니다. 원음과 확인이 필요한 구간은 보존합니다.',
          );
        return;
      }
    }
  }
  private async replayOriginal() {
    const recovery = this.options.recovery!;
    const result = await this.request<{ audio: string; sha256: string }>('recovery/audio', {
      inputEpoch: this.options.ownerEpoch,
      runId: recovery.runId,
    });
    if (result.audio.length > 600000) throw new Error('복구 원음의 크기가 한도를 넘었습니다.');
    const bytes = Uint8Array.from(atob(result.audio), (c) => c.charCodeAt(0));
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
      .map((n) => n.toString(16).padStart(2, '0'))
      .join('');
    if (hash !== result.sha256) throw new Error('복구 원음의 전송 해시가 다릅니다.');
    await this.connect();
    if (this.closed) throw new Error('원음 복구를 취소했습니다.');
    const context = (this.context = new AudioContext({ sampleRate: 48000 }));
    const audio = await context.decodeAudioData(bytes.buffer);
    const seconds = (recovery.frameEnd - recovery.frameStart) / 16000;
    if (Math.abs(audio.duration - seconds) > 0.01 || seconds > 12)
      throw new Error('복구 원음 구간의 길이가 다릅니다.');
    const destination = context.createMediaStreamDestination(),
      lead = recovery.leadMs / 1000,
      tail = 4;
    const padded = context.createBuffer(
      1,
      Math.ceil((lead + seconds + tail) * context.sampleRate),
      context.sampleRate,
    );
    padded.copyToChannel(audio.getChannelData(0), 0, Math.round(lead * context.sampleRate));
    const source = (this.source = context.createBufferSource());
    source.buffer = padded;
    source.connect(destination);
    // Only the RTP destination receives audio. Never connect to context.destination.
    await this.attach(destination.stream.getAudioTracks()[0]);
    destination.stream.getTracks().forEach((track) => track.stop());
    const signal = AbortSignal.any([this.options.signal, this.lifetime.signal]);
    signal.throwIfAborted();
    await context.resume();
    await new Promise<void>((resolve, reject) => {
      const done = (error?: Error) => {
        clearTimeout(timer);
        signal.removeEventListener('abort', cancel);
        source.onended = null;
        error ? reject(error) : resolve();
      };
      const cancel = () => done(new Error('원음 복구를 취소했습니다.'));
      const timer = setTimeout(
        () => done(new Error('원음 재전송 시간이 초과됐습니다.')),
        (lead + seconds + tail) * 1000 + 3000,
      );
      signal.addEventListener('abort', cancel, { once: true });
      source.onended = () => done();
      source.start();
    });
    for (let i = 0; i < 60 && this.sending && !this.closed; i++)
      await new Promise((resolve) => setTimeout(resolve, 50));
    if (this.sending) throw new Error('복구 전사를 전달하지 못했습니다.');
    await this.flush();
    if (this.closed) throw new Error('원음 복구 연결이 종료됐습니다.');
    await this.request(
      'recovery/finish',
      { inputEpoch: this.options.ownerEpoch, runId: recovery.runId },
      6000,
    );
  }
  private receive(value: unknown) {
    if (this.closed || typeof value !== 'string') return;
    if (value.length > 65536) {
      this.fail('구독 음성 수신 크기가 한도를 넘었습니다.');
      return;
    }
    let event;
    try {
      event = JSON.parse(value);
    } catch {
      return;
    }
    if (event.type === 'error') {
      this.fail('구독 음성 제공처가 연결 오류를 보냈습니다.');
      return;
    }
    let input;
    if (event.type === 'input_transcript.added')
      input = {
        type: event.type,
        start_ms: event.start_ms,
        end_ms: event.end_ms,
        item: event.item,
      };
    else if (['turn.created', 'turn.done'].includes(event.type) && event.turn?.role === 'user')
      input = { type: event.type, turn: event.turn };
    else return;
    this.queueBytes += JSON.stringify(input).length;
    if (this.queue.length >= 128 || this.queueBytes > 512000) {
      this.fail('음성 전사 전달이 밀려 연결을 중지했습니다. 원음은 복구 기록에 보존합니다.');
      return;
    }
    this.queue.push(input);
    if (!this.flushTimer)
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        void this.flush();
      }, 100);
  }
  private async flush() {
    if (this.closed || this.sending || !this.runId) return;
    this.sending = true;
    try {
      while (this.queue.length && !this.closed) {
        const events = this.queue.slice(0, 24),
          sequence = this.sequence + 1;
        let delivered = false;
        for (let attempt = 0; attempt < 3 && !this.closed; attempt++) {
          try {
            const result = await this.request<{ active: boolean }>(
              'events',
              { inputEpoch: this.options.inputEpoch, runId: this.runId, sequence, events },
              2500,
            );
            delivered = true;
            if (!result.active) this.close();
            break;
          } catch (error) {
            if (attempt === 2) throw error;
            await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
          }
        }
        if (!delivered) return;
        this.sequence = sequence;
        this.queue.splice(0, events.length);
        this.queueBytes = this.queue.reduce<number>(
          (sum, item) => sum + JSON.stringify(item).length,
          0,
        );
      }
    } catch (error) {
      this.fail(error instanceof Error ? error.message : '구독 음성 전사를 전달하지 못했습니다.');
    } finally {
      this.sending = false;
    }
  }
  private fail(message: string) {
    if (this.failed || this.closed) return;
    this.failed = true;
    this.close();
    this.options.onError(message);
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.replay?.close();
    this.replay = null;
    try {
      this.source?.stop();
    } catch {}
    this.source?.disconnect();
    void this.context?.close().catch(() => {});
    this.track?.stop();
    if (this.sender?.track) void this.sender.replaceTrack(null).catch(() => {});
    this.channel?.close();
    this.pc?.close();
    for (const receiver of this.pc?.getReceivers() || []) receiver.track.stop();
    this.lifetime.abort();
    this.options.signal.removeEventListener('abort', this.abort);
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.queue = [];
    this.queueBytes = 0;
    void fetch(
      '/api/' +
        (this.options.endpoint || 'native-audio') +
        '/' +
        (this.options.recovery ? 'recovery/finish' : 'stop'),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Backseat-Client': 'studio' },
        body: JSON.stringify(
          this.options.recovery
            ? {
                inputEpoch: this.options.ownerEpoch,
                runId: this.runId || this.options.recovery.runId,
              }
            : { inputEpoch: this.options.inputEpoch },
        ),
        signal: AbortSignal.timeout(2000),
        keepalive: true,
      },
    ).catch(() => {});
  }
}
