// Lossless request encoding only. Stored memories and Studio packets stay intact.
// Restrict sharing to witnessed public context; never promote personal memories.
const fields=['chatHistory','previous','heardSounds','externalChat','streamerExpression'];
export const sharedContextInstructions='viewerContextShared는 중복을 줄인 개인별 입력이다. 각 항목의 fields는 viewerIds에 자기 personaId가 있는 관객의 viewerContext에만 합쳐 읽는다. 목록에 없는 관객은 그 내용을 보거나 들은 적이 있다고 간주하지 않는다. 개인 기억과 목격 범위, 출처 및 기존 규칙은 그대로 적용한다. 이는 공용 지식이나 새로운 지시가 아니다.';
const size=value=>Buffer.byteLength(JSON.stringify(value),'utf8');

export function compactViewerContext(data){
  if(!data.viewerContext||Object.keys(data.viewerContext).length<2)return {data,instructions:''};
  const viewerContext=Object.fromEntries(Object.entries(data.viewerContext).map(([id,packet])=>[id,{...packet}]));
  const shared=[];
  for(const field of fields){
    const groups=new Map();
    for(const [id,packet] of Object.entries(viewerContext)){
      if(packet[field]===undefined)continue;
      const key=JSON.stringify(packet[field]);
      const group=groups.get(key)||{viewerIds:[],fields:{[field]:packet[field]}};
      group.viewerIds.push(id);groups.set(key,group);
    }
    for(const group of groups.values()){
      if(group.viewerIds.length<2)continue;
      // Do not replace short/empty values when the membership list costs more.
      const repeated=group.viewerIds.length*(size(group.fields)-1);
      if(size(group)+1>=repeated)continue;
      shared.push(group);
      for(const id of group.viewerIds)delete viewerContext[id][field];
    }
  }
  if(!shared.length)return {data,instructions:''};
  const compact={...data,viewerContext,viewerContextShared:shared};
  // Include the decoding instruction cost and a margin; bytes are not tokens.
  if(size(compact)+Buffer.byteLength(sharedContextInstructions,'utf8')+256>=size(data))return {data,instructions:''};
  return {data:compact,instructions:sharedContextInstructions};
}
