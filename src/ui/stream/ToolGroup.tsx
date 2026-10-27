import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { PILL_HEIGHT, TYPE } from '../../theme/tokens';
import { MONO, useTheme } from '../theme';
import { describeTool, toolCommand, toolFailed, toolKinds } from '../tool-format';

export interface ToolEntry {
  id: string;
  name: string;
  time: number;
  args?: string;
  output?: string;
  isError?: boolean;
  /** 还没有 result 回来 */
  running?: boolean;
}

interface Props {
  tools: ToolEntry[];
}

/**
 * 连续工具调用合并成一个胶囊（§2.1）：
 * 运行中默认展开逐行转圈，跑完自动折叠成「已折叠 N 项」。
 */
export function ToolGroup({ tools }: Props) {
  const running = tools.some((tool) => tool.running);
  const [manual, setManual] = useState<boolean | null>(null);
  const open = manual ?? running;
  const [openId, setOpenId] = useState<string | null>(null);
  const done = tools.filter((tool) => !tool.running).length;
  const t = useTheme();

  return (
    <View style={[styles.card, { backgroundColor: t.bg.subtle, borderColor: t.border.subtle }]}>
      <Pressable
        style={styles.header}
        onPress={() => setManual(!open)}
        hitSlop={4}
        accessibilityRole="button"
        accessibilityLabel={open ? '收起工具调用' : '展开工具调用'}
      >
        {running ? (
          <ActivityIndicator size="small" color={t.text.muted} style={styles.spinner} />
        ) : (
          <View style={[styles.dot, { backgroundColor: t.text.muted }]} />
        )}
        <Text style={[styles.label, { color: t.text.primary }]} numberOfLines={1}>
          {running ? `正在连续调用工具 (${done}/${tools.length})` : `已折叠 ${tools.length} 项连续工具调用`}
        </Text>
        {!open ? (
          <Text style={[styles.meta, { color: t.text.muted }]} numberOfLines={1}>
            ({toolKinds(tools.map((tool) => tool.name))})
          </Text>
        ) : null}
        <View style={styles.tail}>
          <Text style={[styles.meta, { color: t.text.muted }]}>{open ? '收起' : '查阅'}</Text>
          <Text style={[styles.chevron, { color: t.text.muted }]}>{open ? '⌃' : '⌄'}</Text>
        </View>
      </Pressable>

      {open ? (
        <View style={[styles.body, { borderTopColor: t.border.subtle }]}>
          {tools.map((tool) => (
            <ToolRow
              key={tool.id}
              tool={tool}
              expanded={openId === tool.id}
              onToggle={() => setOpenId((current) => (current === tool.id ? null : tool.id))}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function ToolRow({
  tool,
  expanded,
  onToggle,
}: {
  tool: ToolEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  const t = useTheme();
  const command = toolCommand(tool.name, tool.args);
  const summary = describeTool(tool.name, tool.args);
  const output = tool.output?.trim();
  const failed = toolFailed(tool.name, output, tool.isError);
  const canExpand = Boolean(command || output);

  return (
    <Pressable
      onPress={canExpand ? onToggle : undefined}
      disabled={!canExpand}
      style={styles.row}
    >
      <View style={styles.rowHead}>
        {tool.running ? (
          <ActivityIndicator size="small" color={t.text.muted} style={styles.rowSpinner} />
        ) : (
          <View
            style={[
              styles.rowDot,
              { backgroundColor: failed ? t.semantic.dangerText : t.text.muted },
            ]}
          />
        )}
        <Text style={[styles.rowName, { color: t.text.primary }]}>{tool.name.toUpperCase()}</Text>
        <Text style={[styles.rowSummary, { color: t.text.secondary }]} numberOfLines={1}>
          {summary}
        </Text>
        {failed ? (
          <Text style={[styles.rowFail, { color: t.semantic.dangerText }]}>失败</Text>
        ) : null}
      </View>
      {expanded && command ? (
        <Text style={[styles.code, { color: t.text.secondary }]}>{command}</Text>
      ) : null}
      {expanded && output ? (
        <Text style={[styles.output, { color: t.text.secondary }]} numberOfLines={24}>
          {output}
        </Text>
      ) : null}
    </Pressable>
  );
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
  label: { ...TYPE.pill, fontFamily: MONO, fontWeight: '500', flexShrink: 1 },
  meta: { ...TYPE.pill, fontFamily: MONO, flexShrink: 1 },
  tail: { flexDirection: 'row', alignItems: 'center', gap: 2, marginLeft: 'auto' },
  chevron: { ...TYPE.pill, fontFamily: MONO },
  body: { borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 4, paddingHorizontal: 6 },
  row: { paddingVertical: 5, paddingHorizontal: 4, borderRadius: 8 },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowSpinner: { transform: [{ scale: 0.6 }], width: 12 },
  rowDot: { width: 4, height: 4, borderRadius: 2, marginLeft: 4 },
  rowName: { ...TYPE.pill, fontFamily: MONO, fontWeight: '600' },
  rowSummary: { ...TYPE.pill, flex: 1 },
  rowFail: { ...TYPE.pill, fontFamily: MONO },
  code: { ...TYPE.mono, fontFamily: MONO, marginTop: 4, marginLeft: 12 },
  output: { ...TYPE.mono, fontFamily: MONO, marginTop: 4, marginLeft: 12, opacity: 0.9 },
});
