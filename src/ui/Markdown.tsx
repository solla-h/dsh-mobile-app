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

export function MarkdownView({
  text,
  onFileLink,
  onQuoteCode,
}: {
  text: string;
  /** 本地文件链接交给调用方打开；网页链接仍然走系统浏览器。 */
  onFileLink?: (path: string) => void;
  /** 代码块「引用」：手机上没有好用的拖选，整块塞进输入框更实际。 */
  onQuoteCode?: (lang: string, code: string) => void;
}) {
  const tokens = useMemo(() => md.parse(text, {}) as unknown as MdToken[], [text]);
  if (!text.trim()) return null;
  return <View>{renderBlocks(tokens, 0, tokens.length, 'md', onFileLink, onQuoteCode)}</View>;
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
  onFileLink?: (path: string) => void,
  onQuoteCode?: (lang: string, code: string) => void,
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
            {renderInline(inline?.children ?? [], key, onFileLink)}
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
            {renderInline(inline?.children ?? [], key, onFileLink)}
          </Text>,
        );
        i += 3;
        break;
      }
      case 'fence':
      case 'code_block': {
        const lang = (token.info || '').trim().split(/\s+/)[0] ?? '';
        out.push(
          <CodeBlock
            key={keyBase + '-c' + i}
            code={token.content.replace(/\n$/, '')}
            lang={lang}
            onQuote={onQuoteCode}
          />,
        );
        i += 1;
        break;
      }
      case 'blockquote_open': {
        const end = findClose(tokens, i, 'blockquote_open', 'blockquote_close');
        const key = keyBase + '-q' + i;
        out.push(
          <View key={key} style={styles.quote}>
            {renderBlocks(tokens, i + 1, end, key, onFileLink, onQuoteCode)}
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
                {renderBlocks(tokens, cursor + 1, itemEnd, key, onFileLink, onQuoteCode)}
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
            {renderInline(token.children ?? [], key, onFileLink)}
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
  const { width: windowWidth } = useWindowDimensions();
  // 列表左右各 14、气泡左右各 14，再留一点余量。
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

  // 每一列按「最宽的单元格」定宽，再夹到可读区间。
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
  // 一屏放得下就按比例铺满，放不下就横向滚动，绝不再把列压成一条竖线。
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
                  {renderInline(tokensOfCell, key, onFileLink)}
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
  onFileLink?: (path: string) => void,
): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const stack: unknown[] = [];
  let href: string | null = null;
  let index = 0;
  // 工作区文件交给调用方下载预览，网页和未知 scheme 仍然交给系统。
  const openHref = (target: string) => {
    if (onFileLink && isLocalFileHref(target)) {
      onFileLink(hrefToPath(target));
      return;
    }
    // 打不开的 scheme（比如没注册的自定义协议）会 reject，别让它变成未捕获异常。
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

const SPAN_COLOR: Record<SpanKind, { color: string }> = {
  plain: { color: '#D6DAE3' },
  comment: { color: '#5C6373' },
  string: { color: '#A5D6A7' },
  number: { color: '#F0B37E' },
  keyword: { color: '#8FB6FF' },
  literal: { color: '#C792EA' },
};

function CodeBlock({
  code,
  lang,
  onQuote,
}: {
  code: string;
  lang: string;
  onQuote?: (lang: string, code: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const spans = useMemo(() => highlight(code, lang), [code, lang]);
  return (
    <View style={styles.codeBlock}>
      <View style={styles.codeHeader}>
        <Text style={styles.codeLang}>{lang || 'text'}</Text>
        <View style={styles.codeActions}>
          {onQuote ? (
            <Pressable hitSlop={8} onPress={() => onQuote(lang, code)}>
              <Text style={styles.copy}>引用</Text>
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
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.codeScroll}>
        <Text style={styles.codeText}>
          {spans.map((span, index) => (
            <Text key={index} style={SPAN_COLOR[span.kind]}>
              {span.text}
            </Text>
          ))}
        </Text>
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

const styles = StyleSheet.create({
  paragraph: { color: '#EDEFF3', fontSize: 15, lineHeight: 22, marginBottom: 6 },
  paragraphLast: { marginBottom: 0 },
  heading: { color: '#F5F6F8', fontWeight: '700', marginTop: 4, marginBottom: 4 },
  strong: { fontWeight: '700' },
  em: { fontStyle: 'italic' },
  strike: { textDecorationLine: 'line-through' },
  link: { color: '#8FB6FF', textDecorationLine: 'underline' },
  codeInline: {
    fontFamily: MONO,
    fontSize: 13,
    color: '#F0B37E',
    backgroundColor: '#1E2128',
  },
  list: { marginVertical: 2 },
  listRow: { flexDirection: 'row', marginBottom: 2 },
  listMarker: { color: '#7A8091', fontSize: 15, lineHeight: 22, width: 18 },
  listBody: { flex: 1 },
  quote: {
    borderLeftWidth: 2,
    borderLeftColor: '#2B303B',
    paddingLeft: 10,
    marginVertical: 4,
  },
  hr: { height: StyleSheet.hairlineWidth, backgroundColor: '#2B303B', marginVertical: 10 },
  table: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#262A33',
    borderRadius: 8,
    overflow: 'hidden',
    marginVertical: 4,
  },
  tableRow: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#262A33' },
  tableHead: { backgroundColor: '#1B1E25' },
  tableCell: { paddingHorizontal: 8, paddingVertical: 6 },
  tableScroll: { flexGrow: 0 },
  tableScrollContent: { paddingRight: 2 },
  th: { color: '#C9CDD6', fontSize: 13, lineHeight: 18, fontWeight: '600' },
  td: { color: '#D6DAE3', fontSize: 13, lineHeight: 18 },
  codeBlock: {
    backgroundColor: '#0E1014',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#1E2128',
    borderRadius: 10,
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
    borderBottomColor: '#1E2128',
  },
  codeLang: { color: '#5B6070', fontSize: 10, letterSpacing: 0.6, textTransform: 'uppercase' },
  codeActions: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  copy: { color: '#7A8091', fontSize: 11 },
  codeScroll: { paddingHorizontal: 10, paddingVertical: 8 },
  codeText: { fontFamily: MONO, fontSize: 12.5, lineHeight: 18 },
});
