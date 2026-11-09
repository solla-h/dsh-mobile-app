import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWindowsCommandLine } from '../setup-gateway.mjs';

test('splits a quoted executable and quoted args with spaces', () => {
  assert.deepEqual(
    parseWindowsCommandLine(
      '"C:\\Program Files\\nodejs\\node.exe" "C:\\Users\\example\\AppData\\Roaming\\npm\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js" web --no-open',
    ),
    [
      'C:\\Program Files\\nodejs\\node.exe',
      'C:\\Users\\example\\AppData\\Roaming\\npm\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js',
      'web',
      '--no-open',
    ],
  );
});

test('keeps unquoted arguments and spaces inside quotes', () => {
  assert.deepEqual(parseWindowsCommandLine('node "a b" c'), ['node', 'a b', 'c']);
});

test('turns a backslash-escaped quote into a literal quote', () => {
  assert.deepEqual(parseWindowsCommandLine('"a\\"b" c'), ['a"b', 'c']);
});

test('preserves an empty quoted argument', () => {
  assert.deepEqual(parseWindowsCommandLine('node "" --flag'), ['node', '', '--flag']);
});
