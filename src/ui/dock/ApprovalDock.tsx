import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { MOTION, TYPE } from '../../theme/tokens';
import { chargeStartFeedback, successFeedback, tickFeedback } from '../haptics';
import { MONO, useTheme } from '../theme';

interface Props {
  /** 待批复的目标，比如 src/mcp/pool.rs */
  target: string;
  /** 一句话说明（为什么弹这个） */
  detail?: string;
  additions?: number;
  deletions?: number;
  highRisk?: boolean;
  riskLabels?: string[];
  busy?: boolean;
  trusted: boolean;
  onToggleTrust: () => void;
  onApprove: () => void;
  onReject: () => void;
  onExpand: () => void;
}

/**
 * 折叠态拇指坞（§2.3 / §3.2）：
 * 上面一行待批复状态条 + 信任目录胶囊，下面 2:3 双按钮。
 * 高危操作把「快速批准」换成按住 0.5s 充能放行，带实时百分比进度与渐强脉冲震动。
 */
export function ApprovalDock({
  target,
  detail,
  additions,
  deletions,
  highRisk,
  riskLabels,
  busy,
  trusted,
  onToggleTrust,
  onApprove,
  onReject,
  onExpand,
}: Props) {
  const t = useTheme();
  const [fill] = useState(() => new Animated.Value(0));
  const [pct, setPct] = useState(0);
  const firedRef = useRef(false);
  const pulseTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const id = fill.addListener(({ value }) => {
      setPct(Math.round(value * 100));
    });
    return () => {
      fill.removeListener(id);
      if (pulseTimerRef.current) clearInterval(pulseTimerRef.current);
    };
  }, [fill]);

  const clearPulse = () => {
    if (pulseTimerRef.current) {
      clearInterval(pulseTimerRef.current);
      pulseTimerRef.current = null;
    }
  };

  const startHold = () => {
    if (busy) return;
    firedRef.current = false;
    chargeStartFeedback();
    clearPulse();
    pulseTimerRef.current = setInterval(() => {
      tickFeedback();
    }, 100);
    Animated.timing(fill, {
      toValue: 1,
      duration: MOTION.holdMs,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start(({ finished }) => {
      clearPulse();
      if (!finished || firedRef.current) return;
      firedRef.current = true;
      successFeedback();
      fill.setValue(0);
      setPct(0);
      onApprove();
    });
  };

  const cancelHold = () => {
    clearPulse();
    if (firedRef.current) return;
    Animated.timing(fill, {
      toValue: 0,
      duration: MOTION.holdReleaseMs,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start();
  };

  const width = fill.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });

  return (
    <View
      style={[
        styles.dock,
        { backgroundColor: t.bg.dockGlass, borderTopColor: t.border.default },
      ]}
    >
      <View style={styles.gateRow}>
        <Pressable
          style={[styles.gate, { backgroundColor: t.bg.surface, borderColor: t.border.default }]}
          onPress={onExpand}
          accessibilityRole="button"
          accessibilityLabel="放大查看审批详情"
        >
          <View
            style={[
              styles.gateDot,
              { backgroundColor: highRisk ? t.semantic.dangerText : t.semantic.gateAmberText },
            ]}
          />
          <Text style={[styles.gateText, { color: t.text.primary }]} numberOfLines={1}>
            {highRisk ? '高危命令: ' : '待批复: '}
            {target}
            {additions !== undefined ? ` (+${additions}/-${deletions ?? 0})` : ''}
          </Text>
          <Text style={[styles.gateMore, { color: t.text.secondary }]}>点开放大 ↗</Text>
        </Pressable>
        <Pressable
          style={[
            styles.trust,
            {
              backgroundColor: trusted ? t.action.primaryBg : t.bg.surface,
              borderColor: t.border.default,
            },
          ]}
          onPress={onToggleTrust}
          accessibilityRole="switch"
          accessibilityState={{ checked: trusted }}
        >
          <Text
            style={[
              styles.trustText,
              { color: trusted ? t.action.primaryText : t.text.secondary },
            ]}
          >
            {trusted ? '✓ 信任目录' : '信任目录'}
          </Text>
        </Pressable>
      </View>

      {detail ? (
        <Text style={[styles.detail, { color: t.text.secondary }]} numberOfLines={2}>
          {detail}
        </Text>
      ) : null}

      <View style={styles.actions}>
        <Pressable
          style={({ pressed }) => [
            styles.reject,
            { backgroundColor: t.action.secondaryBg, borderColor: t.border.default },
            pressed ? styles.pressed : null,
          ]}
          onPress={onReject}
          disabled={busy}
        >
          <Text style={[styles.rejectText, { color: t.text.primary }]}>× 拦截</Text>
        </Pressable>

        {highRisk ? (
          <Pressable
            style={[styles.approve, { backgroundColor: t.action.primaryBg }]}
            onPressIn={startHold}
            onPressOut={cancelHold}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="长按半秒放行高危命令"
          >
            <Animated.View
              style={[
                styles.holdFill,
                { width, backgroundColor: t.semantic.gateAmberText, opacity: 0.45 },
              ]}
            />
            <Text style={[styles.approveText, { color: t.action.primaryText }]}>
              {busy
                ? '处理中…'
                : pct > 0
                  ? `长按确认中 ${pct}%`
                  : `长按 0.5s 放行${riskLabels?.length ? ' · ' + riskLabels[0] : '高危命令'}`}
            </Text>
          </Pressable>
        ) : (
          <Pressable
            style={({ pressed }) => [
              styles.approve,
              { backgroundColor: t.action.primaryBg },
              pressed ? styles.pressed : null,
            ]}
            onPress={onApprove}
            disabled={busy}
          >
            <Text style={[styles.approveText, { color: t.action.primaryText }]}>
              {busy
                ? '处理中…'
                : `✓ 快速批准${additions !== undefined ? ` (+${additions}/-${deletions ?? 0})` : ''}`}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 6,
    gap: 6,
  },
  gateRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  gate: {
    flex: 1,
    minHeight: 34,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    gap: 6,
  },
  gateDot: { width: 8, height: 8, borderRadius: 4 },
  gateText: { ...TYPE.pill, fontFamily: MONO, fontWeight: '600', flex: 1 },
  gateMore: { ...TYPE.pill, fontFamily: MONO },
  trust: {
    minHeight: 34,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trustText: { ...TYPE.pill, fontFamily: MONO, fontWeight: '600' },
  detail: { ...TYPE.caption, paddingHorizontal: 2 },
  actions: { flexDirection: 'row', gap: 8 },
  reject: {
    flex: 2,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rejectText: { ...TYPE.body, fontWeight: '600' },
  approve: {
    flex: 3,
    minHeight: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  holdFill: { position: 'absolute', left: 0, top: 0, bottom: 0 },
  approveText: { ...TYPE.body, fontWeight: '600', fontVariant: ['tabular-nums'] },
  pressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
});
