export const previewEnabled=config=>config?.enabled===true&&config?.tryNewFeatures===true;
export function resolveDebugPrompt(base,config){
  if(!previewEnabled(config))return base;
  return config.mode==='replace'?config.prompt:config.prompt?base+'\n\n'+config.prompt:base;
}
