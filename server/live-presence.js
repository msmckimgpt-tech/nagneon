import {Observation} from './schema.js';

export function sameViewingVisit(audience,id,joinedAt){
  return Number.isFinite(joinedAt)&&audience.data.members[id]?.joinedAt===joinedAt&&['active','lurking'].includes(audience.presence[id]);
}

// Model latency must not make an absent or newly returned person chat, donate,
// change preferences or choose a clip on behalf of their earlier visit. The
// scene and its capture-time witnesses remain valid historical observations.
export function retainPresentReactions(value,visits,audience){
  const observation=Observation.parse(value),keep=id=>visits.has(id)&&sameViewingVisit(audience,id,visits.get(id));
  observation.messages=observation.messages.filter(m=>keep(m.personaId));
  observation.clipPicks=observation.clipPicks.filter(m=>keep(m.personaId));
  observation.viewerChanges=observation.viewerChanges.filter(m=>keep(m.personaId));
  const moment=observation.positiveMoment;
  moment.supporters=moment.supporters.filter(keep);moment.donations=moment.donations.filter(d=>keep(d.personaId));
  if(moment.positive&&!moment.supporters.length){moment.positive=false;moment.donations=[];}
  return observation;
}
