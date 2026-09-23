import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { resolve, join } from 'node:path';
import { SpeechRecoveryStore } from '../server/speech-recovery-store.js';

const args = process.argv.slice(2),
  option = (name) => {
    const at = args.indexOf(name);
    return at < 0 ? null : args[at + 1];
  };
const dataDir = option('--data-dir');
if (!dataDir) {
  console.error(
    '사용법: node scripts/export-speech-recovery.mjs --data-dir <앱 데이터 폴더> --list | --session <ID> --epoch <ID> --output <새 WAV 경로>',
  );
  process.exitCode = 2;
} else {
  const store = new SpeechRecoveryStore(join(resolve(dataDir), 'speech-recovery'));
  if (args.includes('--list')) {
    for (const item of await store.list()) console.log(JSON.stringify(item));
  } else {
    const sessionId = option('--session'),
      inputEpoch = option('--epoch'),
      output = option('--output');
    if (!sessionId || !inputEpoch || !output) {
      console.error('방송 ID, 입력 epoch, 새 WAV 출력 경로가 필요합니다.');
      process.exitCode = 2;
    } else {
      const audio = await store.download(sessionId, inputEpoch);
      if (!audio) {
        console.error('최근 24시간에 보존된 원음이 없습니다.');
        process.exitCode = 1;
      } else {
        await pipeline(audio.stream, createWriteStream(resolve(output), { flags: 'wx' }));
        console.log(JSON.stringify({ output: resolve(output), bytes: audio.bytes }));
      }
    }
  }
}
