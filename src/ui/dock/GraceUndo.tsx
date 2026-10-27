import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MOTION, TYPE } from '../../theme/tokens';
import { MONO, useTheme } from '../theme';

interface Props {
  /** 已经落地的动作，比如「已批准」「已拦截」 */
  label: string;
  onUndo: () => void;
  onExpire: () => void;
}

/**
 * 4.5 秒静默悔棋胶囊（§3.3）：拍板后不弹确认框，只给一条可撤回的提示。
 * 倒计时归零才真正把决定发给网关，撤回就是取消这次发送。
 */
export function GraceUndo({ label, onUndo, onExpire }: Props) {
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
    }, 250);
    return () => clearInterval(timer);
  }, [onExpire]);

  if (left <= 0) return null;

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={[styles.pill, { backgroundColor: t.bg.dockGlass, borderColor: t.border.default }]}>
        <Text style={[styles.text, { color: t.text.muted }]}>{label}</Text>
        <Pressable
          hitSlop={8}
          onPress={() => {
            doneRef.current = true;
            onUndo();
          }}
        >
          <Text style={[styles.action, { color: t.text.primary }]}>
            撤回拍板 ({(left / 1000).toFixed(1)}s)
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 8, alignItems: 'center' },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  text: { ...TYPE.pill, fontFamily: MONO },
  action: { ...TYPE.pill, fontFamily: MONO, fontWeight: '600' },
});
