import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MOTION, TYPE } from '../../theme/tokens';
import { MONO, useTheme } from '../theme';

interface Props {
  /** 已经落地的动作，比如「已批准」「已拦截」 */
  label: string;
  /** 快照标识，例如 cp-8f91a */
  checkpointId?: string;
  onUndo: () => void;
  onExpire: () => void;
}

/**
 * 4.5 秒静默悔棋胶囊（§3.3 Grace Undo & Checkpoint Rewind）：
 * 拍板后不弹确认框，浮现一枚静默胶囊「已存快照 cp-8f91a · [撤回拍板 (4.0s)]」。
 * 倒计时归零才真正把决定发给网关，撤回就是取消这次发送。
 */
export function GraceUndo({ label, checkpointId, onUndo, onExpire }: Props) {
  const t = useTheme();
  const [left, setLeft] = useState<number>(MOTION.undoMs);
  const doneRef = useRef(false);

  useEffect(() => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const remain = Math.max(0, MOTION.undoMs - (Date.now() - startedAt));
      setLeft(remain);
      if (remain > 0) return;
      clearInterval(timer);
      if (doneRef.current) return;
      doneRef.current = true;
      onExpire();
    }, 200);
    return () => clearInterval(timer);
  }, [onExpire]);

  if (left <= 0) return null;

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View
        style={[
          styles.pill,
          { backgroundColor: t.bg.dockGlass, borderColor: t.border.default },
        ]}
      >
        <View style={styles.leftRow}>
          <View style={[styles.dot, { backgroundColor: t.semantic.gateAmberText }]} />
          <Text style={[styles.text, { color: t.text.primary }]} numberOfLines={1}>
            {label}
            {checkpointId ? ` · 快照 ${checkpointId}` : ''}
          </Text>
        </View>
        <Pressable
          hitSlop={10}
          style={[styles.undoBtn, { backgroundColor: t.action.primaryBg }]}
          onPress={() => {
            doneRef.current = true;
            onUndo();
          }}
        >
          <Text style={[styles.action, { color: t.action.primaryText }]}>
            撤回拍板 ({(left / 1000).toFixed(1)}s)
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 12,
    paddingBottom: 6,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  leftRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  text: { ...TYPE.pill, fontFamily: MONO, flex: 1 },
  undoBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  action: {
    ...TYPE.pill,
    fontFamily: MONO,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
});
