/**
 * 把源码里的中文文案接成 tr() 调用（开发期一次性 codemod，已执行完毕，
 * 保留仅供审计；正常构建流程不需要再跑它，重复执行是幂等空操作）。
 *
 *   node scripts/i18n-extract.mjs && node scripts/i18n-apply.mjs
 *
 * 依赖 scripts/i18n/keys.json（由 extract 生成），仅用于 unknownKeys 诊断；
 * 新克隆先跑 extract 才有这份数据。
 * 两遍扫描：第一遍替换字符串字面量与 JSX 文本，第二遍重解析后替换模板串，
 * 这样模板串插值里的中文字符串会先变成 tr()，不会互相覆盖。
 * 已包在 tr('...') 里的参数、比较基准、case、对象 key、元素访问下标一律跳过。
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const ROOT = path.resolve(import.meta.dirname, '..');
const DATA = path.join(ROOT, 'scripts', 'i18n');
const HAN = /[\u3400-\u9FFF\uF900-\uFAFF]/;
const EQUALITY = new Set([
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
]);
const keySet = new Set(
  JSON.parse(fs.readFileSync(path.join(DATA, 'keys.json'), 'utf8')).map((item) => item.key),
);
const quote = (value) => JSON.stringify(value);

function walk(dir, acc) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (
      entry.name === 'node_modules' || entry.name === '__tests__' ||
      entry.name === 'i18n' || entry.name.startsWith('.')
    ) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (/\.tsx?$/.test(entry.name) && !/\.d\.ts$/.test(entry.name)) acc.push(full);
  }
}

const files = [path.join(ROOT, 'App.tsx')];
walk(path.join(ROOT, 'src'), files);

function isWrappedTArgument(node, sf) {
  const p = node.parent;
  return !!p && ts.isCallExpression(p) && p.expression.getText(sf) === 'tr' && p.arguments[0] === node;
}

function shouldSkip(node, sf) {
  const p = node.parent;
  if (!p) return true;
  if (isWrappedTArgument(node, sf)) return true;
  if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isImportSpecifier(p)) return true;
  if (ts.isLiteralTypeNode(p)) return true;
  if (ts.isPropertyAssignment(p) && p.name === node) return true;
  if (ts.isElementAccessExpression(p) && p.argumentExpression === node) return true;
  if (ts.isBinaryExpression(p) && EQUALITY.has(p.operatorToken.kind)) return true;
  if (ts.isCaseClause(p) && p.expression === node) return true;
  if (ts.isCallExpression(p)) {
    const callee = p.expression.getText(sf);
    if (callee.startsWith('console.') || callee === 'require') return true;
  }
  if (ts.isJsxAttribute(p) && p.name.getText(sf).startsWith('test')) return true;
  return false;
}

function i18nPathFor(file) {
  const rel = path.relative(path.dirname(file), path.join(ROOT, 'src', 'i18n')).replace(/\\/g, '/');
  return rel.startsWith('.') ? rel : './' + rel;
}

function ensureImport(file, text, sf) {
  const target = i18nPathFor(file);
  const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const existing = new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*['"]${escaped}['"]`).exec(text);
  if (existing) {
    const names = existing[1].split(',').map((s) => s.trim()).filter(Boolean);
    if (names.includes('tr')) return text;
    const merged = ['tr', ...names].join(', ');
    return text.replace(existing[0], `import { ${merged} } from '${target}'`);
  }
  let lastImportEnd = -1;
  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt)) lastImportEnd = Math.max(lastImportEnd, stmt.getEnd());
  }
  const line = `import { tr } from '${target}';`;
  if (lastImportEnd < 0) return line + '\n' + text;
  return text.slice(0, lastImportEnd) + '\n' + line + text.slice(lastImportEnd);
}

const unknownKeys = new Set();
const counts = new Map();

function collect(text, file) {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const replacements = [];
  // 嵌套模板串不能和外层的替换同时做：两者的文本范围重叠，从后往前替换会互相覆盖。
  // 每轮只处理最外层模板串；外层变成 t() 后，内层会在下一轮重新被看到。
  const visit = (node, insideTemplate) => {
    if (insideTemplate) return;
    const kind = ts.isJsxText(node) ? 'jsx'
      : ts.isTemplateExpression(node) ? 'template'
        : (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? 'string' : null;
    if (kind) {
      let key;
      let args = '';
      if (kind === 'template') {
        key = node.head.text;
        const expressions = [];
        node.templateSpans.forEach((span, i) => {
          key += `{${i}}` + span.literal.text;
          expressions.push(span.expression.getText(sf));
        });
        args = `, [${expressions.join(', ')}]`;
      } else if (kind === 'jsx') {
        key = node.text.trim();
      } else {
        key = node.text;
      }
      if (key && HAN.test(key) && !shouldSkip(node, sf)) {
        if (!keySet.has(key)) unknownKeys.add(`${key} @ ${path.relative(ROOT, file)}`);
        const call = `tr(${quote(key)}${args})`;
        let replacement = call;
        if (kind === 'jsx') {
          const raw = node.text;
          const at = raw.indexOf(key);
          replacement = raw.slice(0, at) + `{${call}}` + raw.slice(at + key.length);
        } else if (node.parent && ts.isJsxAttribute(node.parent) && node.parent.initializer === node) {
          replacement = `{${call}}`;
        }
        replacements.push({ start: node.getStart(sf), end: node.getEnd(), replacement });
      }
    }
    const nodeIsTemplate = ts.isTemplateExpression(node);
    ts.forEachChild(node, (child) => visit(child, insideTemplate || nodeIsTemplate));
  };
  visit(sf, false);
  return { replacements, sf };
}

for (const file of files) {
  let text = fs.readFileSync(file, 'utf8');
  let total = 0;
  for (let round = 0; round < 8; round += 1) {
    const { replacements } = collect(text, file);
    if (!replacements.length) break;
    // 从后往前替换，避免前面的替换改变后面的偏移。
    replacements.sort((a, b) => b.start - a.start);
    for (const r of replacements) {
      text = text.slice(0, r.start) + r.replacement + text.slice(r.end);
    }
    total += replacements.length;
  }
  if (total > 0) {
    const finalSf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    text = ensureImport(file, text, finalSf);
    fs.writeFileSync(file, text, 'utf8');
    counts.set(path.relative(ROOT, file).replace(/\\/g, '/'), total);
  }
}

console.log(`files=${counts.size} replacements=${[...counts.values()].reduce((a, b) => a + b, 0)}`);
console.log(`unknownKeys=${unknownKeys.size}`);
if (unknownKeys.size) console.log([...unknownKeys].slice(0, 40).join('\n'));
