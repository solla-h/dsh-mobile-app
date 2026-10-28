import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { TYPE } from '../../theme/tokens';
import { tapFeedback } from '../haptics';
import { MONO, useTheme } from '../theme';

export type DiffKind = 'add' | 'del' | 'ctx' | 'hunk' | 'meta';

export interface DiffLine {
  kind: DiffKind;
  text: string;
  /** 新文件里的行号；删除行没有 */
  no?: number;
}

export interface QuoteLine {
  file?: string;
  lineNo?: number;
  text: string;
}

/** 解析 unified diff；不是 diff 的文本按普通代码块处理（kind 全是 ctx）。 */
export function parseUnifiedDiff(source: string): DiffLine[] {
  const rows: DiffLine[] = [];
  let newNo: number | undefined;
  for (const raw of source.split('\n')) {
    if (raw.startsWith('@@')) {
      const match = /\+([0-9]+)/.exec(raw);
      newNo = match ? Number(match[1]) : undefined;
      rows.push({ kind: 'hunk', text: raw });
      continue;
    }
    if (raw.startsWith('--- ') || raw.startsWith('+++ ') || raw.startsWith('diff --git')) {
      rows.push({ kind: 'meta', text: raw });
      continue;
    }
    if (raw.startsWith('+')) {
      rows.push({ kind: 'add', text: raw.slice(1), no: newNo });
      if (newNo !== undefined) newNo += 1;
      continue;
    }
    if (raw.startsWith('-')) {
      rows.push({ kind: 'del', text: raw.slice(1) });
      continue;
    }
    rows.push({ kind: 'ctx', text: raw.startsWith(' ') ? raw.slice(1) : raw, no: newNo });
    if (newNo !== undefined) newNo += 1;
  }
  return rows;
}

/** 从 diff 头里找文件名：优先 +++ b/xxx，其次 diff --git 的 a/xxx。 */
export function diffFile(source: string): string | undefined {
  const plus = /^\+\+\+ b\/(.+)$/m.exec(source);
  if (plus) return plus[1].trim();
  const git = /^diff --git a\/(.+?) b\//m.exec(source);
  return git ? git[1].trim() : undefined;
}

interface Props {
  source: string;
  file?: string;
  /** 最多显示多少行，超出折叠 */
  limit?: number;
  onQuote?: (line: QuoteLine) => void;
}

/**
 * 移动端 Diff：默认自动折行，单指轻点任意一行即引用（§3.1 Tap-Line-to-Quote）。
 */
export function DiffView({ source, file, limit = 120, onQuote }: Props) {
  const t = useTheme();
  const [wrap, setWrap] = useState(true);
  const [picked, setPicked] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const lines = useMemo(() => parseUnifiedDiff(source), [source]);
  const name = file ?? diffFile(source);
  const additions = useMemo(
    () => lines.filter((l) => l.kind === 'add').length,
    [lines],
  );
  const deletions = useMemo(
    () => lines.filter((l) => l.kind === 'del').length,
    [lines],
  );
  const shown = expanded ? lines : lines.slice(0, limit);

  return (
    <View style={[styles.card, { backgroundColor: t.bg.surface, borderColor: t.border.default }]}>
      <View style={[styles.head, { borderBottomColor: t.border.subtle }]}>
        <Text style={[styles.file, { color: t.text.primary }]} numberOfLines={1}>
          {name ?? '补丁预览'}
        </Text>
        {additions > 0 || deletions > 0 ? (
          <Text style={[styles.stats, { color: t.text.muted }]}>
            +{additions}/-{deletions}
          </Text>
        ) : null}
        <Pressable hitSlop={8} onPress={() => setWrap((value) => !value)}>
          <Text style={[styles.toggle, { color: t.text.secondary }]}>
            {wrap ? '自动折行' : '横向滚动'}
          </Text>
        </Pressable>
      </View>
      {onQuote ? (
        <View style={[styles.hintRow, { borderBottomColor: t.border.subtle }]}>
          <Text style={[styles.hintText, { color: t.text.muted }]}>
            点按任意代码行可直接引用到输入框追问
          </Text>
        </View>
      ) : null}
      <ScrollView horizontal={!wrap} style={styles.body} contentContainerStyle={styles.bodyInner}>
        <View style={wrap ? styles.wrapCol : undefined}>
          {shown.map((line, index) => {
            const tone =
              line.kind === 'add'
                ? { bg: t.semantic.diffAddBg, fg: t.semantic.diffAddText, sign: '+' }
                : line.kind === 'del'
                  ? { bg: t.semantic.diffDelBg, fg: t.semantic.diffDelText, sign: '-' }
                  : {
                      bg: 'transparent',
                      fg: line.kind === 'hunk' || line.kind === 'meta' ? t.text.muted : t.text.secondary,
                      sign: ' ',
                    };
            const isPicked = picked === index;
            return (
              <Pressable
                key={index}
                onPress={() => {
                  if (!onQuote || line.kind === 'meta' || line.kind === 'hunk') return;
                  tapFeedback();
                  setPicked(index);
                  onQuote({ file: name, lineNo: line.no, text: line.text });
                }}
                style={[
                  styles.line,
                  { backgroundColor: tone.bg },
                  isPicked ? { borderColor: t.text.primary, borderWidth: 1 } : null,
                ]}
              >
                <Text style={[styles.no, { color: t.text.muted }]}>{line.no ?? ''}</Text>
                <Text style={[styles.sign, { color: tone.fg }]}>{tone.sign}</Text>
                <Text
                  style={[styles.code, { color: tone.fg }, wrap ? styles.wrapText : null]}
                  numberOfLines={wrap ? undefined : 1}
                >
                  {line.text || ' '}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
      {lines.length > limit ? (
        <Pressable
          style={[styles.more, { borderTopColor: t.border.subtle }]}
          onPress={() => setExpanded((value) => !value)}
        >
          <Text style={[styles.toggle, { color: t.text.secondary }]}>
            {expanded ? '收起' : `展开剩余 ${lines.length - limit} 行`}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  file: { ...TYPE.mono, fontFamily: MONO, fontWeight: '600', flex: 1 },
  stats: { ...TYPE.mono, fontFamily: MONO, fontVariant: ['tabular-nums'] },
  toggle: { ...TYPE.mono, fontFamily: MONO, textDecorationLine: 'underline' },
  hintRow: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  hintText: { ...TYPE.mono, fontFamily: MONO, fontSize: 9.5 },
  body: { maxHeight: 320 },
  bodyInner: { paddingVertical: 4, paddingHorizontal: 4 },
  wrapCol: { flex: 1 },
  line: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginVertical: 0.5,
  },
  no: {
    ...TYPE.mono,
    fontFamily: MONO,
    fontVariant: ['tabular-nums'],
    width: 26,
    textAlign: 'right',
    marginRight: 5,
    opacity: 0.65,
  },
  sign: {
    ...TYPE.mono,
    fontFamily: MONO,
    width: 10,
    opacity: 0.75,
  },
  code: { ...TYPE.mono, fontFamily: MONO, flexShrink: 1 },
  wrapText: { flex: 1, flexWrap: 'wrap' },
  more: { paddingVertical: 8, alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth },
});
