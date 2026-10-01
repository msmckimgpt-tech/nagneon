import {test} from 'node:test';
import assert from 'node:assert/strict';
import {repeatedChat} from '../server/chat-quality.js';

test('long normalized laughter is a shared reaction across distinct viewers',()=>{
  const prior={personaId:'pop',text:'ㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋ',kind:'chat',time:10000};
  for(const text of ['ㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋ','ㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋ','ㅎㅎㅎㅎㅎㅎㅎㅎㅎㅎ','ᄏᄏᄏᄏᄏᄏᄏᄏᄏᄏ!!']){
    assert.equal(repeatedChat({personaId:'momo',text},[prior],11000),false,text);
    assert.equal(repeatedChat({personaId:'pop',text},[prior],11000),true,text);
  }
});
test('laughter spacing keeps the eight-second same-viewer guard without suppressing later reactions',()=>{
  const prior={personaId:'pop',text:'ㅋㅋㅋㅋㅋㅋㅋㅋ',kind:'chat',time:10000};
  assert.equal(repeatedChat({personaId:'pop',text:'ㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋ'},[prior],18000),true);
  assert.equal(repeatedChat({personaId:'pop',text:'ㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋ'},[prior],18001),false);
});
test('ordinary repeated prose and identical punctuation remain protected',()=>{
  const text='처음에 장비를 고르면 전투가 편해지겠네요';
  assert.equal(repeatedChat({personaId:'momo',text},[{personaId:'pop',text,kind:'chat',time:10000}],20000),true);
  assert.equal(repeatedChat({personaId:'pop',text:'?'},[{personaId:'pop',text:'?',kind:'chat',time:10000}],11000),true);
  assert.equal(repeatedChat({personaId:'momo',text:'?'},[{personaId:'pop',text:'?',kind:'chat',time:10000}],11000),false);
});

 test('laughter suffix does not weaken repeated prose protection',()=>{
 const text='처음부터 다시 순서대로 진행해야겠네요';
 const prior={personaId:'pop',text:text+' ㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋ',kind:'chat',time:10000};
 assert.equal(repeatedChat({personaId:'momo',text:prior.text},[prior],11000),true);
 assert.equal(repeatedChat({personaId:'pop',text:prior.text},[prior],11000),true);
 });
