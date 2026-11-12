/**
 * i18n 文案扫描（开发期工具，不参与运行时）。
 *
 * 用 TypeScript AST 找出 App.tsx 与 src/ 下所有需要在界面上显示的中文字符串，
 * 输出去重后的 key 清单与用途报告。注释天然不会被 AST 遍历到。
 *
 *   node scripts/i18n-extract.mjs
 *
 * 输出目录：scripts/i18n/（随仓库纳入，字典可离线重生成）
 *   keys.json   去重后的 key 清单（供 build-dict 与 codemod 使用）
 *   report.md   人类可读的统计报告
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT_DIR = path.join(ROOT, 'scripts', 'i18n');
const HAN = /[\u3400-\u9FFF\uF900-\uFAFF]/;
const EQUALITY = new Set([
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
]);

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

function keyOf(node, sf) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return { key: node.text, expressions: [] };
  }
  if (ts.isTemplateExpression(node)) {
    let key = node.head.text;
    const expressions = [];
    node.templateSpans.forEach((span, i) => {
      key += `{${i}}` + span.literal.text;
      expressions.push(span.expression.getText(sf));
    });
    return { key, expressions };
  }
  if (ts.isJsxText(node)) return { key: node.text.trim(), expressions: [] };
  return null;
}

function shouldSkip(node, sf) {
  const p = node.parent;
  if (!p) return true;
  if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isImportSpecifier(p)) return true;
  if (ts.isLiteralTypeNode(p)) return true;
  if (ts.isPropertyAssignment(p) && p.name === node) return true;
  if (ts.isElementAccessExpression(p) && p.argumentExpression === node) return true;
  if (ts.isBinaryExpression(p) && EQUALITY.has(p.operatorToken.kind)) return true;
  if (ts.isCaseClause(p) && p.expression === node) return true;
  if (ts.isCallExpression(p)) {
    const callee = p.expression.getText(sf);
    // tr('中文') 的参数也是 key 全集的一部分（例如模块级惰性字典），要收进来；
    // codemod 会识别这种已包装的节点，不会重复替换。
    if (callee.startsWith('console.') || callee === 'require') return true;
  }
  if (ts.isJsxAttribute(p) && p.name.getText(sf).startsWith('test')) return true;
  return false;
}

function isModuleLevel(node) {
  let p = node.parent;
  while (p) {
    if (
      ts.isFunctionDeclaration(p) || ts.isFunctionExpression(p) || ts.isArrowFunction(p) ||
      ts.isMethodDeclaration(p) || ts.isGetAccessorDeclaration(p) || ts.isSetAccessorDeclaration(p) ||
      ts.isConstructorDeclaration(p) || ts.isClassDeclaration(p)
    ) return false;
    if (ts.isSourceFile(p)) return true;
    p = p.parent;
  }
  return true;
}

const entries = new Map();
let skipped = 0;
const perFile = new Map();

for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  let count = 0;

  const visit = (node) => {
    const interesting =
      ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateExpression(node) || ts.isJsxText(node);
    if (interesting) {
      const built = keyOf(node, sf);
      if (built && HAN.test(built.key)) {
        if (shouldSkip(node, sf)) {
          skipped += 1;
        } else {
          const pos = sf.getLineAndCharacterOfPosition(node.getStart(sf));
          const line = pos.line + 1;
          const parentKind = ts.SyntaxKind[node.parent?.kind ?? 'Unknown'];
          const context = text.slice(Math.max(0, node.getStart(sf) - 60), node.getEnd()).replace(/\s+/g, ' ').trim().slice(-140);
          const kind = ts.isJsxText(node) ? 'jsx'
            : ts.isTemplateExpression(node) ? 'template'
              : ts.isNoSubstitutionTemplateLiteral(node) ? 'template' : 'string';
          if (!entries.has(built.key)) {
            entries.set(built.key, {
              key: built.key,
              kind,
              expressions: built.expressions,
              files: [],
            });
          }
          const entry = entries.get(built.key);
          if (!entry.files.some((f) => f.file === rel && f.line === line)) {
            entry.files.push({ file: rel, line, parentKind, context, moduleLevel: isModuleLevel(node) });
          }
          count += 1;
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (count) perFile.set(rel, count);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const list = [...entries.values()].sort((a, b) => a.key.localeCompare(b.key, 'zh'));
fs.writeFileSync(path.join(OUT_DIR, 'keys.json'), JSON.stringify(list, null, 2), 'utf8');

const byKind = { string: 0, template: 0, jsx: 0 };
for (const e of list) byKind[e.kind] += 1;
const moduleLevel = list.filter((e) => e.files.some((f) => f.moduleLevel));
const report = [
  '# i18n 扫描报告',
  '',
  `- 扫描文件：${files.length}`,
  `- 去重后 key：${list.length}`,
  `- 按类型：${JSON.stringify(byKind)}`,
  `- 含模块级求值（切换语言需惰性处理）：${moduleLevel.length}`,
  `- 跳过的非文案节点：${skipped}`,
  '',
  '## 各文件命中数',
  '',
  ...[...perFile.entries()].sort((a, b) => b[1] - a[1]).map(([f, n]) => `- ${f}: ${n}`),
  '',
  '## 模块级 key（需人工改为惰性求值）',
  '',
  ...moduleLevel.map((e) => `- \`${e.key.replace(/`/g, '\\`')}\` — ${e.files.filter((f) => f.moduleLevel).map((f) => `${f.file}:${f.line}`).join(', ')}`),
  '',
].join('\n');
fs.writeFileSync(path.join(OUT_DIR, 'report.md'), report, 'utf8');

console.log(`keys=${list.length} kinds=${JSON.stringify(byKind)} moduleLevel=${moduleLevel.length} skipped=${skipped}`);
console.log(`out=${OUT_DIR}`);
