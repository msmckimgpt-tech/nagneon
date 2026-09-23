import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { DecisionService, DecisionTask } from '../server/decision/index.js';
import { createTypeSafeClient } from '../server/decision/typesafe-client.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = {
  language: 'en',
  queryEnglish: 'Which game did we agree during the previous stream to play in the next stream?',
  candidates: [
    {
      id: 'm1',
      textEnglish:
        'The synthetic viewer and streamer agreed to play Starlight Farm in the next stream.',
    },
    { id: 'm2', textEnglish: 'The synthetic viewer said they like spicy food.' },
    { id: 'm3', textEnglish: 'The synthetic streamer said the weather is clear today.' },
  ],
};

export async function runProbe({ apiKey, fetchImpl } = {}) {
  const client = createTypeSafeClient({ apiKey, fetchImpl });
  const report = {
    schemaVersion: 2,
    inputLanguage: 'en',
    outputFormat: 'candidate-ids-and-numbers',
    fixtureVersion: 'memory-choice-en-v1',
    syntheticInput: true,
    liveProvider: fetchImpl === undefined,
    requestedModel: 'jev-latest',
    inferenceAttempts: 0,
    runtimeApplied: false,
    keyPersisted: false,
    status: 'NOT_TESTED',
  };
  let service;
  try {
    report.models = await client.listModels();
    if (!report.models.includes(report.requestedModel)) {
      report.status = 'FAIL';
      report.reason = 'model_unavailable';
      return report;
    }
    let providerUsage;
    service = new DecisionService({
      config: { mode: 'shadow', timeoutMs: 10000, maxInFlight: 1 },
      adapter: {
        evaluate: async (request) => {
          report.inferenceAttempts++;
          const result = await client.judge(request);
          providerUsage = result.usage;
          return result;
        },
      },
    });
    const start = performance.now();
    const result = await service.advise(DecisionTask.MEMORY_RERANK, fixture, {
      questionVersion: 2,
    });
    report.durationMs = Math.round(performance.now() - start);
    if (result.kind !== 'observation') {
      report.status = 'FAIL';
      report.reason = result.reason || 'invalid_response';
      return report;
    }
    report.status = 'PASS';
    report.actualModel = result.modelVersion;
    report.answer = result.value;
    report.confidence = result.confidence;
    report.usage = providerUsage;
    report.expectedChoice = 'm1';
    report.fixtureMatched = result.value.choice === 'm1';
    report.estimatedInputCostUsd = (providerUsage.inputTokens * 0.042) / 1_000_000;
    report.costBasis =
      'Published 2026-09-23: USD 0.042 / million input tokens; output free. Account invoice not verified.';
    report.qualityConclusion =
      'Single English synthetic example only; no general language-quality or latency conclusion.';
    return report;
  } catch (error) {
    report.status = 'FAIL';
    report.reason = [
      'auth',
      'usage',
      'timeout',
      'network',
      'unavailable',
      'invalid_response',
    ].includes(error?.code)
      ? error.code
      : 'error';
    return report;
  } finally {
    await service?.close();
  }
}

async function main() {
  // stdin is a private pipe from the masked PowerShell prompt, never a CLI arg,
  // persisted environment variable, key file or shell-history command.
  let key = '';
  for await (const chunk of process.stdin) {
    key += chunk.toString('utf8');
    if (key.length > 4096) throw new Error('invalid credential input');
  }
  const report = await runProbe({ apiKey: key.trim() });
  key = '';
  const folder = resolve(
    root,
    'artifacts',
    'jev-live',
    'run-' + new Date().toISOString().replace(/[:.]/g, '-'),
  );
  await mkdir(folder, { recursive: true });
  const path = resolve(folder, 'result.json');
  await writeFile(path, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ...report, reportPath: path }, null, 2));
  process.exitCode = report.status === 'PASS' && report.fixtureMatched ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    console.error('JEV 시험을 완료하지 못했습니다. 키 값은 출력하지 않습니다.');
    process.exitCode = 1;
  });
}
