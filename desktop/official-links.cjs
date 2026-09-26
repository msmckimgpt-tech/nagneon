const KEY_CONSOLES = Object.freeze({
  typesafe: 'https://console.typesafe.ai/keys',
  openrouter: 'https://openrouter.ai/settings/keys',
});
function openOfficialKeyConsole({
  event,
  mainWebContents,
  serviceUrl,
  openExternal,
  provider = 'typesafe',
}) {
  if (event?.sender !== mainWebContents || !event.senderFrame?.url.startsWith(serviceUrl + '/')) {
    throw new Error('허용되지 않은 창 요청');
  }
  if (!Object.hasOwn(KEY_CONSOLES, provider)) throw new Error('허용되지 않은 JEV 제공처');
  return openExternal(KEY_CONSOLES[provider]);
}
module.exports = { openOfficialKeyConsole };
