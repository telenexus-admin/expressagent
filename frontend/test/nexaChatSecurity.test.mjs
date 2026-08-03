import assert from 'node:assert/strict';
import { messagesForLLM, messagesForStorage } from '../src/utils/nexaChatSecurity.js';

const messages = [
  { id: 'welcome', role: 'assistant', text: 'Welcome' },
  { id: 'question', role: 'user', text: 'Add a MikroTik' },
  { id: 'password', role: 'user', text: '••••••••', private: true, sensitive: true, raw: 'never-store-me' },
  { id: 'script', role: 'assistant', text: 'Script ready', script: ':local password="never-store-me"', sensitive: true },
  { id: 'answer', role: 'assistant', text: 'What name should I use?' },
];

const stored = messagesForStorage(messages);
const history = messagesForLLM(messages);
const serialized = JSON.stringify({ stored, history });

assert.deepEqual(stored.map((item) => item.id), ['question', 'answer']);
assert.deepEqual(history.map((item) => item.content), ['Add a MikroTik', 'What name should I use?']);
assert.equal(serialized.includes('never-store-me'), false);
assert.equal(serialized.includes('••••••••'), false);
assert.equal(serialized.includes(':local password'), false);

console.log('Nexa chat password and script isolation tests passed.');
