import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useThemedStyles } from './theme';
import type { Palette } from '../theme/tokens';

/**
 * 通用底部操作表。Android 没有 ActionSheetIOS，自己画一个，
 * 顺便让长按菜单、会话菜单、设置项复用同一套视觉。
 */
export interface SheetAction {
  id: string;
  label: string;
  /** 副标题，用来解释这一项到底做了什么 */
  hint?: string;
  destructive?: boolean;
  disabled?: boolean;
}

interface Props {
  visible: boolean;
  title?: string;
  subtitle?: string;
  actions: SheetAction[];
  onPick: (id: string) => void;
  onClose: () => void;
}

export function ActionSheet({ visible, title, subtitle, actions, onPick, onClose }: Props) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        {/* 阻止点击穿透到遮罩 */}
        <Pressable style={styles.sheet} onPress={() => undefined}>
          {title ? (
            <View style={styles.header}>
              <Text style={styles.title} numberOfLines={2}>
                {title}
              </Text>
              {subtitle ? (
                <Text style={styles.subtitle} numberOfLines={2}>
                  {subtitle}
                </Text>
              ) : null}
            </View>
          ) : null}
          {actions.map((action) => (
            <Pressable
              key={action.id}
              style={({ pressed }) => [
                styles.row,
                pressed && !action.disabled ? styles.rowPressed : null,
                action.disabled ? styles.rowDisabled : null,
              ]}
              disabled={action.disabled}
              onPress={() => onPick(action.id)}
            >
              <View style={styles.rowText}>
                <Text style={[styles.label, action.destructive ? styles.destructive : null]}>
                  {action.label}
                </Text>
                {action.hint ? <Text style={styles.hint}>{action.hint}</Text> : null}
              </View>
            </Pressable>
          ))}
          <Pressable style={[styles.row, styles.cancel]} onPress={onClose}>
            <Text style={styles.cancelText}>取消</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (t: Palette) =>
  StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: t.bg.canvas,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingBottom: 24,
    paddingTop: 6,
  },
  header: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 10 },
  title: { color: t.text.primary, fontSize: 14, fontWeight: '600' },
  subtitle: { color: t.text.muted, fontSize: 12, marginTop: 4, lineHeight: 17 },
  row: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: t.border.default,
  },
  rowPressed: { backgroundColor: t.bg.surface },
  rowDisabled: { opacity: 0.4 },
  rowText: { flexDirection: 'column' },
  label: { color: t.text.primary, fontSize: 15 },
  destructive: { color: t.semantic.dangerText },
  hint: { color: t.text.muted, fontSize: 11, marginTop: 3 },
  cancel: { alignItems: 'center', marginTop: 6, borderTopWidth: 0 },
  cancelText: { color: t.text.muted, fontSize: 15, fontWeight: '600' },
});
