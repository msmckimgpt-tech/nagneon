import { pathToFileURL } from 'node:url';
import { prepareJevRequest, validateJevResponse } from '../server/decision/request-schema.js';
import { JevHttpClient } from '../server/decision/http-client.js';
import { confidentChoice, certainNoul } from '../server/decision/policies.js';
import { cases } from './jev-evaluation-cases.mjs';

const model = 'jev-1.13.0';
function fixtureAnswer(entry) {
  if (entry.questions.judgment.type === 'noul') return { type: 'noul', noul: entry.fixture };
  const options = Object.keys(entry.questions.judgment.criteria);
  const selected = entry.fixture;
  const remainder = (1 - 0.96) / (options.length - 1);
  return {
    type: 'choice',
    choice: selected,
    confidence: 0.96,
    probabilities: Object.fromEntries(
      options.map((id) => [id, id === selected ? 0.96 : remainder]),
    ),
  };
}
function judgment(entry, answer) {
  return entry.questions.judgment.type === 'noul'
    ? certainNoul(answer)
    : confidentChoice(answer, Object.keys(entry.questions.judgment.criteria));
}
export async function runEvaluation({
  live = false,
  key = process.env.JEV_API_KEY,
  fetchImpl = fetch,
} = {}) {
  if (live && !key) throw new Error('Live evaluation requires explicit JEV_API_KEY.');
  const result = {
    mode: live ? 'live' : 'offline',
    model,
    synthetic: true,
    qualityMeasured: live,
    cases: cases.length,
    invalid: 0,
    abstained: 0,
    agreement: live ? 0 : null,
    inputTokens: 0,
    estimatedInputUsd: 0,
    latencyMs: [],
    results: [],
  };
  const client = live ? new JevHttpClient({ apiKey: key, model, fetchImpl }) : null;
  for (const entry of cases) {
    const row = { id: entry.id, expected: entry.expected, policy: entry.policy };
    let attemptStarted = null;
    let reportedUsage = null;
    try {
      prepareJevRequest({ state: entry.state, questions: entry.questions, model });
      if (live) attemptStarted = performance.now();
      const answer = live
        ? await client.evaluate({
            state: entry.state,
            questions: entry.questions,
            signal: AbortSignal.timeout(5000),
            onUsage: (usage) => {
              reportedUsage = usage;
            },
          })
        : validateJevResponse(
            {
              model,
              answers: { judgment: fixtureAnswer(entry) },
              usage: { input_tokens: 0, output_tokens: 0 },
            },
            entry.questions,
          );
      const selected = judgment(entry, answer.answers.judgment);
      row[live ? 'selected' : 'fixtureSelected'] = selected;
      row.abstained = selected === null;
      if (live) {
        row.agreesWithExpected = selected === entry.expected;
        result.agreement += Number(row.agreesWithExpected);
      }
      result.abstained += Number(row.abstained);
    } catch (error) {
      row.error = error?.code || 'error';
      result.invalid++;
    } finally {
      if (attemptStarted !== null) {
        row.latencyMs = Math.round(performance.now() - attemptStarted);
        result.latencyMs.push(row.latencyMs);
        if (reportedUsage) {
          row.inputTokens = reportedUsage.input_tokens;
          row.estimatedInputUsd = Number(((row.inputTokens * 0.042) / 1e6).toFixed(9));
          result.inputTokens += row.inputTokens;
        }
      }
    }
    result.results.push(row);
  }
  result.estimatedInputUsd = Number(((result.inputTokens * 0.042) / 1e6).toFixed(9));
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(
      JSON.stringify(await runEvaluation({ live: process.argv.includes('--live') }), null, 2),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
