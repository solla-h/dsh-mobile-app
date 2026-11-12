import { useEffect, useRef, useState } from 'react';
import { LayoutAnimation, Platform, Pressable, StyleSheet, Text, UIManager, View } from 'react-native';

import { softFeedback, tapFeedback } from '../haptics';
import { useTheme } from '../theme';
import { ThinkPill } from './ThinkPill';
import { ToolGroup } from './ToolGroup';
import { activitySummary, type ActivityStep } from './group';
import { tr } from '../../i18n';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface Props {
  steps: ActivityStep[];
  pendingCallId?: string;
  onOpenGate?: () => void;
  onQuoteLine?: Parameters<typeof ToolGroup>[0]['onQuoteLine'];
  /** 只有「实时一轮由展开变胶囊」才播收拢动画和触感，历史挂载不播。 */
  animateIn?: boolean;
}

/**
 * 一轮里的「思考 + 工具调用」收拢胶囊。
 *
 * 只在同一轮已经出现正式回答后才生成（见 group.ts），所以默认折叠：
 * 一个胶囊替代原来 N 个思考胶囊 + M 个工具组，用户和回答之间不再隔几屏。
 * 点按可展开复看每一步；展开后仍是原来的 ThinkPill / ToolGroup 组件。
 */
export function ActivityGroup({ steps, pendingCallId, onOpenGate, onQuoteLine, animateIn }: Props) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const mountedRef = useRef(false);

  // 首次挂载（正文刚开始输出时由展开态变成胶囊）只做一次柔触反馈：
  // 收拢动画由父组件在引起折叠的提交**之前**上膛（armCollapseAnimation），
  // 在这里 configure 已经是提交之后，落不到这次折叠上（真机瞬切的根因之一）。
  // 触感只在 animateIn 时播：冷启动读历史、loadOlder、FlatList 虚拟化重新挂载
  // 都会触发 mount，无条件播的话历史里每个胶囊都震一下，串成一串。
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      if (!animateIn) return;
      softFeedback();
    }
  }, [animateIn]);

  const { label, failed } = activitySummary(steps);

  const toggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    tapFeedback();
    setOpen(!open);
  };

  return (
    <View style={styles.root}>
      <Pressable
        style={[styles.pill, { backgroundColor: t.bg.subtle, borderColor: t.border.subtle }]}
        onPress={toggle}
        hitSlop={4}
        accessibilityRole="button"
        accessibilityLabel={open ? tr("收起思考与工具调用") : tr("展开思考与工具调用")}
      >
        <Text style={[styles.sparkle, { color: t.text.muted }]}>✦</Text>
        {failed > 0 ? (
          <View style={[styles.failDot, { backgroundColor: t.semantic.dangerText }]} />
        ) : null}
        <Text style={[styles.label, { color: t.text.primary }]} numberOfLines={1}>
          {label}
        </Text>
        <View style={styles.tail}>
          <Text style={[styles.meta, { color: t.text.muted }]}>{open ? tr("收起") : tr("展开")}</Text>
          <Text style={[styles.chevron, { color: t.text.muted }]}>{open ? '⌃' : '⌄'}</Text>
        </View>
      </Pressable>
      {open ? (
        <View style={styles.steps}>
          {steps.map((step, index) =>
            step.kind === 'message' && step.message.kind === 'assistant' ? (
              <ThinkPill
                key={step.id}
                text={step.message.reasoning ?? ''}
                streaming={false}
                answerStarted
                startedAt={step.message.time}
              />
            ) : step.kind === 'tools' ? (
              <View key={step.id} style={styles.toolWrap}>
                <ToolGroup
                  tools={step.tools}
                  defaultOpen
                  pendingCallId={pendingCallId}
                  onOpenGate={onOpenGate}
                  onQuoteLine={onQuoteLine}
                />
              </View>
            ) : null,
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { marginVertical: 2 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 17,
    paddingHorizontal: 10,
    height: 34,
  },
  sparkle: { fontSize: 12 },
  failDot: { width: 6, height: 6, borderRadius: 3 },
  label: { fontSize: 11.5, fontWeight: '600', flexShrink: 1 },
  meta: { fontSize: 10.5, fontVariant: ['tabular-nums'] },
  tail: { flexDirection: 'row', alignItems: 'center', gap: 2, marginLeft: 'auto' },
  chevron: { fontSize: 11 },
  steps: { gap: 6, marginTop: 6, paddingLeft: 2 },
  toolWrap: { marginTop: 2 },
});
