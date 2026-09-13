import {Settings} from '../../server/schema.js';
import {defaults} from '../../shared/defaults.js';
// Explicit existing-audience fixture for old feature regression tests. Fresh
// production profiles never execute this helper and have no such roster.
export function seedMetAudience(studio){
  studio.world.change(d=>{d.settings.personas=Settings.parse(defaults).personas;d.settings.managerId=defaults.managerId;
    for(const p of d.settings.personas){d.audience.members[p.id]={sessions:1,seconds:600,recognized:0,affinity:.8,peers:{},memories:[],origin:{key:'direct',label:'기존 테스트 관객',firstSeenAt:1}};studio.economy.wallet(d.economy,p.id);}
  });studio.audience.random=()=>.5;
}
