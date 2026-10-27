import { Pressable, StyleSheet, Text, View } from 'react-native';
import { TYPE } from '../../theme/tokens';
import { MONO, useTheme } from '../theme';

/**
 * 屏幕最顶端的 2px 上下文水位线（§3.5）。
 * 只映射 Context Window 占用比例，不占正文排版高度。
 */
export function ContextHairline({ ratio }: { ratio: number }) {
  const t = useTheme();
  const width = `${Math.max(0, Math.min(1, ratio)) * 100}%` as const;
  return (
    <View style={[styles.hairline, { backgroundColor: t.border.subtle }]}>
      <View style={[styles.fill, { width, backgroundColor: t.text.muted }]} />
    </View>
  );
}

interface PillProps {
  /** 例如 "2 GATE · 14.2k" / "R1 THINKING" */
  text: string;
  tone?: 'idle' | 'busy' | 'gate';
  onPress?: () => void;
}

/** 顶栏灵动胶囊：全局待办状态，点一下跳回首个阻塞会话。 */
export function StatusPill({ text, tone = 'idle', onPress }: PillProps) {
  const t = useTheme();
  const dot =
    tone === 'gate'
      ? t.semantic.gateAmberText
      : tone === 'busy'
        ? t.text.primary
        : t.text.muted;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      hitSlop={8}
      style={[styles.pill, { backgroundColor: t.bg.subtle, borderColor: t.border.subtle }]}
      accessibilityRole="button"
      accessibilityLabel={text}
    >
      <View style={[styles.pillDot, { backgroundColor: dot }]} />
      <Text style={[styles.pillText, { color: t.text.secondary }]} numberOfLines={1}>
        {text}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hairline: { height: 2, width: '100%' },
  fill: { height: 2 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pillDot: { width: 5, height: 5, borderRadius: 2.5 },
  pillText: { ...TYPE.mono, fontFamily: MONO },
});
