import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useThemedStyles } from '../theme';
import type { Palette } from '../../theme/tokens';

/**
 * 首页底部 Tab。只在没有选中会话时渲染——进了会话页，审批坞和输入框才是主角，
 * 这条东西留着只会抢屏幕。
 */
export interface HomeTab {
  key: string;
  label: string;
  /** 右下角的小数字，用来提示「有 N 个在等你」 */
  badge?: number;
}

interface Props {
  tabs: HomeTab[];
  active: string;
  onChange: (key: string) => void;
}

export function BottomTabBar({ tabs, active, onChange }: Props) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.bar}>
      {tabs.map((tab) => {
        const selected = tab.key === active;
        return (
          <Pressable
            key={tab.key}
            style={styles.cell}
            onPress={() => onChange(tab.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
          >
            <View style={styles.labelRow}>
              <Text
                style={[styles.label, selected && styles.labelOn]}
                maxFontSizeMultiplier={1.3}
                numberOfLines={1}
              >
                {tab.label}
              </Text>
              {tab.badge ? (
                <Text style={styles.badge} maxFontSizeMultiplier={1.2}>
                  {tab.badge}
                </Text>
              ) : null}
            </View>
            <View style={[styles.underline, selected && styles.underlineOn]} />
          </Pressable>
        );
      })}
    </View>
  );
}

const makeStyles = (t: Palette) =>
  StyleSheet.create({
    bar: {
      height: 56,
      flexDirection: 'row',
      backgroundColor: t.bg.dockGlass,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.border.default,
    },
    cell: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
    },
    labelRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
    label: { color: t.text.muted, fontSize: 13, fontWeight: '600', letterSpacing: 0.2 },
    labelOn: { color: t.text.primary },
    badge: { color: t.semantic.gateAmberText, fontSize: 11, fontWeight: '700' },
    underline: {
      width: 16,
      height: 2,
      borderRadius: 1,
      backgroundColor: 'transparent',
    },
    underlineOn: { backgroundColor: t.text.primary },
  });
