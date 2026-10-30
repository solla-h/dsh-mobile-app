import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  UIManager,
  View,
} from 'react-native';
import { PILL_HEIGHT, TYPE } from '../../theme/tokens';
import { softFeedback, tapFeedback } from '../haptics';
import { MONO, useTheme } from '../theme';
import {
  describeTool,
  extractToolDiff,
  toolCommand,
  toolFailed,
  toolKinds,
} from '../tool-format';
import { DiffView, type QuoteLine } from './DiffView';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export interface ToolEntry {
  id: string;
  callId?: string;
  name: string;
  time: number;
  args?: string;
  output?: string;
  isError?: boolean;
  /** 还没有 result 回来 */
  running?: boolean;
  /** 是否正处于阻塞等待用户审批的 Gate 状态 */
  pendingGate?: boolean;
}

interface Props {
  tools: ToolEntry[];
  /** 当前挂起的审批 callId，命中时在流中单独高亮为黄色 Gate 胶囊 */
  pendingCallId?: string;
  /** 点击黄色 Gate 步骤时直接放大打开底部方案 B 沉浸审批卡 */
  onOpenGate?: () => void;
  /** 点按工具内嵌 Diff 的某一行直接引用到输入框 */
  onQuoteLine?: (line: QuoteLine) => void;
}

/**
 * 连续工具调用合并成一个胶囊（§2.1 Stage 02 → Stage 03）：
 * 运行中默认展开逐行转圈；整批连续调用一旦全部完成，主动通过过阻尼曲线折叠为「已折叠 N 项连续工具调用」。
 * 遇到待审批 Gate 步骤时以暖琥珀色独立高亮，支持点按呼出方案 B 决策大卡或直接在流内点按 Diff 行引用。
 */
export function ToolGroup({ tools, pendingCallId, onOpenGate, onQuoteLine }: Props) {
  const hasGate = tools.some(
    (tool) => tool.pendingGate || (pendingCallId && tool.callId === pendingCallId),
  );
  const running = tools.some((tool) => tool.running) || hasGate;
  const [manual, setManual] = useState<boolean | null>(null);
  const prevRunningRef = useRef(running);

  // 当连续工具组从运行态变为全部完成态时，主动触发过阻尼折叠动画与柔触反馈
  useEffect(() => {
    if (prevRunningRef.current && !running) {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      softFeedback();
      setManual(null);
    }
    prevRunningRef.current = running;
  }, [running]);

  const open = manual ?? running;
  const [openId, setOpenId] = useState<string | null>(null);
  const done = tools.filter((tool) => !tool.running).length;
  const t = useTheme();

  const toggleGroup = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    tapFeedback();
    setManual(!open);
  };

  return (
    <View style={[styles.card, { backgroundColor: t.bg.subtle, borderColor: t.border.subtle }]}>
      <Pressable
        style={styles.header}
        onPress={toggleGroup}
        hitSlop={4}
        accessibilityRole="button"
        accessibilityLabel={open ? '收起工具调用' : '展开工具调用'}
      >
        {running ? (
          <ActivityIndicator size="small" color={t.text.muted} style={styles.spinner} />
        ) : (
          <Text style={[styles.layerIcon, { color: t.text.muted }]}>≡</Text>
        )}
        <Text style={[styles.label, { color: t.text.primary }]} numberOfLines={1}>
          {hasGate
            ? `等待审批 (${done}/${tools.length})`
            : running
              ? `正在连续调用工具 (${done}/${tools.length})`
              : `已折叠 ${tools.length} 项连续工具调用`}
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
          {tools.map((tool) => {
            const isGate =
              tool.pendingGate || Boolean(pendingCallId && tool.callId === pendingCallId);
            return (
              <ToolRow
                key={tool.id}
                tool={tool}
                isGate={isGate}
                expanded={isGate || openId === tool.id}
                onToggle={() => {
                  if (isGate && onOpenGate) {
                    onOpenGate();
                    return;
                  }
                  LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                  setOpenId((current) => (current === tool.id ? null : tool.id));
                }}
                onQuoteLine={onQuoteLine}
              />
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

function ToolRow({
  tool,
  isGate,
  expanded,
  onToggle,
  onQuoteLine,
}: {
  tool: ToolEntry;
  isGate: boolean;
  expanded: boolean;
  onToggle: () => void;
  onQuoteLine?: (line: QuoteLine) => void;
}) {
  const t = useTheme();
  const command = toolCommand(tool.name, tool.args);
  const summary = describeTool(tool.name, tool.args);
  const diffInfo = extractToolDiff(tool.name, tool.args, tool.output);
  const output = tool.output?.trim();
  const failed = toolFailed(tool.name, output, tool.isError);
  const canExpand = Boolean(isGate || diffInfo || command || output);

  return (
    <View
      style={[
        styles.rowCard,
        {
          backgroundColor: isGate ? t.semantic.gateAmberBg : t.bg.surface,
          borderColor: isGate
            ? t.semantic.gateAmberText
            : failed
              ? t.semantic.dangerText
              : t.border.subtle,
        },
      ]}
    >
      <Pressable onPress={canExpand ? onToggle : undefined} disabled={!canExpand} style={styles.row}>
        <View style={styles.rowHead}>
          {isGate ? (
            <Text style={[styles.statusMark, { color: t.semantic.gateAmberText }]}>!</Text>
          ) : tool.running ? (
            <ActivityIndicator size="small" color={t.text.muted} style={styles.rowSpinner} />
          ) : (
            <Text
              style={[
                styles.statusMark,
                { color: failed ? t.semantic.dangerText : t.text.muted },
              ]}
            >
              {failed ? '×' : '✓'}
            </Text>
          )}
          <Text
            style={[
              styles.rowName,
              { color: isGate ? t.semantic.gateAmberText : t.text.primary },
            ]}
          >
            {tool.name.toUpperCase()}
          </Text>
          <Text
            style={[
              styles.rowSummary,
              { color: isGate ? t.semantic.gateAmberText : t.text.secondary },
            ]}
            numberOfLines={1}
          >
            {summary}
          </Text>
          {diffInfo ? (
            <Text style={[styles.diffBadge, { color: t.text.muted }]}>
              +{diffInfo.additions}/-{diffInfo.deletions}
            </Text>
          ) : null}
          {isGate ? (
            <Text style={[styles.gateTag, { color: t.semantic.gateAmberText }]}>
              点击审批 ↗
            </Text>
          ) : failed ? (
            <Text style={[styles.rowFail, { color: t.semantic.dangerText }]}>失败</Text>
          ) : (
            <Text style={[styles.doneTag, { color: t.text.muted }]}>
              {tool.running ? 'running' : 'done'}
            </Text>
          )}
        </View>
      </Pressable>

      {expanded && diffInfo ? (
        <View style={styles.diffWrap}>
          <DiffView
            source={diffInfo.diff}
            file={diffInfo.file}
            limit={40}
            onQuote={onQuoteLine}
          />
        </View>
      ) : null}
      {expanded && !diffInfo && command ? (
        <Text style={[styles.code, { color: t.text.secondary }]}>{command}</Text>
      ) : null}
      {expanded && !diffInfo && output ? (
        <Text style={[styles.output, { color: t.text.secondary }]} numberOfLines={20}>
          {output}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  header: {
    minHeight: PILL_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 11,
    gap: 6,
  },
  spinner: { transform: [{ scale: 0.68 }], width: 14 },
  layerIcon: { fontSize: 13, fontFamily: MONO, fontWeight: '700' },
  label: { ...TYPE.pill, fontFamily: MONO, fontWeight: '600', flexShrink: 0 },
  meta: { ...TYPE.pill, fontFamily: MONO, flexShrink: 1 },
  tail: { flexDirection: 'row', alignItems: 'center', gap: 3, marginLeft: 'auto', paddingLeft: 4 },
  chevron: { ...TYPE.pill, fontFamily: MONO },
  body: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: 6,
    paddingHorizontal: 8,
    gap: 5,
  },
  rowCard: {
    // 同心圆角：嵌在 card(12) 的 body 里，body 内距 8 → 12 - 8 = 4。
    borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  row: { paddingVertical: 7, paddingHorizontal: 9 },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowSpinner: { transform: [{ scale: 0.65 }], width: 12 },
  statusMark: { fontFamily: MONO, fontSize: 11, fontWeight: '700', width: 12, textAlign: 'center' },
  rowName: { ...TYPE.pill, fontFamily: MONO, fontWeight: '700' },
  rowSummary: { ...TYPE.pill, fontFamily: MONO, flex: 1 },
  diffBadge: { ...TYPE.pill, fontFamily: MONO, fontVariant: ['tabular-nums'] },
  gateTag: { ...TYPE.pill, fontFamily: MONO, fontWeight: '700' },
  doneTag: { ...TYPE.pill, fontFamily: MONO, fontSize: 10 },
  rowFail: { ...TYPE.pill, fontFamily: MONO, fontWeight: '600' },
  diffWrap: { paddingHorizontal: 8, paddingBottom: 8 },
  code: { ...TYPE.mono, fontFamily: MONO, paddingHorizontal: 10, paddingBottom: 8 },
  output: { ...TYPE.mono, fontFamily: MONO, paddingHorizontal: 10, paddingBottom: 8, opacity: 0.9 },
});
