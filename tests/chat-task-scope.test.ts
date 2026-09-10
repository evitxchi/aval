import test from 'node:test';
import assert from 'node:assert/strict';
import { approvalsForChat } from '../lib/agents/chat-task-scope.ts';

test('chat includes root and server plan approvals while excluding unrelated tasks', () => {
 const pending=[{id:'a',taskId:'root'},{id:'b',taskId:'child'},{id:'c',taskId:'other'}];
 assert.deepEqual(approvalsForChat('root',{nodes:[{id:'child'}]},pending),pending.slice(0,2));
 assert.deepEqual(approvalsForChat('root',null,pending),[pending[0]]);
 assert.deepEqual(approvalsForChat('unknown',undefined,pending),[]);
});
