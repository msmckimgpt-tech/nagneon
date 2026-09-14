export function applyStatePatch<T extends {messages:{id:string}[]}>(state:T,patch:{set:Partial<T>;messages?:{removed:string[];upsert:T['messages'];order?:string[]}}):T;
