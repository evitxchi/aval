'use strict';
/** Only the trusted dashboard may open Aval's same-process chat portal. */
function isChatWindowRequest({ url, frameName }, senderUrl, allowedOrigin) {
  try { return new URL(senderUrl).origin === allowedOrigin && url === 'about:blank' && frameName === 'aval-chat'; }
  catch { return false; }
}
module.exports = { isChatWindowRequest };
