'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { isChatWindowRequest } = require('../chat-window.cjs');
test('only a trusted dashboard can create the blank chat portal window', () => {
  const origin = 'https://aval.example';
  const request = { url: 'about:blank', frameName: 'aval-chat' };
  assert.equal(isChatWindowRequest(request, origin + '/en', origin), true);
  for (const [details, sender] of [
    [request, 'https://other.example/en'], [request, 'about:blank'],
    [{ ...request, url: 'https://other.example' }, origin],
    [{ ...request, url: 'javascript:alert(1)' }, origin],
    [{ ...request, frameName: 'other' }, origin],
  ]) assert.equal(isChatWindowRequest(details, sender, origin), false);
});
