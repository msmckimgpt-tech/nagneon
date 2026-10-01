// Conservative starting limits, not empirically tuned engagement targets.
export const missionRules = Object.freeze({
  walletCap: 100,
  refillMs: 600000,
  maxActive: 2,
  proposalCooldownMs: 300000,
  globalCooldownMs: 120000,
  fundingMs: 300000,
  performanceMs: 600000,
  reviewMs: 180000,
  maxPledge: 40,
  maxTarget: 200,
});
export const missionTemplates = Object.freeze([
  {
    id: 'no-items',
    title: '소모 아이템 없이 한 판',
    type: 'performance',
    condition: '수락 후 게임 안에서 소모 아이템을 사용하지 않고 한 판을 끝내기. 승패는 무관합니다.',
  },
  {
    id: 'one-attempt',
    title: '재시작 없이 한 번 도전',
    type: 'performance',
    condition:
      '수락 후 게임 안에서 한 번 도전하고 결과가 나올 때까지 재시작하지 않기. 실패해도 이 조건을 지키면 완료입니다.',
  },
  {
    id: 'boss-clear',
    title: '현재 보스 한 번 처치',
    type: 'success',
    condition: '수락 후 현재 게임의 보스 한 명을 처치하기. 도전만 하거나 실패하면 완료가 아닙니다.',
  },
]);
export const missionStatuses = {
  funding: '함께 모으는 중',
  ready: '수락 기다림',
  accepted: '진행 중',
  review: '완료 확인 기다림',
  completed: '완료 · 예치 소비',
  rejected: '거절 · 반환',
  cancelled: '취소 · 반환',
  expired: '기한 종료 · 반환',
  revised: '조건 변경 · 반환',
  failed: '미이행 · 반환',
};
