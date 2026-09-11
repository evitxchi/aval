'use strict';
/** Only the trusted dashboard may open Aval's same-process chat portal. */
function isChatWindowRequest({ url, frameName }, senderUrl, allowedOrigin) {
  try { return new URL(senderUrl).origin === allowedOrigin && url === 'about:blank' && frameName === 'aval-chat'; }
  catch { return false; }
}
function applyChatBackground(window, background, platform = process.platform) {
  if (background !== 'white' && background !== 'glass') throw new Error('Invalid chat background.');
  const nativeGlass = platform === 'darwin' && background === 'glass';
  if (platform === 'darwin') window.setVibrancy(nativeGlass ? 'under-window' : null);
  window.setBackgroundColor(nativeGlass ? '#00000000' : '#ffffff');
  return { nativeGlass };
}
function parseChatAppearance(payload) {
  const value = typeof payload === 'string' ? { background: payload, theme: 'light' } : payload;
  if (!value || !['white', 'glass'].includes(value.background) || !['light', 'dark'].includes(value.theme)) throw new Error('Invalid chat appearance.');
  return { background: value.background, theme: value.theme };
}
module.exports = { isChatWindowRequest, applyChatBackground, parseChatAppearance };
