export function resolveDebugPrompt(base,config){
  if(!config?.enabled)return base;
  return config.mode==='replace'?config.prompt:config.prompt?base+'\n\n'+config.prompt:base;
}
