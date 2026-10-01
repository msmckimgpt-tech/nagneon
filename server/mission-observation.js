import { z } from 'zod';
import { missionTemplates } from '../shared/mission-rules.js';

export const MissionActions = z
  .array(
    z
      .object({
        kind: z.enum(['propose', 'join', 'oppose', 'suggest-complete']),
        personaId: z.string().trim().min(1).max(40),
        missionId: z.string().uuid().nullable(),
        templateId: z.enum(missionTemplates.map((t) => t.id)).nullable(),
        target: z.number().int().min(20).max(200).nullable(),
        amount: z.number().int().min(1).max(40).nullable(),
        reason: z.string().trim().min(1).max(200),
      })
      .strict(),
  )
  .max(3)
  .default([]);

export const missionActionFormat = {
  type: 'array',
  maxItems: 3,
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['kind', 'personaId', 'missionId', 'templateId', 'target', 'amount', 'reason'],
    properties: {
      kind: { type: 'string', enum: ['propose', 'join', 'oppose', 'suggest-complete'] },
      personaId: { type: 'string' },
      missionId: { type: ['string', 'null'] },
      templateId: { type: ['string', 'null'], enum: [...missionTemplates.map((t) => t.id), null] },
      target: { type: ['integer', 'null'], minimum: 20, maximum: 200 },
      amount: { type: ['integer', 'null'], minimum: 1, maximum: 40 },
      reason: { type: 'string' },
    },
  },
};
export const missionInstructions = `missions는 AI 관객의 별도 가상 미션점 원장이다. 실제 사람의 지지나 금전 후원이 아니다. enabled=false이거나 해당 입력이 특수 기능·방송 밖·휴식이면 missionActions=[]이다. 제안은 의무가 아니며 기본은 관망이다. 각자 취향·현재 목격 장면·예산·피로와 쿨다운을 고려해 필요할 때만 선택한다. 서로 다른 이유로 동참할 수 있고 반대·무관심도 자연스럽다. 제안자·동참자·반대자 역할이나 전원 참여를 배정하지 않는다. 중요한 진행·큰 사건·집중 장면을 미션 이야기로 끊지 않는다.
missionActions의 propose는 허용 templates의 정확한 templateId만 선택한다. 자유 조건·현실 행동·개인정보·결제·유료 행동·게임 설정 조작을 추가하지 않는다. reason은 개인적으로 보고 싶은 이유일 뿐 새 조건이 아니다. target과 amount는 미션점 희망 금액이다. 지급·예치·지지자수·수락을 채팅에서 미리 확정하지 않는다. 모금 달성은 수락 검토 상태이고 스트리머는 거절하거나 수정할 수 있다. join과 oppose는 공개 campaigns의 정확한 missionId를 사용하고 amount는 join일 때만 채운다. propose의 missionId는 null이며 나머지 행동의 templateId/target은 null이다. 돈을 더 모아 거절을 번복시키거나 blockedTemplates를 다른 표현으로 재촉하지 않는다.
suggest-complete는 accepted 미션에서 자기 목격 근거가 명확할 때만 완료 후보를 추천한다. 실패한 도전은 수행형 약속 조건을 충족할 수 있으나 보스 처치 성공형에서는 성공이 아니다. AI 추천은 미정산이고 사용자가 표시된 조건 충족을 확인할 때만 예치가 소비된다. 애매하면 추천하지 않는다. 서버의 조건·금액·상태가 정본이며 모델은 증액·성공·정산·기존 앱 가상P 지급을 결정할 권한이 없다.
진행 중 미션의 제안·동참을 재촉하는 messages는 missionTopic=true와 현재 missionId를 표시한다. 새 제안/예치/반대는 missionActions로만 쓰며 같은 응답의 채팅에 중복 보고하지 않는다. 이미 끝난 장면을 직접 목격한 자기 기억으로 회상하거나 스트리머의 질문에 답하는 평범한 반응은 missionTopic=false, missionId=null로 쓰고 새 부탁을 섞지 않는다. 무조건 감사하거나 모든 관객이 같은 미션을 반복하지 않는다. 미션이 현재 대화와 관련 없으면 평소 방송에 반응하거나 침묵한다. 거절·중지 뒤의 미션 재촉은 생성하지 않는다.
각자의 viewerContext.missionExperience.events는 그 관객이 직접 접한 공개 미션 안내다. user-confirmation은 스트리머 완료 확인을 접한 사건이고 직접 게임 수행을 본 증거가 아니다. scenes는 실제 공유 화면을 그 관객이 목격한 시각에 대한 모델 설명 후보다. 다른 관객의 기록을 자기 기억처럼 쓰거나 후원한 사실만으로 전 과정을 봤다고 주장하지 않는다. 기여하지 않아도 직접 본 장면은 회상할 수 있고 기록이 없는 관객은 공동 추억을 지어내지 않는다.`;
