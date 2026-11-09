import { StyleSheet } from 'react-native';

import type { Palette } from '../../theme/tokens';

/** 首页外壳：顶栏、连接状态、提示条。 */
export const makeAppStyles = (t: Palette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: t.bg.canvas },
    flex: { flex: 1 },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      paddingTop: 12,
      paddingBottom: 16,
    },
    headerTitleBlock: { flex: 1, paddingRight: 12 },
    title: { color: t.text.primary, fontSize: 28, fontWeight: '700', letterSpacing: 0.5 },
    titleCount: { color: t.text.muted, fontSize: 14, fontWeight: '600' },
    subtitle: { color: t.text.muted, fontSize: 13, marginTop: 2 },
    subtitleChevron: { color: t.text.muted },
    statusPill: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: t.bg.surface,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 999,
    },
    statusDot: { width: 7, height: 7, borderRadius: 4, marginRight: 6 },
    dotOn: { backgroundColor: t.semantic.diffAddText },
    dotBusy: { backgroundColor: t.semantic.gateAmberText },
    dotOff: { backgroundColor: t.text.muted },
    statusText: { color: t.text.secondary, fontSize: 12 },
    hint: { color: t.text.muted, fontSize: 13, paddingHorizontal: 20, paddingBottom: 8 },
    compatHint: {
      color: t.semantic.dangerText,
      fontSize: 13,
      paddingHorizontal: 20,
      paddingBottom: 8,
    },
    error: { color: t.semantic.dangerText, fontSize: 13, paddingHorizontal: 20, paddingBottom: 8 },
    gatePill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginHorizontal: 20,
      marginBottom: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: 12,
      backgroundColor: t.semantic.gateAmberBg,
    },
    gatePillText: { flex: 1, color: t.semantic.gateAmberText, fontSize: 13, fontWeight: '600' },
    gatePillGo: { color: t.semantic.gateAmberText, fontSize: 12, fontWeight: '700' },
    pendingDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: t.semantic.gateAmberText,
      marginRight: 6,
    },
  });

/**
 * 配对 / 重命名共用同一套弹窗外壳。
 * 两个弹窗的层级、输入框和操作按钮必须保持一致，样式集中在这里。
 */
export const makeModalStyles = (t: Palette) =>
  StyleSheet.create({
    modalBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.55)',
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 28,
    },
    modalCard: {
      width: '100%',
      backgroundColor: t.bg.canvas,
      borderRadius: 16,
      padding: 18,
      gap: 14,
    },
    modalTitle: { color: t.text.primary, fontSize: 16, fontWeight: '700' },
    modalInput: {
      backgroundColor: t.bg.surface,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      color: t.text.primary,
      fontSize: 15,
    },
    modalHint: { color: t.text.muted, fontSize: 12, lineHeight: 18, marginTop: -6 },
    modalInputTall: { minHeight: 76, textAlignVertical: 'top' },
    modalDisabled: { opacity: 0.4 },
    modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
    modalAction: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
    modalActionText: { color: t.text.muted, fontSize: 14, fontWeight: '600' },
    modalPrimaryText: { color: t.semantic.diffAddText, fontSize: 14, fontWeight: '700' },
  });
