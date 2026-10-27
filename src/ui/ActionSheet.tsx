import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

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

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#14161B',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingBottom: 24,
    paddingTop: 6,
  },
  header: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 10 },
  title: { color: '#EDEFF3', fontSize: 14, fontWeight: '600' },
  subtitle: { color: '#6E7585', fontSize: 12, marginTop: 4, lineHeight: 17 },
  row: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#22252D',
  },
  rowPressed: { backgroundColor: '#1B1E25' },
  rowDisabled: { opacity: 0.4 },
  rowText: { flexDirection: 'column' },
  label: { color: '#EDEFF3', fontSize: 15 },
  destructive: { color: '#FF7A7A' },
  hint: { color: '#6E7585', fontSize: 11, marginTop: 3 },
  cancel: { alignItems: 'center', marginTop: 6, borderTopWidth: 0 },
  cancelText: { color: '#8A90A0', fontSize: 15, fontWeight: '600' },
});
