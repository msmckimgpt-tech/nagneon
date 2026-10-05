import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const file = ts.createSourceFile(
  'App.tsx',
  source,
  ts.ScriptTarget.ES2022,
  true,
  ts.ScriptKind.TSX,
);
function find(predicate) {
  const matches = [];
  function visit(node) {
    if (predicate(node)) matches.push(node);
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.equal(matches.length, 1, 'Expected one actual App flow node');
  return matches[0];
}
function attribute(element, name) {
  return element.attributes.properties.find(
    (property) => ts.isJsxAttribute(property) && property.name.getText(file) === name,
  );
}
const button = find(
  (node) =>
    ts.isJsxOpeningElement(node) &&
    node.tagName.getText(file) === 'button' &&
    attribute(node, 'data-tutorial')?.initializer?.text === 'start',
);
const start = attribute(button, 'onClick').initializer.expression;
const disabled = attribute(button, 'disabled').initializer.expression;
const action = find(
  (node) => ts.isVariableDeclaration(node) && node.name.getText(file) === 'action',
).initializer.arguments[0];
const screen = find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'screen');
const effect = (marker) =>
  find(
    (node) =>
      ts.isCallExpression(node) &&
      node.expression.getText(file) === 'useEffect' &&
      node.arguments[0]?.getText(file).includes(marker),
  ).arguments[0];
const captureReady = effect('!broadcastAfterCapture.current');
const subscriptionReady = effect('void media.startMic()');
const setSettingsTab = find(
  (node) => ts.isVariableDeclaration(node) && node.name.getText(file) === 'setSettingsTab',
).initializer;
const compiled = ts.transpileModule(
  `
globalThis.action=${action.getText(file)};
globalThis.screen=${screen.getText(file)};
globalThis.startClick=${start.getText(file)};
globalThis.startDisabled=()=>(${disabled.getText(file)});
globalThis.captureReady=${captureReady.getText(file)};
globalThis.subscriptionReady=${subscriptionReady.getText(file)};
globalThis.setSettingsTab=${setSettingsTab.getText(file)};
`,
  {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
    reportDiagnostics: true,
  },
);
assert.deepEqual(
  compiled.diagnostics?.filter((d) => d.category === ts.DiagnosticCategory.Error),
  [],
);

// Execute the real button, action, capture and completion callbacks. Controlled
// seams observe requests/dialogs/refs; this is not a renderer or device test.
function harness({
  category = 'just-chatting',
  mode = 'live',
  running = false,
  tutorial = false,
  connected = true,
  soundSharing = false,
  capturePreparing = false,
  native = true,
  audio = { mode: 'local' },
  apiError,
} = {}) {
  const events = [],
    drafts = [],
    state = {
      running,
      settings: { category, mode, title: '합성 방송', nested: { keep: true } },
      nativeAudio: structuredClone(audio),
    };
  const context = {
    state,
    s: state.settings,
    tutorialActive: tutorial,
    connected,
    overlay: false,
    window: native ? { backseat: {} } : {},
    structuredClone,
    Error,
    subscriptionStartPending: { current: false },
    broadcastAfterCapture: { current: false },
    setCaptureSound: (value) => events.push(['capture-dialog', value]),
    navigation: {
      route: { tab: 'studio' },
      patch(value) {
        Object.assign(this.route, value);
        events.push(['settings-tab', value.settings]);
      },
    },
    setDraft: (value) => {
      drafts.push(value);
      events.push(['draft']);
    },
    setModal: (value) => events.push(['modal', value]),
    setError: (value) => events.push(['error', value]),
    media: {
      soundSharing,
      capturePreparing,
      stopAll: () => events.push(['stop-media']),
      startMic: async () => events.push(['start-mic']),
      share: async (_source, options) => events.push(['share', structuredClone(options)]),
    },
    api: async (path) => {
      events.push(['api', path]);
      if (apiError) throw apiError;
      return { running: path !== 'stop' };
    },
  };
  vm.runInNewContext(compiled.outputText, context);
  return {
    context,
    state,
    events,
    drafts,
    async click() {
      if (!context.startDisabled()) await context.startClick();
    },
    captureReady: () => context.captureReady(),
    subscriptionReady: () => context.subscriptionReady(),
  };
}
const operations = (h) =>
  h.events
    .filter(([kind]) => kind !== 'error')
    .map((row) => (row[0] === 'api' ? row.join(':') : row[0]));
const settle = () => new Promise((resolve) => setImmediate(resolve));
const subscription = {
  mode: 'remote',
  transport: 'subscription',
  consent: true,
  consentVersion: 2,
};

test('live Just Chatting starts without a screen picker or media connection', async () => {
  const h = harness({ capturePreparing: true });
  await h.click();
  assert.deepEqual(operations(h), ['api:start']);
  assert.equal(h.context.broadcastAfterCapture.current, false);
  assert.equal(h.context.subscriptionStartPending.current, false);
  h.subscriptionReady();
  h.captureReady();
  await settle();
  assert.deepEqual(operations(h), ['api:start']);
});

test('live gaming waits for capture completion and starts exactly once after it is ready', async () => {
  const h = harness({ category: 'gaming' });
  await h.click();
  assert.deepEqual(operations(h), ['capture-dialog']);
  assert.equal(h.context.broadcastAfterCapture.current, true);
  h.captureReady();
  assert.deepEqual(operations(h), ['capture-dialog']);
  h.context.media.soundSharing = true;
  h.context.media.capturePreparing = true;
  h.captureReady();
  assert.deepEqual(operations(h), ['capture-dialog']);
  h.context.media.capturePreparing = false;
  h.captureReady();
  await settle();
  h.captureReady();
  await settle();
  assert.deepEqual(operations(h), ['capture-dialog', 'api:start']);
  assert.equal(h.context.broadcastAfterCapture.current, false);
});

test('browser gaming keeps the existing screen and system-audio acquisition options', async () => {
  const h = harness({ category: 'gaming', native: false });
  await h.click();
  assert.deepEqual(h.events, [['share', { systemAudio: true, picture: true }]]);
  assert.equal(h.context.broadcastAfterCapture.current, true);
});

test('gaming with an existing capture starts without requesting another capture', async () => {
  const h = harness({ category: 'gaming', soundSharing: true });
  await h.click();
  assert.deepEqual(operations(h), ['api:start']);
  assert.equal(h.context.broadcastAfterCapture.current, false);
});

for (const category of ['gaming', 'just-chatting'])
  for (const audio of [
    { mode: 'remote', transport: 'subscription', consent: false, consentVersion: 2 },
    { mode: 'remote', transport: 'subscription', consent: true, consentVersion: 1 },
  ]) {
    test(
      category +
        ' requires current remote audio consent before any start or capture (' +
        audio.consent +
        '/' +
        audio.consentVersion +
        ')',
      async () => {
        const h = harness({ category, audio });
        await h.click();
        assert.deepEqual(operations(h), ['settings-tab', 'draft']);
        assert.deepEqual(h.context.navigation.route, { tab: 'studio', settings: 'connection' });
        assert.deepEqual(h.events[0], ['settings-tab', 'connection']);
        assert.deepEqual(h.events.at(-1), [
          'error',
          '방송 전에 마이크와 게임·시스템 소리의 전송 범위를 확인해주세요.',
        ]);
        assert.deepEqual(h.drafts[0], h.state.settings);
        assert.notEqual(h.drafts[0], h.state.settings);
        assert.notEqual(h.drafts[0].nested, h.state.settings.nested);
        assert.equal(h.context.broadcastAfterCapture.current, false);
        assert.equal(h.context.subscriptionStartPending.current, false);
      },
    );
  }

test('screenless subscription start keeps the pending flag and microphone completion guard', async () => {
  const h = harness({ audio: subscription });
  await h.click();
  assert.deepEqual(operations(h), ['api:start']);
  assert.equal(h.context.subscriptionStartPending.current, true);
  h.subscriptionReady();
  assert.deepEqual(operations(h), ['api:start']);
  h.state.running = true;
  h.context.overlay = true;
  h.subscriptionReady();
  assert.equal(h.context.subscriptionStartPending.current, true);
  h.context.overlay = false;
  h.subscriptionReady();
  h.subscriptionReady();
  await settle();
  assert.deepEqual(operations(h), ['api:start', 'start-mic']);
  assert.equal(h.context.subscriptionStartPending.current, false);
});

test('a failed direct subscription start clears pending and cannot connect the microphone', async () => {
  const h = harness({ audio: subscription, apiError: Error('합성 시작 실패') });
  await h.click();
  assert.deepEqual(operations(h), ['api:start']);
  assert.deepEqual(h.events.at(-1), ['error', '합성 시작 실패']);
  assert.equal(h.context.subscriptionStartPending.current, false);
  h.state.running = true;
  h.subscriptionReady();
  assert.deepEqual(operations(h), ['api:start']);
});

test('a failed gaming start after capture also clears subscription pending', async () => {
  const h = harness({ category: 'gaming', audio: subscription, apiError: Error('합성 시작 실패') });
  await h.click();
  h.context.media.soundSharing = true;
  h.captureReady();
  await settle();
  assert.deepEqual(operations(h), ['capture-dialog', 'api:start']);
  assert.equal(h.context.subscriptionStartPending.current, false);
  assert.equal(h.context.broadcastAfterCapture.current, false);
});

test('tutorial rehearsal bypasses live consent and capture as before', async () => {
  const h = harness({
    category: 'gaming',
    tutorial: true,
    audio: { mode: 'remote', consent: false },
  });
  await h.click();
  assert.deepEqual(operations(h), ['api:tutorial/rehearsal']);
  assert.equal(h.context.subscriptionStartPending.current, false);
  assert.equal(h.context.broadcastAfterCapture.current, false);
});

test('ordinary rehearsal starts through the existing start action without media acquisition', async () => {
  const h = harness({
    category: 'gaming',
    mode: 'rehearsal',
    audio: { mode: 'remote', consent: false },
  });
  await h.click();
  assert.deepEqual(operations(h), ['api:start']);
  assert.equal(h.context.subscriptionStartPending.current, false);
  assert.equal(h.context.broadcastAfterCapture.current, false);
});

test('stop clears both pending flags and releases media before sending stop', async () => {
  const h = harness({
    category: 'gaming',
    running: true,
    audio: { mode: 'remote', consent: false },
  });
  h.context.subscriptionStartPending.current = true;
  h.context.broadcastAfterCapture.current = true;
  await h.click();
  assert.deepEqual(operations(h), ['stop-media', 'api:stop']);
  assert.equal(h.context.subscriptionStartPending.current, false);
  assert.equal(h.context.broadcastAfterCapture.current, false);
  h.context.media.soundSharing = true;
  h.state.running = false;
  h.captureReady();
  h.subscriptionReady();
  await settle();
  assert.deepEqual(operations(h), ['stop-media', 'api:stop']);
});

test('the disconnected start button remains disabled and dispatches no operation', async () => {
  const h = harness({ connected: false });
  assert.equal(h.context.startDisabled(), true);
  await h.click();
  assert.deepEqual(h.events, []);
  assert.equal(h.context.broadcastAfterCapture.current, false);
});
