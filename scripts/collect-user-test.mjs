import {UserTestCollector} from './lib/user-test-collector.mjs';
import {runCollector} from './lib/collector-runner.mjs';

const option=name=>process.argv.find(arg=>arg.startsWith('--'+name+'='))?.slice(name.length+3);
const source=option('source'),output=option('output'),since=Date.parse(option('since')),until=Date.parse(option('until'));
if(!source||!output||!Number.isFinite(since)||!Number.isFinite(until))throw Error('Required: --source=<data> --output=<new folder> --since=<ISO time> --until=<ISO time>');
const collector=new UserTestCollector({source,output,since,until});
await collector.initialize({resume:process.argv.includes('--resume')});
const result=await runCollector(collector,{once:process.argv.includes('--once')});
process.exitCode=result.exitCode;
