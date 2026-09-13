import {readFile,writeFile,mkdir,lstat,open} from 'node:fs/promises';
import {resolve,isAbsolute,join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
const begin='<!-- BEGIN GIT-PARALLEL-WORKTREE -->',end='<!-- END GIT-PARALLEL-WORKTREE -->';
const source=await readFile(new URL('../docs/PARALLEL-DEVELOPMENT.md',import.meta.url),'utf8');
const block=source.slice(source.indexOf(begin),source.indexOf(end)+end.length);
if(!block.startsWith(begin)||!block.endsWith(end))throw new Error('Policy block missing');
const args=process.argv.slice(2),targets=[];
while(args.length){if(args.shift()!=='--target'||!args[0]||!isAbsolute(args[0]))throw new Error('Use --target <absolute existing rule file>');targets.push(resolve(args.shift()));}
if(!targets.length)throw new Error('At least one --target is required');
const digest=value=>createHash('sha256').update(value).digest('hex');
const folder=resolve('artifacts','parallel-policy-'+randomUUID());await mkdir(folder,{recursive:true});
const report={sourceSha256:digest(block),targets:[]};
for(const [i,target] of [...new Set(targets)].entries()){
  const stat=await lstat(target);if(!stat.isFile()||stat.isSymbolicLink())throw new Error('Expected regular rule file: '+target);
  const before=await readFile(target);const text=before.toString('utf8'),start=text.indexOf(begin),stop=text.indexOf(end);
  if((start<0)!==(stop<0)||(start>=0&&(stop<start||text.indexOf(begin,start+begin.length)>=0||text.indexOf(end,stop+end.length)>=0)))throw new Error('Ambiguous policy markers: '+target);
  const updated=start<0?text.replace(/\s*$/,'')+'\n\n'+block+'\n':text.slice(0,start)+block+text.slice(stop+end.length);
  const after=Buffer.from(updated);const changed=!before.equals(after);
  if(changed){
    await writeFile(join(folder,`${i}-before.md`),before,{flag:'wx'});
    // Recheck the same file handle immediately before writing; do not overwrite
    // edits made since inspection. Preserve its existing file permissions.
    const handle=await open(target,'r+');
    try{
      const current=await handle.readFile();if(!current.equals(before))throw new Error('Rule file changed during installation: '+target);
      await handle.write(after,0,after.length,0);await handle.truncate(after.length);await handle.sync();
    }finally{await handle.close();}
  }
  const actual=await readFile(target);if(!actual.equals(after))throw new Error('Installed rule verification failed: '+target);
  report.targets.push({target,changed,beforeSha256:digest(before),afterSha256:digest(actual)});
  await writeFile(join(folder,'report.json'),JSON.stringify(report,null,2));
}
console.log(JSON.stringify({folder,...report},null,2));
