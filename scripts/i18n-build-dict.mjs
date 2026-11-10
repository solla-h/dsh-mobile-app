/**
 * 由扫描清单 + 仓库内翻译分片生成运行时字典（可重复执行，完全离线）。
 *
 *   node scripts/i18n-extract.mjs       # 生成 scripts/i18n/keys.json 与 report.md
 *   node scripts/i18n-build-dict.mjs    # 生成 src/i18n/keys.ts 与 src/i18n/en.ts
 *
 * 翻译分片 en-part-1..4.json 已随仓库纳入 scripts/i18n/，
 * 新克隆无需临时目录、无需联网、无需手工拷贝即可重生成字典。
 * 形状沿用官方 packages/client/ui-approval/src/client/locales.ts：
 * 中文是 key 全集真源，英文 satisfies Record<Key,string>，漏一条即编译错误。
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DATA = path.join(ROOT, 'scripts', 'i18n');
const OUT = path.join(ROOT, 'src', 'i18n');

/** 位于 src/i18n 内、扫描器排除后仍需进入字典的文案。 */
const EXTRA = {
  // src/i18n/index.tsx 内的语言选项名（该目录被扫描器排除）
  '中文': 'Chinese',
  '简体中文': 'Simplified Chinese',
  // 语言设置行（官方 settings.locale: language.title = Language）
  '语言': 'Language',
  '界面': 'Appearance',
};

const scanned = JSON.parse(fs.readFileSync(path.join(DATA, 'keys.json'), 'utf8'));

// 这段 JSX 说明文案带源码换行/缩进，不适合手写进分片 JSON，按前缀动态补齐。
const longKey = scanned.find((item) => item.key.startsWith('审批记录来自网关的审计事件'))?.key;
if (longKey) {
  EXTRA[longKey] =
    'Approval records come from gateway audit events (approval/asked + approval/decided): The decision you just made first appears as a local echo; the audit record takes over once history is reloaded.';
}

const translations = {};
for (let i = 1; i <= 4; i += 1) {
  const file = path.join(DATA, `en-part-${i}.json`);
  if (!fs.existsSync(file)) continue;
  Object.assign(translations, JSON.parse(fs.readFileSync(file, 'utf8')));
}
Object.assign(translations, EXTRA);

const allKeys = [...new Set([...scanned.map((item) => item.key), ...Object.keys(EXTRA)])]
  .sort((a, b) => a.localeCompare(b, 'zh'));

const quote = (value) => JSON.stringify(value);
const placeholders = (value) => [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

const missing = [];
const mismatch = [];
const lines = [];
for (const key of allKeys) {
  const value = translations[key];
  if (typeof value !== 'string' || !value) {
    missing.push(key);
    lines.push(`  ${quote(key)}: ${quote(key)},`);
  } else {
    if (placeholders(key) !== placeholders(value)) mismatch.push(key);
    lines.push(`  ${quote(key)}: ${quote(value)},`);
  }
}

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(
  path.join(OUT, 'keys.ts'),
  [
    '// 由 scripts/i18n-build-dict.mjs 生成，请勿手工编辑。',
    '/** 中文文案 key 全集（中文即界面真源，英文由 en.ts 对齐）。 */',
    'export const KEYS = [',
    ...allKeys.map((key) => `  ${quote(key)},`),
    '] as const;',
    '',
    'export type Key = (typeof KEYS)[number];',
    '',
  ].join('\n'),
  'utf8',
);
fs.writeFileSync(
  path.join(OUT, 'en.ts'),
  [
    '// 由 scripts/i18n-build-dict.mjs 生成，请勿手工编辑。',
    "import type { Key } from './keys';",
    '',
    '/** 英文字典；satisfies 保证漏一条中文 key 就是编译错误。 */',
    'export const en = {',
    ...lines,
    '} satisfies Record<Key, string>;',
    '',
  ].join('\n'),
  'utf8',
);

console.log(`keys=${allKeys.length} missing=${missing.length} placeholderMismatch=${mismatch.length}`);
if (missing.length) console.log('MISSING:\n' + missing.slice(0, 40).join('\n'));
if (mismatch.length) console.log('PLACEHOLDER MISMATCH:\n' + mismatch.join('\n'));
