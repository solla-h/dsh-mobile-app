import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';

import { tapFeedback } from './haptics';
import { useTheme, useThemedStyles } from './theme';
import type { Palette } from '../theme/tokens';

/**
 * 专门的文本选择页：消息正文默认长按是操作菜单（复制/分叉/删除），
 * 两者抢长按手势会打架；进这里之后整个正文变成系统可选文本，
 * 用户自由拖动选择手柄复制任意片段，顶部还有一键复制全文。
 */

interface Props {
  visible: boolean;
  title: string;
  text: string;
  onClose: () => void;
}

export function TextSelectionSheet({ visible, title, text, onClose }: Props) {
  const styles = useThemedStyles(makeStyles);
  const t = useTheme();

  const copyAll = () => {
    tapFeedback();
    void Clipboard.setStringAsync(text).catch(() => undefined);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => undefined}>
          <View style={styles.head}>
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
            <Pressable hitSlop={10} onPress={onClose}>
              <Text style={styles.close}>×</Text>
            </Pressable>
          </View>
          <Text style={styles.hint}>长按正文拖动选择手柄，可复制任意片段</Text>
          <ScrollView style={styles.bodyBox} nestedScrollEnabled>
            <Text style={styles.body} selectable>
              {text}
            </Text>
          </ScrollView>
          <Pressable style={styles.copyAll} onPress={copyAll}>
            <Text style={styles.copyAllText}>复制全文</Text>
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
      backgroundColor: 'rgba(20, 20, 18, 0.55)',
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: t.bg.elevatedAnswer,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      paddingHorizontal: 16,
      paddingTop: 14,
      paddingBottom: 24,
      maxHeight: '88%',
      minHeight: '50%',
    },
    head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    title: { flex: 1, color: t.text.primary, fontSize: 15, fontWeight: '700' },
    close: { color: t.text.muted, fontSize: 22, paddingHorizontal: 4 },
    hint: { color: t.text.muted, fontSize: 10.5, marginTop: 4, marginBottom: 8 },
    bodyBox: { flex: 1, backgroundColor: t.bg.subtle, borderRadius: 10, padding: 10 },
    body: { color: t.text.primary, fontSize: 13, lineHeight: 19 },
    copyAll: {
      marginTop: 10,
      alignSelf: 'flex-end',
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 8,
      backgroundColor: t.action.primaryBg,
    },
    copyAllText: { color: t.action.primaryText, fontSize: 12.5, fontWeight: '700' },
  });
