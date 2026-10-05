// Optional observation guides, not scripted events or fixed audience reactions.
export const genrePresets = [
  { id: 'genre-roguelike', name: '로그라이크', genre: '로그라이크', popularity: 0.5, context: '이번 도전의 선택, 강화 조합과 재도전을 함께 관찰한다. 이전 도전의 능력이나 아이템이 유지된다고 가정하지 않는다. 보이지 않는 확률과 다음 보상을 단정하지 않으며 공략은 요청받을 때만 말한다.' },
  { id: 'genre-horror', name: '호러', genre: '호러', popularity: 0.5, context: '화면과 사용자의 말에서 확인한 긴장감, 탐색과 발견에 반응한다. 아직 나오지 않은 놀람 장면, 적의 위치, 반전과 결말을 미리 알리지 않는다. 침묵과 몰입을 존중하고 공포 반응을 강요하지 않는다.' },
  { id: 'genre-soulslike', name: '소울라이크', genre: '액션 RPG', popularity: 0.5, context: '보이는 공격 동작, 회피, 자원과 재도전의 변화를 관찰한다. 실패를 조롱하거나 연속 성공을 강요하지 않는다. 보스의 다음 패턴과 숨겨진 길을 단정하지 않으며 구체적인 공략은 요청받을 때만 말한다.' },
  { id: 'genre-sandbox', name: '샌드박스', genre: '샌드박스', popularity: 0.5, context: '사용자가 정한 목표에 맞춰 건축, 탐험과 창작의 변화를 함께 본다. 정해진 승리 조건이나 진행 순서를 강요하지 않는다. 화면에 보이지 않는 재료 수량과 월드 상황을 만들지 않고 제작법은 요청받을 때만 제안한다.' },
  { id: 'genre-rhythm', name: '리듬', genre: '리듬', popularity: 0.5, context: '플레이 중 집중을 존중하고 곡 사이와 결과 화면에서 보이는 변화에 반응한다. 화면에서 확인되지 않은 판정, 콤보, 점수와 곡 이름을 단정하지 않는다. 짧은 장면만으로 실력이나 실패 원인을 평가하지 않는다.' },
  { id: 'genre-simulation', name: '시뮬레이션', genre: '시뮬레이션', popularity: 0.5, context: '사용자가 선택한 운영, 생활과 실험의 목표를 따라 관찰한다. 느린 진행과 자유로운 선택도 존중한다. 보이는 수치와 실제 설명을 근거로 말하고 숨겨진 시스템이나 미래 결과를 확정하지 않는다. 최적화 조언은 요청받을 때만 제안한다.' },
];

// Preserve all existing entries, including customized presets with matching IDs.
export function addGenrePresets(games) {
  const ids = new Set(games.map(game => game.id));
  const missing = genrePresets.filter(game => !ids.has(game.id));
  if (games.length + missing.length > 100) return games;
  return [...games, ...missing.map(game => ({ ...game }))];
}
