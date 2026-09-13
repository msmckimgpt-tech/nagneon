import {parseArgs} from 'node:util';
import {resolve} from 'node:path';
import {installMicrophoneModel} from './lib/microphone-model.mjs';
const {values}=parseArgs({options:{source:{type:'string'},target:{type:'string',default:'.models/microphone'}}});
if(!values.source)throw Error('Use --source <downloaded model directory> [--target <model directory>]');
console.log(JSON.stringify(await installMicrophoneModel(resolve(values.source),resolve(values.target)),null,2));
