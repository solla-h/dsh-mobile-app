import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { TYPE } from '../../theme/tokens';
import { MONO, useTheme } from '../theme';

interface Props {
  children: ReactNode;
  failed?: boolean;
  /** 是否显示卡片顶部的 DEEPSEEK FORMAL RESPONSE 微型题头（默认 true，还原设计稿质感） */
  showHeader?: boolean;
}

/**
 * Agent 正式回答主卡片：比画布微提亮 3%，带精致单色题头与焦段标签，形成自然视觉焦点（§2.1 Stage 03）。
 */
export function AnswerCard({ children, failed, showHeader = true }: Props) {
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
      {showHeader ? (
        <View style={[styles.header, { borderBottomColor: t.border.subtle }]}>
          <Text style={[styles.kicker, { color: t.text.secondary }]}>
            DEEPSEEK 正式回答 · FORMAL RESPONSE
          </Text>
          <View
            style={[
              styles.badge,
              { backgroundColor: t.bg.subtle, borderColor: t.border.subtle },
            ]}
          >
            <Text style={[styles.badgeText, { color: t.text.muted }]}>主视窗聚焦</Text>
          </View>
        </View>
      ) : null}
      <View style={styles.body}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 11,
    gap: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  kicker: {
    ...TYPE.mono,
    fontFamily: MONO,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 5,
    borderWidth: StyleSheet.hairlineWidth,
  },
  badgeText: {
    ...TYPE.mono,
    fontFamily: MONO,
    fontSize: 9.5,
  },
  body: {
    gap: 6,
  },
});
