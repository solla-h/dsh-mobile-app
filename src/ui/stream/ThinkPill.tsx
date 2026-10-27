import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { PILL_HEIGHT, TYPE } from '../../theme/tokens';
import { MONO, useTheme } from '../theme';

interface Props {
  text: string;
  /** 还在流式输出：默认展开，流结束自动折叠成 34pt 胶囊 */
  streaming?: boolean;
  /** 已知的思考耗时，比如 1m 42s */
  elapsed?: string;
}

/** Stage 1 展开打字机 → Stage 3 自动折叠的单行胶囊（§2.1）。 */
export function ThinkPill({ text, streaming, elapsed }: Props) {
  const t = useTheme();
  // null = 跟随流式状态；用户手动点过之后以手动为准，别再自动弹回去。
  const [manual, setManual] = useState<boolean | null>(null);
  const open = manual ?? Boolean(streaming);
  const summary = firstLine(text);

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: t.bg.subtle, borderColor: t.border.subtle },
      ]}
    >
      <Pressable
        style={styles.header}
        onPress={() => setManual(!open)}
        hitSlop={4}
        accessibilityRole="button"
        accessibilityLabel={open ? '收起思考过程' : '展开思考过程'}
      >
        {streaming ? (
          <ActivityIndicator size="small" color={t.text.muted} style={styles.spinner} />
        ) : (
          <View style={[styles.dot, { backgroundColor: t.text.muted }]} />
        )}
        <Text style={[styles.label, { color: t.text.primary }]} numberOfLines={1}>
          {streaming ? '正在深度思考' : '已深度思考'}
        </Text>
        {elapsed ? (
          <Text style={[styles.meta, { color: t.text.muted }]}>({elapsed})</Text>
        ) : null}
        {!open && summary ? (
          <Text style={[styles.summary, { color: t.text.secondary }]} numberOfLines={1}>
            · {summary}
          </Text>
        ) : null}
        <View style={styles.tail}>
          <Text style={[styles.meta, { color: t.text.muted }]}>{open ? '收起' : '展开'}</Text>
          <Text style={[styles.chevron, { color: t.text.muted }]}>{open ? '⌃' : '⌄'}</Text>
        </View>
      </Pressable>
      {open ? (
        <View style={[styles.body, { borderTopColor: t.border.subtle }]}>
          <Text style={[styles.bodyText, { color: t.text.secondary }]}>{text}</Text>
        </View>
      ) : null}
    </View>
  );
}

function firstLine(text: string): string {
  const line = text.trim().split('\n').find((item) => item.trim().length > 0) ?? '';
  const clean = line.replace(/^[#>*\-\s]+/, '').trim();
  return clean.length > 46 ? clean.slice(0, 46) + '…' : clean;
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  header: {
    minHeight: PILL_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    gap: 6,
  },
  spinner: { transform: [{ scale: 0.7 }], width: 14 },
  dot: { width: 4, height: 4, borderRadius: 2 },
  label: { ...TYPE.pill, fontFamily: MONO, fontWeight: '500' },
  meta: { ...TYPE.pill, fontFamily: MONO },
  summary: { ...TYPE.pill, flexShrink: 1 },
  tail: { flexDirection: 'row', alignItems: 'center', gap: 2, marginLeft: 'auto' },
  chevron: { ...TYPE.pill, fontFamily: MONO },
  body: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 10,
  },
  bodyText: { ...TYPE.mono, fontFamily: MONO },
});
