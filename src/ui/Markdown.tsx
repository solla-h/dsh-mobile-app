import { useTheme, useThemedStyles } from './theme';
import type { Palette } from '../theme/tokens';
import { useMemo, useState } from 'react';
import {
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import MarkdownIt from 'markdown-it';

import { hrefToPath, isLocalFileHref } from '../protocol/files';
import { DiffView, type QuoteLine } from './stream/DiffView';

/**
 * 只依赖 markdown-it 的 token 流，自己映射到 RN 组件。
 * 表格、嵌套列表这些边界情况交给解析器，样式完全由我们控制。
 */
interface MdToken {
  type: string;
  tag: string;
  content: string;
  info: string;
  markup: string;
  children: MdToken[] | null;
  attrGet?: (name: string) => string | null;
}

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  typographer: false,
});

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

type MarkdownStyles = ReturnType<typeof makeStyles>;

export function MarkdownView({
  text,
  onFileLink,
  onQuoteCode,
  onQuoteLine,
}: {
  text: string;
  /** 本地文件链接交给调用方打开；网页链接仍然走系统浏览器。 */
  onFileLink?: (path: string) => void;
  /** 代码块「引用」：手机上没有好用的拖选，整块塞进输入框更实际。 */
  onQuoteCode?: (lang: string, code: string) => void;
  /** Diff 块单指轻点任意一行即引用（§3.1 Tap-Line-to-Quote） */
  onQuoteLine?: (line: QuoteLine) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const tokens = useMemo(() => md.parse(text, {}) as unknown as MdToken[], [text]);
  if (!text.trim()) return null;
  return (
    <View>
      {renderBlocks(tokens, 0, tokens.length, 'md', styles, onFileLink, onQuoteCode, onQuoteLine)}
    </View>
  );
}

function findClose(tokens: MdToken[], from: number, open: string, close: string): number {
  let depth = 0;
  for (let i = from; i < tokens.length; i += 1) {
    if (tokens[i].type === open) depth += 1;
    else if (tokens[i].type === close) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return tokens.length;
}

function renderBlocks(
  tokens: MdToken[],
  from: number,
  to: number,
  keyBase: string,
  styles: MarkdownStyles,
  onFileLink?: (path: string) => void,
  onQuoteCode?: (lang: string, code: string) => void,
  onQuoteLine?: (line: QuoteLine) => void,
): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let i = from;
  while (i < to) {
    const token = tokens[i];
    switch (token.type) {
      case 'paragraph_open': {
        const inline = tokens[i + 1];
        const key = keyBase + '-p' + i;
        out.push(
          <Text key={key} style={[styles.paragraph, i + 3 >= to ? styles.paragraphLast : null]}>
            {renderInline(inline?.children ?? [], key, styles, onFileLink)}
          </Text>,
        );
        i += 3;
        break;
      }
      case 'heading_open': {
        const level = Number(token.tag.slice(1)) || 1;
        const inline = tokens[i + 1];
        const key = keyBase + '-h' + i;
        out.push(
          <Text key={key} style={[styles.heading, HEADING_SIZE[level] ?? HEADING_SIZE[3]]}>
            {renderInline(inline?.children ?? [], key, styles, onFileLink)}
          </Text>,
        );
        i += 3;
        break;
      }
      case 'fence':
      case 'code_block': {
        const lang = (token.info || '').trim().split(/\s+/)[0] ?? '';
        const rawCode = token.content.replace(/\n$/, '');
        const isDiffFence =
          lang.toLowerCase() === 'diff' ||
          lang.toLowerCase() === 'patch' ||
          /^(\+\+\+|---|@@|diff --git)/m.test(rawCode);
        if (isDiffFence) {
          out.push(
            <View key={keyBase + '-diff' + i} style={styles.diffBlockWrap}>
              <DiffView
                source={rawCode}
                onQuote={
                  onQuoteLine ??
                  (onQuoteCode
                    ? (line) => onQuoteCode('diff', line.text)
                    : undefined)
                }
              />
            </View>,
          );
        } else {
          out.push(
            <CodeBlock
              key={keyBase + '-c' + i}
              code={rawCode}
              lang={lang}
              onQuote={onQuoteCode}
              onQuoteLine={onQuoteLine}
            />,
          );
        }
        i += 1;
        break;
      }
      case 'blockquote_open': {
        const end = findClose(tokens, i, 'blockquote_open', 'blockquote_close');
        const key = keyBase + '-q' + i;
        out.push(
          <View key={key} style={styles.quote}>
            {renderBlocks(tokens, i + 1, end, key, styles, onFileLink, onQuoteCode, onQuoteLine)}
          </View>,
        );
        i = end + 1;
        break;
      }
      case 'bullet_list_open':
      case 'ordered_list_open': {
        const ordered = token.type === 'ordered_list_open';
        const end = findClose(tokens, i, token.type, ordered ? 'ordered_list_close' : 'bullet_list_close');
        const start = Number(token.attrGet?.('start') ?? 1) || 1;
        const items: React.ReactNode[] = [];
        let cursor = i + 1;
        let index = 0;
        while (cursor < end) {
          const item = tokens[cursor];
          if (item.type !== 'list_item_open') {
            cursor += 1;
            continue;
          }
          const itemEnd = findClose(tokens, cursor, 'list_item_open', 'list_item_close');
          const key = keyBase + '-li' + cursor;
          items.push(
            <View key={key} style={styles.listRow}>
              <Text style={styles.listMarker}>{ordered ? start + index + '.' : '•'}</Text>
              <View style={styles.listBody}>
                {renderBlocks(tokens, cursor + 1, itemEnd, key, styles, onFileLink, onQuoteCode, onQuoteLine)}
              </View>
            </View>,
          );
          index += 1;
          cursor = itemEnd + 1;
        }
        out.push(
          <View key={keyBase + '-l' + i} style={styles.list}>
            {items}
          </View>,
        );
        i = end + 1;
        break;
      }
      case 'table_open': {
        const end = findClose(tokens, i, 'table_open', 'table_close');
        const key = keyBase + '-t' + i;
        out.push(
          <Table key={key} tokens={tokens} from={i + 1} to={end} keyBase={key} onFileLink={onFileLink} />,
        );
        i = end + 1;
        break;
      }
      case 'hr': {
        out.push(<View key={keyBase + '-hr' + i} style={styles.hr} />);
        i += 1;
        break;
      }
      case 'inline': {
        const key = keyBase + '-i' + i;
        out.push(
          <Text key={key} style={styles.paragraph}>
            {renderInline(token.children ?? [], key, styles, onFileLink)}
          </Text>,
        );
        i += 1;
        break;
      }
      default:
        i += 1;
        break;
    }
  }
  return out;
}

/** 单元格的纯文本，用来估算列宽（不参与渲染）。 */
function cellText(tokens: MdToken[]): string {
  let text = '';
  for (const token of tokens) {
    if (token.type === 'text' || token.type === 'code_inline') text += token.content;
    else if (token.type === 'softbreak' || token.type === 'hardbreak') text += ' ';
  }
  return text;
}

/** 按字符宽度估算：中日韩全角按字号算，其余按 0.55 个字号。 */
function estimateWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    width += (char.codePointAt(0) ?? 0) > 0x2e80 ? 13 : 7.2;
  }
  return width;
}

const CELL_PADDING = 18;
const MIN_COL = 64;
const MAX_COL = 200;

function Table({
  tokens,
  from,
  to,
  keyBase,
  onFileLink,
}: {
  tokens: MdToken[];
  from: number;
  to: number;
  keyBase: string;
  onFileLink?: (path: string) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { width: windowWidth } = useWindowDimensions();
  const available = Math.max(200, windowWidth - 60);

  const rows: { header: boolean; cells: MdToken[][] }[] = [];
  let row: { header: boolean; cells: MdToken[][] } | null = null;
  let cell: MdToken[] | null = null;
  for (let i = from; i < to; i += 1) {
    const token = tokens[i];
    if (token.type === 'tr_open') {
      row = { header: false, cells: [] };
    } else if (token.type === 'th_open') {
      if (row) row.header = true;
      cell = [];
    } else if (token.type === 'td_open') {
      cell = [];
    } else if (token.type === 'inline' && cell) {
      cell = token.children ?? [];
    } else if ((token.type === 'th_close' || token.type === 'td_close') && row) {
      if (token.type === 'th_close') row.header = true;
      row.cells.push(cell ?? []);
      cell = null;
    } else if (token.type === 'tr_close' && row) {
      rows.push(row);
      row = null;
    }
  }
  if (rows.length === 0) return null;

  const columns = Math.max(...rows.map((item) => item.cells.length));
  const widths: number[] = [];
  for (let index = 0; index < columns; index += 1) {
    let widest = MIN_COL - CELL_PADDING;
    for (const item of rows) {
      const tokensOfCell = item.cells[index];
      if (!tokensOfCell) continue;
      const measured = estimateWidth(cellText(tokensOfCell));
      if (measured > widest) widest = measured;
    }
    widths.push(Math.min(MAX_COL, Math.max(MIN_COL, widest + CELL_PADDING)));
  }

  const total = widths.reduce((sum, value) => sum + value, 0);
  const scrollable = total > available;

  const table = (
    <View style={[styles.table, scrollable ? { width: total } : null]}>
      {rows.map((item, rowIndex) => (
        <View key={keyBase + '-r' + rowIndex} style={[styles.tableRow, item.header ? styles.tableHead : null]}>
          {Array.from({ length: columns }, (_unused, columnIndex) => {
            const tokensOfCell = item.cells[columnIndex] ?? [];
            const key = keyBase + '-c' + rowIndex + '-' + columnIndex;
            return (
              <View
                key={key}
                style={[
                  styles.tableCell,
                  scrollable ? { width: widths[columnIndex] } : { flex: widths[columnIndex] },
                ]}
              >
                <Text style={item.header ? styles.th : styles.td}>
                  {renderInline(tokensOfCell, key, styles, onFileLink)}
                </Text>
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );

  if (!scrollable) return table;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.tableScroll}
      contentContainerStyle={styles.tableScrollContent}
    >
      {table}
    </ScrollView>
  );
}

function renderInline(
  tokens: MdToken[],
  keyBase: string,
  styles: MarkdownStyles,
  onFileLink?: (path: string) => void,
): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const stack: unknown[] = [];
  let href: string | null = null;
  let index = 0;
  const openHref = (target: string) => {
    if (onFileLink && isLocalFileHref(target)) {
      onFileLink(hrefToPath(target));
      return;
    }
    Linking.openURL(target).catch(() => undefined);
  };
  for (const token of tokens) {
    switch (token.type) {
      case 'text':
        nodes.push(
          <Text
            key={keyBase + '-t' + index++}
            style={stack.length ? (stack as never) : undefined}
            onPress={href ? () => openHref(href as string) : undefined}
          >
            {token.content}
          </Text>,
        );
        break;
      case 'code_inline':
        nodes.push(
          <Text key={keyBase + '-ci' + index++} style={[styles.codeInline, ...(stack as never[])]}>
            {token.content}
          </Text>,
        );
        break;
      case 'strong_open':
        stack.push(styles.strong);
        break;
      case 'strong_close':
        stack.pop();
        break;
      case 'em_open':
        stack.push(styles.em);
        break;
      case 'em_close':
        stack.pop();
        break;
      case 's_open':
        stack.push(styles.strike);
        break;
      case 's_close':
        stack.pop();
        break;
      case 'link_open':
        href = token.attrGet?.('href') ?? null;
        stack.push(styles.link);
        break;
      case 'link_close':
        stack.pop();
        href = null;
        break;
      case 'softbreak':
      case 'hardbreak':
        nodes.push(<Text key={keyBase + '-br' + index++}>{'\n'}</Text>);
        break;
      case 'image':
        nodes.push(
          <Text key={keyBase + '-img' + index++} style={styles.link}>
            {'[图片] ' + (token.content || '')}
          </Text>,
        );
        break;
      default:
        break;
    }
  }
  return nodes;
}

/* ---------------------------------------------------------------- 代码高亮 */

type SpanKind = 'plain' | 'comment' | 'string' | 'number' | 'keyword' | 'literal';

interface Span {
  text: string;
  kind: SpanKind;
}

interface LangConfig {
  comment: RegExp;
  keywords: Set<string>;
  literals: Set<string>;
  caseInsensitive?: boolean;
}

const words = (text: string) => new Set(text.split(/\s+/).filter(Boolean));

const JS = words(
  'const let var function return if else for while do switch case break continue new class extends super import export from default try catch finally throw typeof instanceof in of await async yield delete void static get set interface type enum implements readonly public private protected namespace declare abstract as satisfies keyof infer',
);
const JS_LITERALS = words('true false null undefined this NaN');

const PY = words(
  'def class return if elif else for while import from as with try except finally raise pass lambda yield async await global nonlocal assert del break continue and or not in is',
);
const PY_LITERALS = words('True False None self cls');

const SH = words(
  'if then else fi for do done while until case esac function export local return exit echo cd ls cat grep sed awk curl sudo apt npm node set source eval',
);
const SH_LITERALS = words('true false');

const GO = words(
  'package import func var const type struct interface map chan go defer select range return if else for switch case break continue fallthrough goto',
);
const GO_LITERALS = words('true false nil iota');

const RUST = words(
  'fn let mut const static struct enum trait impl pub use mod crate super self match if else for while loop return break continue where async await move dyn ref type',
);
const RUST_LITERALS = words('true false None Some Ok Err');

const JAVA = words(
  'public private protected class interface extends implements static final void int long double float boolean char String new return if else for while do switch case break continue try catch finally throw throws import package this super abstract synchronized volatile transient native enum record',
);
const JAVA_LITERALS = words('true false null');

const SQL = words(
  'select from where insert into values update set delete create table drop alter add column join left right inner outer on group by order having limit offset union all distinct as and or not null is like in between case when then else end primary key foreign references index',
);
const SQL_LITERALS = words('true false null');

const LANG_MAP: Record<string, LangConfig> = {
  js: { comment: /^(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/)/, keywords: JS, literals: JS_LITERALS },
  py: { comment: /^#[^\n]*/, keywords: PY, literals: PY_LITERALS },
  sh: { comment: /^#[^\n]*/, keywords: SH, literals: SH_LITERALS },
  go: { comment: /^(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/)/, keywords: GO, literals: GO_LITERALS },
  rust: { comment: /^(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/)/, keywords: RUST, literals: RUST_LITERALS },
  java: { comment: /^(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/)/, keywords: JAVA, literals: JAVA_LITERALS },
  sql: { comment: /^--[^\n]*/, keywords: SQL, literals: SQL_LITERALS, caseInsensitive: true },
  css: { comment: /^\/\*[\s\S]*?\*\//, keywords: words('important media supports keyframes font-face'), literals: words('') },
};

const LANG_ALIAS: Record<string, string> = {
  js: 'js', javascript: 'js', jsx: 'js', ts: 'js', typescript: 'js', tsx: 'js', json: 'js', jsonc: 'js', node: 'js',
  py: 'py', python: 'py', python3: 'py',
  sh: 'sh', bash: 'sh', shell: 'sh', zsh: 'sh', console: 'sh', fish: 'sh',
  go: 'go', golang: 'go',
  rs: 'rust', rust: 'rust',
  java: 'java', kt: 'java', kotlin: 'java', c: 'java', cpp: 'java', 'c++': 'java', cs: 'java', csharp: 'java', swift: 'java',
  sql: 'sql', postgres: 'sql', postgresql: 'sql', mysql: 'sql', sqlite: 'sql',
  css: 'css', scss: 'css', less: 'css',
};

const STRING_RE = /^(?:"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|\x60(?:[^\x60\\]|\\.)*\x60)/;
const NUMBER_RE = /^(?:0[xXbBoO][0-9a-fA-F_]+|\d[\d_]*(?:\.[\d_]+)?(?:[eE][+-]?\d+)?)/;
const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*/;

function highlight(code: string, lang: string): Span[] {
  const config = LANG_MAP[LANG_ALIAS[lang.toLowerCase()] ?? ''];
  if (!config) return [{ text: code, kind: 'plain' }];
  const spans: Span[] = [];
  const push = (text: string, kind: SpanKind) => {
    if (!text) return;
    const last = spans[spans.length - 1];
    if (last && last.kind === kind) last.text += text;
    else spans.push({ text, kind });
  };
  let i = 0;
  while (i < code.length) {
    const rest = code.slice(i);
    let match: RegExpExecArray | null;
    if ((match = config.comment.exec(rest))) {
      push(match[0], 'comment');
      i += match[0].length;
      continue;
    }
    if ((match = STRING_RE.exec(rest))) {
      push(match[0], 'string');
      i += match[0].length;
      continue;
    }
    if ((match = NUMBER_RE.exec(rest))) {
      push(match[0], 'number');
      i += match[0].length;
      continue;
    }
    if ((match = IDENT_RE.exec(rest))) {
      const word = config.caseInsensitive ? match[0].toLowerCase() : match[0];
      if (config.literals.has(word)) push(match[0], 'literal');
      else if (config.keywords.has(word)) push(match[0], 'keyword');
      else push(match[0], 'plain');
      i += match[0].length;
      continue;
    }
    push(rest[0], 'plain');
    i += 1;
  }
  return spans;
}

const spanColor = (t: Palette): Record<SpanKind, { color: string }> => ({
  plain: { color: t.text.primary },
  comment: { color: t.text.muted },
  string: { color: t.semantic.diffAddText },
  number: { color: t.semantic.gateAmberText },
  keyword: { color: t.text.primary },
  literal: { color: t.text.secondary },
});

function CodeBlock({
  code,
  lang,
  onQuote,
  onQuoteLine,
}: {
  code: string;
  lang: string;
  onQuote?: (lang: string, code: string) => void;
  onQuoteLine?: (line: QuoteLine) => void;
}) {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [copied, setCopied] = useState(false);
  const [wrap, setWrap] = useState(true);
  const [pickedLine, setPickedLine] = useState<number | null>(null);
  const lines = useMemo(() => code.split('\n'), [code]);

  return (
    <View style={styles.codeBlock}>
      <View style={styles.codeHeader}>
        <Text style={styles.codeLang}>{lang || 'code'} · 点按行可引用</Text>
        <View style={styles.codeActions}>
          <Pressable hitSlop={8} onPress={() => setWrap((v) => !v)}>
            <Text style={styles.copy}>{wrap ? '自动折行' : '横向滚动'}</Text>
          </Pressable>
          {onQuote ? (
            <Pressable hitSlop={8} onPress={() => onQuote(lang, code)}>
              <Text style={styles.copy}>整块引用</Text>
            </Pressable>
          ) : null}
          <Pressable
            hitSlop={8}
            onPress={() => {
              void Clipboard.setStringAsync(code);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            <Text style={styles.copy}>{copied ? '已复制' : '复制'}</Text>
          </Pressable>
        </View>
      </View>
      <ScrollView
        horizontal={!wrap}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.codeScroll}
      >
        <View style={wrap ? styles.wrapCol : undefined}>
          {lines.map((lineText, idx) => {
            const spans = highlight(lineText, lang);
            const selected = pickedLine === idx;
            return (
              <Pressable
                key={idx}
                onPress={() => {
                  if (!lineText.trim()) return;
                  setPickedLine(idx);
                  if (onQuoteLine) {
                    onQuoteLine({ file: lang || 'code', lineNo: idx + 1, text: lineText });
                  } else if (onQuote) {
                    onQuote(lang, lineText);
                  }
                }}
                style={[
                  styles.codeLineRow,
                  selected ? { borderColor: t.text.primary, borderWidth: 1, backgroundColor: t.bg.surface } : null,
                ]}
              >
                <Text style={styles.codeLineNo}>{idx + 1}</Text>
                <Text style={[styles.codeText, wrap ? styles.wrapText : null]}>
                  {spans.map((span, sIdx) => (
                    <Text key={sIdx} style={spanColor(t)[span.kind]}>
                      {span.text}
                    </Text>
                  ))}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

/* ------------------------------------------------------------------ 样式 */

const HEADING_SIZE: Record<number, object> = {
  1: { fontSize: 20, lineHeight: 27 },
  2: { fontSize: 18, lineHeight: 25 },
  3: { fontSize: 16.5, lineHeight: 23 },
  4: { fontSize: 15.5, lineHeight: 22 },
  5: { fontSize: 15, lineHeight: 22 },
  6: { fontSize: 14.5, lineHeight: 21 },
};

const makeStyles = (t: Palette) =>
  StyleSheet.create({
  paragraph: { color: t.text.primary, fontSize: 15, lineHeight: 22, marginBottom: 6 },
  paragraphLast: { marginBottom: 0 },
  heading: { color: t.text.primary, fontWeight: '700', marginTop: 4, marginBottom: 4 },
  strong: { fontWeight: '700' },
  em: { fontStyle: 'italic' },
  strike: { textDecorationLine: 'line-through' },
  link: { color: t.text.primary, textDecorationLine: 'underline' },
  codeInline: {
    fontFamily: MONO,
    fontSize: 13,
    color: t.semantic.gateAmberText,
    backgroundColor: t.border.subtle,
    // Android 上这个 radius 不生效：RN 用 BackgroundColorSpan 画 <Text> 的背景，
    // 只能画矩形（试过调到 16 依然是直角）。iOS 生效，所以留着。
    borderRadius: 2,
    paddingHorizontal: 3,
  },
  list: { marginVertical: 2 },
  listRow: { flexDirection: 'row', marginBottom: 2 },
  listMarker: { color: t.text.muted, fontSize: 15, lineHeight: 22, width: 18 },
  listBody: { flex: 1 },
  quote: {
    borderLeftWidth: 2,
    borderLeftColor: t.border.default,
    paddingLeft: 10,
    marginVertical: 4,
  },
  hr: { height: StyleSheet.hairlineWidth, backgroundColor: t.border.default, marginVertical: 10 },
  table: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.border.default,
    borderRadius: 8,
    overflow: 'hidden',
    marginVertical: 4,
  },
  tableRow: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.border.default },
  tableHead: { backgroundColor: t.bg.surface },
  tableCell: { paddingHorizontal: 8, paddingVertical: 6 },
  tableScroll: { flexGrow: 0 },
  tableScrollContent: { paddingRight: 2 },
  th: { color: t.text.secondary, fontSize: 13, lineHeight: 18, fontWeight: '600' },
  td: { color: t.text.primary, fontSize: 13, lineHeight: 18 },
  diffBlockWrap: { marginVertical: 6 },
  codeBlock: {
    backgroundColor: t.bg.canvas,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.border.subtle,
    // 同心圆角：这个块嵌在 AnswerCard(16) 里，正文内距 11 → 16 - 11 = 5。
    // 之前是 10，比容器只小一点，角落的缝看着比边上宽。
    borderRadius: 5,
    marginVertical: 6,
    overflow: 'hidden',
  },
  codeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.border.subtle,
  },
  codeLang: { color: t.text.muted, fontSize: 10, letterSpacing: 0.4, textTransform: 'uppercase' },
  codeActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  copy: { color: t.text.muted, fontSize: 11 },
  codeScroll: { paddingHorizontal: 6, paddingVertical: 6 },
  wrapCol: { flex: 1 },
  codeLineRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 4,
    paddingVertical: 1.5,
    borderRadius: 4,
  },
  codeLineNo: {
    fontFamily: MONO,
    fontSize: 10.5,
    lineHeight: 18,
    color: t.text.muted,
    width: 24,
    textAlign: 'right',
    marginRight: 8,
    opacity: 0.65,
  },
  codeText: { fontFamily: MONO, fontSize: 12.5, lineHeight: 18, flexShrink: 1 },
  wrapText: { flex: 1, flexWrap: 'wrap' },
});
