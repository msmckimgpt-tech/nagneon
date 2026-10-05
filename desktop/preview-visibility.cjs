// backgroundThrottling:false is required by capture/recording; its Page
// Visibility behavior cannot be relied on to suspend only the local display.
function attachPreviewVisibility({ main, ipcMain }) {
  // BrowserWindow accessors may be unavailable during closed-event cleanup.
  const contents = main.webContents;
  const visible = () => !main.isDestroyed() && main.isVisible() && !main.isMinimized();
  const send = () => {
    if (!main.isDestroyed() && !contents.isDestroyed()) contents.send('preview:visible', visible());
  };
  const events = ['show', 'hide', 'minimize', 'restore'];
  const read = (event) => {
    if (event.sender !== contents || event.senderFrame !== contents.mainFrame)
      throw Error('메인 방송 창에서 미리보기 상태를 확인하세요.');
    return visible();
  };
  ipcMain.handle('preview:visibility', read);
  for (const event of events) main.on(event, send);
  contents.on('did-finish-load', send);
  main.once('closed', () => {
    for (const event of events) main.removeListener(event, send);
    contents.removeListener('did-finish-load', send);
    ipcMain.removeHandler('preview:visibility');
  });
}
module.exports = { attachPreviewVisibility };
