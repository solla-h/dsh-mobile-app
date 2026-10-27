import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '../theme';

/** Agent 正式回答主卡片：比画布微提亮 3%，形成自然视觉焦点（§2.1 Stage 03）。 */
export function AnswerCard({ children, failed }: { children: ReactNode; failed?: boolean }) {
  const t = useTheme();
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: t.bg.elevatedAnswer,
          borderColor: failed ? t.semantic.dangerText : t.border.default,
        },
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 6,
  },
});
