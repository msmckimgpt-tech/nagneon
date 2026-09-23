import test from 'node:test';
import assert from 'node:assert/strict';
import {isPlayableClip,sceneRecordPosts} from '../src/clip-presentation.ts';

test('only recorded media enters hot clips; image/text records become community attachments without mutation',()=>{
  const records=[
    {id:'photo',title:'함께 본 장면',scene:'시험 장면',createdAt:123,creator:{name:'관객'},video:false,audio:false,thumbnail:'png',commentCount:2,votes:['momo']},
    {id:'text',title:'한마디',scene:'시험 대화',createdAt:456,video:false,commentCount:1},
    {id:'video',video:true,audio:false},{id:'audio',video:false,audio:true},
  ];
  const before=structuredClone(records),posts=sceneRecordPosts(records);
  assert.deepEqual(records.filter(isPlayableClip).map(c=>c.id),['video','audio']);
  assert.deepEqual(posts.map(p=>p.recordId),['photo','text']);
  assert.deepEqual(posts[0],{id:'photo',recordId:'photo',title:'함께 본 장면',category:'장면 기록',name:'관객',text:'시험 장면',time:123,kind:'ai',votes:['momo'],commentCount:2});
  assert.deepEqual(records,before);
  records[0].video=true;
  assert.deepEqual(sceneRecordPosts(records).map(p=>p.recordId),['text']);
  assert.equal(records[0].commentCount,2);
});
