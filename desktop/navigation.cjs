// Attach only to the studio window. Overlay commands must stay isolated.
function attachNavigationHistory(win) {
  const listener = (_event, command) => {
    const direction =
      command === 'browser-backward' ? 'back' : command === 'browser-forward' ? 'forward' : null;
    if (direction && !win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send('navigation:history', direction);
    }
  };
  win.on('app-command', listener);
  return () => win.removeListener('app-command', listener);
}
module.exports = { attachNavigationHistory };
