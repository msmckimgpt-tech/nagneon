import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults } from '../shared/defaults.js';
import { genrePresets, addGenrePresets } from '../shared/genre-presets.js';
import { Settings } from '../server/schema.js';

test('new profile supports all genre presets while keeping automatic selection', () => {
  const settings = Settings.parse(structuredClone(defaults));
  assert.equal(settings.gameId, 'auto');
  assert.equal(settings.games.length, 10);
  assert.equal(genrePresets.length, 6);
});
test('adding genres preserves customized existing entries and selected game', () => {
  const original = Settings.parse({...structuredClone(defaults), gameId: 'genre-horror', games: [
    {...genrePresets[1], name: '내 게임', context: '내 관찰 지침', popularity: 0.15},
    {id: 'custom', name: '개인 게임', genre: '기타', context: '관찰', popularity: 0.7},
  ]});
  const before = structuredClone(original);
  const updated = Settings.parse({...original, games: addGenrePresets(original.games)});
  assert.deepEqual(original, before);
  assert.deepEqual(updated.games.slice(0, 2), original.games);
  assert.equal(updated.gameId, original.gameId);
  assert.equal(updated.games.length, 7);
  assert.deepEqual(addGenrePresets(updated.games), updated.games);
});
test('preset addition is atomic at existing game profile capacity', () => {
  const games = Array.from({length: 94}, (_, i) => ({id: 'game-'+i, name: '게임', genre: '기타', context: '관찰', popularity: 0.5}));
  assert.equal(addGenrePresets(games).length, 100);
  const full = [...games, {...games[0], id: 'extra'}];
  assert.deepEqual(addGenrePresets(full), full);
  const customized = addGenrePresets(games);
  customized[94].context = '사용자 수정';
  assert.notEqual(genrePresets[0].context, '사용자 수정');
});
