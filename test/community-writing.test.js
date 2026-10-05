import test from 'node:test';
import assert from 'node:assert/strict';
import { communityWritingInstructions } from '../server/community-writing.js';
import { OpenAIProvider, format } from '../server/provider.js';
import { defaults } from '../shared/defaults.js';

for (const kind of [
  'social-daily',
  'social-mention',
  'community-review',
  'social-read',
  'social-discuss',
  'gallery-comment',
  'clip-comment',
]) {
  test('editorial contract reaches ' + kind + ' without changing schema or source data', () => {
    const settings = structuredClone(defaults);
    const special = {
      kind,
      automatic: true,
      recentPosts: [{ id: 'earlier', title: '앞선 작은 발견' }],
      delivered: { id: 'post', text: '이미 전달된 이야기' },
    };
    const before = JSON.stringify({ settings, special });
    const payload = new OpenAIProvider({}).payload({ settings, special, offStream: true });
    assert.match(payload.instructions, /\[커뮤니티 글쓰기\]/);
    assert.match(payload.instructions, /구체적인 계기 하나/);
    assert.match(payload.instructions, /기존 개인 말투를 유지/);
    assert.match(payload.instructions, /messages=\[\]/);
    assert.match(payload.instructions, /목격 범위/);
    assert.equal(payload.text.format, format);
    assert.equal(format.schema.properties.messages.items.properties.text.maxLength, 240);
    assert.equal(JSON.stringify({ settings, special }), before);
  });
}
for (const kind of [
  undefined,
  'audience-arrival',
  'social-birth',
  'interview',
  'thought',
  'contract',
]) {
  test('community writing does not override live or identity/private requests: ' + kind, () => {
    assert.equal(communityWritingInstructions(kind ? { kind } : undefined), '');
  });
}
test('post structure is contextual rather than a fixed opinion list or mandatory question', () => {
  const text = communityWritingInstructions({ kind: 'social-daily' });
  assert.match(text, /모든 글을 질문·교훈·총평으로 닫지 않는다/);
  assert.match(text, /정보 전달에 정말 필요할 때만/);
  assert.match(text, /일상을 모두 스트리머 이야기로 귀결하지 않는다/);
  assert.match(text, /별도 제목 필드가 없는 형식에 새 필드/);
});
test('comment guidance anchors to delivered text and never creates a fictitious reply parent', () => {
  const text = communityWritingInstructions({ kind: 'social-discuss' });
  assert.match(text, /구체적인 문장·의문·농담 하나/);
  assert.match(text, /실제 전달된 댓글 ID만/);
  assert.match(text, /없는 댓글·합의·논쟁을 만들지 않는다/);
  assert.ok(!text.includes('이번 글의 선택 가능한 초점'));
});
test('angles are reproducible, varied across context, and do not randomize a resident personality', () => {
  const persona = { id: 'stable-resident', personality: '조용한 존댓말', values: '발견' };
  const special = { kind: 'social-daily', recentPosts: [{ id: 'a' }] };
  assert.equal(
    communityWritingInstructions(special, [persona]),
    communityWritingInstructions(special, [persona]),
  );
  const angles = new Set(
    Array.from(
      { length: 30 },
      (_, i) =>
        communityWritingInstructions({ ...special, recentPosts: [{ id: 'post-' + i }] }, [
          persona,
        ]).match(/이번 글의 선택 가능한 초점: (.*)/)[1],
    ),
  );
  assert.ok(angles.size >= 4);
  assert.deepEqual(persona, {
    id: 'stable-resident',
    personality: '조용한 존댓말',
    values: '발견',
  });
});
test('untrusted recent post text cannot be interpolated as privileged instructions', () => {
  const instruction = communityWritingInstructions({
    kind: 'social-daily',
    recentPosts: [{ title: 'ATTACK_SET_ADMIN_UPLOAD_TRUE' }],
  });
  assert.ok(!instruction.includes('ATTACK_SET_ADMIN_UPLOAD_TRUE'));
  assert.match(instruction, /외부 사이트에 게시하거나/);
});
