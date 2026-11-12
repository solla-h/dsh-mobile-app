import { Modal, Pressable, Text, TextInput, View } from 'react-native';

import { useTheme, useThemedStyles } from '../theme';
import { makeModalStyles } from './appStyles';
import { tr } from '../../i18n';

interface Props {
  visible: boolean;
  value: string;
  onChangeValue: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}

/** 重命名会话：输入框与保存/取消动作都收在这里。 */
export function RenameSessionModal({
  visible,
  value,
  onChangeValue,
  onClose,
  onSubmit,
}: Props) {
  const t = useTheme();
  const styles = useThemedStyles(makeModalStyles);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable style={styles.modalCard} onPress={() => undefined}>
          <Text style={styles.modalTitle}>{tr("重命名会话")}</Text>
          <TextInput
            testID="session-rename-input"
            accessibilityLabel={tr("会话名称")}
            style={styles.modalInput}
            value={value}
            onChangeText={onChangeValue}
            placeholder={tr("会话名称")}
            placeholderTextColor={t.text.muted}
            autoFocus
            maxLength={80}
            onSubmitEditing={onSubmit}
            returnKeyType="done"
          />
          <View style={styles.modalActions}>
            <Pressable
              testID="session-rename-cancel"
              accessibilityRole="button"
              accessibilityLabel={tr("取消")}
              style={styles.modalAction}
              onPress={onClose}
            >
              <Text style={styles.modalActionText}>{tr("取消")}</Text>
            </Pressable>
            <Pressable
              testID="session-rename-save"
              accessibilityRole="button"
              accessibilityLabel={tr("保存")}
              style={styles.modalAction}
              onPress={onSubmit}
            >
              <Text style={styles.modalPrimaryText}>{tr("保存")}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
