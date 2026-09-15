import test from 'node:test';
import assert from 'node:assert/strict';
import {Economy} from '../server/economy.js';

test('new profiles receive 200 points once while existing balances and welcome history are preserved',()=>{
  const fresh=new Economy();
  assert.equal(fresh.data.balance,200);
  assert.equal(fresh.data.ledger.filter(e=>e.kind==='welcome').length,1);
  const legacy=structuredClone(fresh.data);
  legacy.balance=17;
  legacy.ledger[0].amount=60;
  const restored=new Economy(legacy);
  assert.equal(restored.data.balance,17);
  assert.equal(restored.data.ledger[0].amount,60);
  assert.equal(restored.data.ledger.length,1);
});
