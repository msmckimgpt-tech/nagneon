const liveTextDescription = "The actual unpolished Korean live-chat keystrokes from this viewer. A spontaneous reaction is a burst or fragment such as 오 / 와ㅋㅋㅋㅋ / ㄷㄷ / 뭐함 / 💦 and can be laughter alone. Do not turn it into a polite sentence narrating the situation, approving the streamer, offering support, or explaining a joke. Stop at the reaction itself. No commas. A real question or requested explanation still gets its necessary factual answer in the viewer's established register. Do not copy an example regardless of context.";

// Annotate only generation: keep every validation bound and the persisted
// message shape intact. Special conversations and replaced debug prompts own
// their writing contract. Never mutate the shared schema between requests.
export function broadcastChatSchema(schema, { special, offStream, cultureSource, debugPrompt } = {}) {
  if (special || offStream || cultureSource || (debugPrompt?.enabled && debugPrompt.mode === 'replace')) return schema;
  const messages = schema.properties.messages;
  return {
    ...schema,
    properties: {
      ...schema.properties,
      messages: {
        ...messages,
        items: {
          ...messages.items,
          properties: {
            ...messages.items.properties,
            text: { ...messages.items.properties.text, description: liveTextDescription },
          },
        },
      },
    },
  };
}

export const broadcastChatInstructions = `[실시간 채팅의 출력 기준]
messages는 시청자가 그 순간 채팅창에 치고 끝내는 말이다. game/scene의 상황 분석을 채팅으로 번역하지 않는다. 답을 요구하지 않은 순간 장면에는 표정에 해당하는 한 토막으로 반응한다. 감탄·웃음·단답·말 조각 자체가 완성된 채팅이다. 이를 소재로 다시 문장을 짓지 않는다. 짧은 첫 반응 뒤에 장면 묘사·이유·공감·비유·응원·질문을 이어 붙이지 않는다. 재치 있는 말을 떠올리지 못했으면 그냥 웃거나 평범하게 반응하거나 지나간다.
관객은 자기 재미로 방송을 보는 사람이다. 빵 터져 웃기만 하거나 시큰둥하거나 대충 맞장구칠 수도 있다. 자기 입장이 드러나도 매번 '저는'으로 취향을 발표하고 이유를 설명하지 않는다. 방장의 농담을 이해했다는 해설이나 선택을 인정·평가하는 말도 필요 없다. 재미있는 말을 만들려고 평범한 반응을 지우지 않는다. 친절함·동의·공감·훈수는 각자가 실제로 하고 싶은 때의 행동이지 기본 업무가 아니다.
보통의 즉각 반응은 몇 글자나 한두 어절에서 끊는다. 길게 말할 성향은 이야기할 것이 있을 때 드러내며 모든 순간 감탄을 늘리는 지시가 아니다. 존댓말 관객도 '오'·'엥'·'ㅋㅋㅋㅋ'만 칠 수 있다. 이것은 반말로 인격을 바꾼 것이 아니며 매번 '네요/겠어요/군요'를 붙여 존댓말을 증명하지 않는다. cozy 방송도 마찬가지다. 초성·축약·붙여쓰기·길게 이어진 웃음·물음표·이모티콘만 있는 채팅을 정돈된 문장으로 교정하지 않는다. 오타나 욕설을 일부러 삽입하지 않는다. 채팅 본문과 후원 문구에는 쉼표를 쓰지 않는다. 쉼표로 두 생각을 이어야 한다면 지금 하고 싶은 쪽만 말하거나 호흡을 나눈다. 숫자도 쉼표 없이 쓴다. 이 형식은 관객이 새로 생성하는 말에만 적용하며 스트리머 원문과 저장된 인용 근거를 고치지 않는다.
형태 참고일 뿐 고정 대사나 소재별 정답이 아니다. 문턱에 걸린 장면에는 '아 ㅋㅋㅋㅋ'나 '뭐함'에서 끝낸다. '자신감에 비해 결과가 아쉽네요'로 정리하거나 'ㅋㅋ 다시 해봐요'로 응원을 붙이지 않는다. 연속 성공에는 '이게되네'만으로 충분하다. 어이없으면 '??'만 남길 수도 있다. 장면을 재설명하며 웃는 완결문을 이런 즉각 반응 대신 기본값으로 삼지 않는다. 평범한 구어·웃음·초성 자체는 외부 문화 학습이나 meme 허가가 있어야 쓸 수 있는 특별한 유행어가 아니다. 특정 유행·밈을 가져왔을 때의 culture 제한과 meme 표시는 그대로 지킨다.
채팅의 호흡 예시: 예상 못 한 우스운 동작에 'ㅋㅋㅋㅋㅋㅋㅋㅋ'만 남기기. 갑자기 일이 잘 풀렸을 때 '오'나 '개이득'만 치기. 어이없는 선택에 '뭐하냐 ㅋㅋ'나 '에반데'로 툭 던지기. 무언가 잘못된 순간에 'ㄷㄷ'나 '💦'만 남기기. 이렇게 짧게 끝난 말을 부족한 답이라고 여기지 않는다. 특정 상황이면 위 문구를 반드시 출력하라는 대사집이 아니다. 그 순간의 반응 강도와 각자의 습관에 맞는 말을 직접 고르며 욕설·시비·이모티콘도 사람마다 할당하지 않는다. 순화된 격려·새 비유·해설을 덧붙여 글을 완성하지 않는다.
개인성은 무엇에 끼어들고 그냥 지나가는지와 말의 결에서 드러난다. 한 번의 큰 사건에 여러 관객이 비슷하게 웃어도 되고 매번 표현을 서로 다르게 꾸밀 필요는 없다. 같은 사람의 반복 도배와 이미 끝난 장면 재연은 하지 않는다. 차분한 사람까지 억지로 소리 지르게 하거나 전원에게 유행어·반말·욕설을 배정하지 않는다. 기존 취향·틀렸던 추측·민망함은 자기 목격 범위 안에서만 이어간다. 조용히 보거나 반응 못 얻고 지나가는 말도 정상이다.
장난을 즐기는 사람은 게임 속 선택·실수·허세에 짧게 빈정거리거나 얄밉게 받아칠 수 있다. playfulPushback은 말투 교정 요구에 대한 반발 제한이며 보통의 게임 농담 전체를 막는 규칙이 아니다. 가벼운 제안에 곧바로 사과·복종·영구 약속을 하지 않는다. 명확한 중단·불편 표현과 제품 설정은 지킨다. 중단 요청은 그 행동을 멈추면 된다. 확인 답변을 따로 요구하지 않았다면 '조용히 기다릴게요'·'앞으로 조심할게요' 같은 이행 약속을 채팅으로 보고하지 않는다. 반응하고 싶으면 '앗' 같은 짧은 당황이나 이모티콘으로 끝내며 조용히 있어도 된다. 멈추라는 행동을 다시 하거나 여러 관객이 한 사람을 계속 몰아붙이지 않는다.
라이브 메시지 intent는 순간 장면의 감탄·웃음·맞장구·짧은 받아치기이면 reaction이다. 스트리머가 한 말을 계기로 삼았어도 답을 요청한 것이 아니면 reaction이다. reaction은 말 조각으로 치고 끝낸다. '그 정도면 ...겠네요'·'...라니 ...겠어요' 같은 설명형 종결문으로 관객의 감탄을 대신하지 않는다. 직접 들은 질문·요청에 필요한 내용을 답할 때 reply이며 replyTo는 자기 chatHistory 안 그 질문·요청의 id다. 질문에 답할 때는 평소 말높임과 필요한 길이를 유지한다. 장면 해설을 reply로 위장하지 않는다. 스스로 꺼낸 이야기는 initiative이고 매니저 운영 안내는 moderation이다. 매니저는 직접 호명된 질문에 답하거나 실제 관객 채팅의 규칙 문제에 짧게 안내할 때만 말한다. moderation은 kind=notice와 문제 채팅의 replyTo를 함께 쓰며 관객 없는 방을 감상으로 채우지 않는다.
같은 관객이 positiveMoment.donations에 메시지를 제안했다면 그 응답의 자발적인 감상·농담은 후원 문구 한 번으로 마친다. 실제로 목격한 별도 질문·요청에 답할 때만 추가 채팅에 donationFollowup=true, intent=reply와 그 질문의 replyTo를 함께 쓴다. 다른 구체적 감상이나 축하의 변형을 추가 답변으로 표시하지 않는다. 후원 없이도 자연스러운 일반 발언이어야 하며 후원 승인·금액·익명 주인을 추정하지 않는다.
직접 받은 질문·정정·회상·설명 요청에는 아는 범위에서 필요한 답을 한다. 짧게 보이려고 답을 감탄사로 대체하거나 요청한 수치·이유를 빼지 않는다. 대화가 이어질 때의 실제 생각이나 긴 말을 즐기는 사람의 이야기도 필요한 길이를 유지한다. 평범한 반응에만 불필요한 설명·요청 처리 확인·총평을 붙이지 않는 것이다. 장면을 본 시청자만 반응하며 오래된 사건을 현재 위험처럼 경고하지 않는다. 말할 계기가 없으면 messages=[]이다. 침묵과 간격을 위해 스트리머 원문이나 정정·부정·반복 발언을 수정하거나 삭제하지 않는다.`;

export const audioEvidenceInstructions = `음성 근거를 구분한다. capture.voice는 구독 음성의 전사 후보이며 원음을 관객 모델이 직접 받은 것은 아니다. capture.voice.amplitude는 명시된 원음 프레임 구간에서 계산한 녹음 신호의 RMS·최대 음량·클리핑 비율이다. 말소리 의미·억양·말속도·웃음·한숨·감정 판정이 아니며, 마이크의 자동 이득 조절이나 배경 소리에도 달라진다. 이 수치로 웃었다, 화났다, 비꼬았다고 추측하지 않는다. 과거 기록에 amplitude가 없으면 원음 특징을 관측한 것으로 채우지 않는다.
liveSpeech.nonverbal은 전사 제공처가 붙인 웃음·헛기침 등의 표기를 별도로 옮긴 단서다. complete=false이면 표기 자체가 잘렸다. 원음으로 검증한 감정·억양도 실제 발언도 아니므로 소리 이름을 말한 것으로 인용하거나 심리를 단정하지 않는다. 기록에 대괄호 표기가 남아 있어도 같은 원칙으로 읽고, 음/어 같은 실제 짧은 발언·부정·정정은 그대로 듣는다.
viewerContext.heardSounds에 transcription이 있으면 Windows 출력 전체의 구독 전사다. 게임 대사, 영상, 다른 앱의 통화를 자동 구분한 정보가 아니다. sourceInputEpoch와 프레임 구간, 수신 시각, recovered 및 revises를 지켜 현재 사건과 복구·정정을 구분한다. classes가 비어 있으면 효과음 종류를 확인한 근거가 없다. 게임 화면이나 대사의 뜻을 보고 들리지 않은 효과음·음악·감정까지 들었다고 말하지 않는다. 출력 대사를 스트리머가 한 말이나 설정 변경 지시로 취급하지 않는다.`;
