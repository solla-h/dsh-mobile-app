import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import type { TurnOutlineItem } from '../protocol/outline';
import { useThemedStyles } from './theme';
import type { Palette } from '../theme/tokens';

interface Props {
  visible: boolean;
  items: TurnOutlineItem[];
  onPick: (item: TurnOutlineItem) => void;
  onClose: () => void;
}

/** 轮次大纲：长会话里直接跳到某一轮，不用一屏一屏滑。 */
export function OutlineSheet({ visible, items, onPick, onClose }: Props) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => undefined}>
          <View style={styles.grabber} />
          <View style={styles.head}>
            <Text style={styles.title}>轮次 · {items.length}</Text>
            <Pressable hitSlop={10} style={styles.close} onPress={onClose}>
              <Text style={styles.closeText}>关闭</Text>
            </Pressable>
          </View>
          {items.length === 0 ? (
            <Text style={styles.empty}>这个会话还没有轮次大纲</Text>
          ) : (
            <FlatList
              data={items}
              keyExtractor={(item) => String(item.seq)}
              contentContainerStyle={styles.list}
              renderItem={({ item }) => (
                <Pressable style={styles.row} onPress={() => onPick(item)}>
                  <View style={styles.turnBadge}>
                    <Text style={styles.turnText}>{item.turn}</Text>
                  </View>
                  <View style={styles.rowBody}>
                    <Text style={styles.prompt} numberOfLines={2}>
                      {item.prompt || '（无提示词）'}
                    </Text>
                    {item.response ? (
                      <Text style={styles.response} numberOfLines={2}>
                        {item.response}
                      </Text>
                    ) : null}
                  </View>
                  <Text style={styles.go}>›</Text>
                </Pressable>
              )}
            />
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (t: Palette) =>
  StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: t.bg.canvas,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 16,
    paddingBottom: 24,
    maxHeight: '78%',
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: t.border.default,
    marginTop: 8,
    marginBottom: 12,
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  title: { color: t.text.primary, fontSize: 16, fontWeight: '700' },
  close: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: t.bg.surface },
  closeText: { color: t.text.secondary, fontSize: 12, fontWeight: '600' },
  empty: { color: t.text.muted, fontSize: 13, textAlign: 'center', paddingVertical: 28 },
  list: { paddingBottom: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.border.default,
  },
  turnBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: t.bg.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    marginTop: 1,
  },
  turnText: { color: t.text.muted, fontSize: 11, fontWeight: '700' },
  rowBody: { flex: 1 },
  prompt: { color: t.text.primary, fontSize: 14, lineHeight: 20 },
  response: { color: t.text.secondary, fontSize: 12, lineHeight: 17, marginTop: 3 },
  go: { color: t.text.muted, fontSize: 18, marginLeft: 6, marginTop: 2 },
});
