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

test('native chat background changes are reversible and cannot request arbitrary materials', () => {
  const { applyChatBackground } = require('../chat-window.cjs');
  const calls = [];
  const window = { setVibrancy: value => calls.push(['vibrancy', value]), setBackgroundColor: value => calls.push(['color', value]) };
  assert.deepEqual(applyChatBackground(window, 'glass', 'darwin'), { nativeGlass: true });
  assert.deepEqual(applyChatBackground(window, 'white', 'darwin'), { nativeGlass: false });
  assert.deepEqual(calls, [['vibrancy', 'under-window'], ['color', '#00000000'], ['vibrancy', null], ['color', '#ffffff']]);
  calls.length = 0;
  assert.deepEqual(applyChatBackground(window, 'glass', 'linux'), { nativeGlass: false });
  assert.deepEqual(calls, [['color', '#ffffff']]);
  assert.throws(() => applyChatBackground(window, 'sidebar', 'darwin'), /Invalid/);
});

test('chat appearance accepts only explicit app themes and supports older callers', () => {
  const { parseChatAppearance } = require('../chat-window.cjs');
  assert.deepEqual(parseChatAppearance('glass'), { background: 'glass', theme: 'light' });
  for (const theme of ['light', 'dark']) assert.deepEqual(parseChatAppearance({ background: 'glass', theme }), { background: 'glass', theme });
  for (const value of [null, {}, { background: 'glass', theme: 'system' }, { background: 'url(evil)', theme: 'dark' }]) assert.throws(() => parseChatAppearance(value), /Invalid/);
});
