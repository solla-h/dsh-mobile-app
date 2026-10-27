import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import type { TurnOutlineItem } from '../protocol/outline';

interface Props {
  visible: boolean;
  items: TurnOutlineItem[];
  onPick: (item: TurnOutlineItem) => void;
  onClose: () => void;
}

/** 轮次大纲：长会话里直接跳到某一轮，不用一屏一屏滑。 */
export function OutlineSheet({ visible, items, onPick, onClose }: Props) {
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

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#14161B',
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
    backgroundColor: '#2E323B',
    marginTop: 8,
    marginBottom: 12,
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  title: { color: '#F5F6F8', fontSize: 16, fontWeight: '700' },
  close: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: '#1B1E25' },
  closeText: { color: '#C9CDD6', fontSize: 12, fontWeight: '600' },
  empty: { color: '#5B6070', fontSize: 13, textAlign: 'center', paddingVertical: 28 },
  list: { paddingBottom: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#22252D',
  },
  turnBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#1B1E25',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    marginTop: 1,
  },
  turnText: { color: '#8A90A0', fontSize: 11, fontWeight: '700' },
  rowBody: { flex: 1 },
  prompt: { color: '#E6E8EE', fontSize: 14, lineHeight: 20 },
  response: { color: '#7E8698', fontSize: 12, lineHeight: 17, marginTop: 3 },
  go: { color: '#4A4F5C', fontSize: 18, marginLeft: 6, marginTop: 2 },
});
