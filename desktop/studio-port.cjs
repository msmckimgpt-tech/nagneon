const fs = require('node:fs');
const { join } = require('node:path');
const { randomUUID } = require('node:crypto');

function storedPort(profile) {
  const file = join(profile, 'data', 'desktop-origin.json');
  let value;
  try {
    if (fs.statSync(file).size > 1024) throw Error('invalid origin settings');
    value = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return 0;
    throw Error('저장된 앱 연결 주소를 읽지 못했습니다. 기존 설정 파일은 보존했습니다.');
  }
  if (
    value?.version !== 1 ||
    !Number.isInteger(value.port) ||
    value.port < 1024 ||
    value.port > 65535
  )
    throw Error('저장된 앱 연결 주소가 올바르지 않습니다. 기존 설정 파일은 보존했습니다.');
  return value.port;
}

function savePort(profile, port) {
  const directory = join(profile, 'data');
  fs.mkdirSync(directory, { recursive: true });
  const file = join(directory, 'desktop-origin.json'),
    temporary = file + '.' + randomUUID() + '.tmp';
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(descriptor, JSON.stringify({ version: 1, port }) + '\n');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, file);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    try {
      fs.unlinkSync(temporary);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

// Media device IDs depend on the renderer origin. Keep the previously assigned
// loopback port, while every server still generates its own authentication token.
async function startStableStudio({ profile, start }) {
  const prior = storedPort(profile);
  let service;
  try {
    service = await start(prior);
  } catch (error) {
    if (!prior || error.code !== 'EADDRINUSE') throw error;
    // Never stop an unrelated listener. The saved microphone stays selected;
    // if its origin-bound ID no longer resolves, the UI requires reselection.
    service = await start(0);
  }
  const origin = new URL(service.url),
    port = Number(origin.port);
  try {
    if (
      origin.protocol !== 'http:' ||
      origin.hostname !== '127.0.0.1' ||
      !Number.isInteger(port) ||
      port < 1024 ||
      port > 65535
    )
      throw Error('앱의 로컬 연결 주소를 확인하지 못했습니다.');
    if (port !== prior) savePort(profile, port);
    if (prior && port !== prior)
      console.warn('앱의 로컬 연결 주소가 변경됐습니다. 저장된 마이크를 확인해주세요.');
  } catch (error) {
    await service.close();
    throw error;
  }
  return service;
}
module.exports = { startStableStudio, storedPort };
