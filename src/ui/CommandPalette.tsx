import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { CommandGroup, CommandItem, CommandOption } from '../protocol/commands';

const KIND_BADGE: Record<string, string> = {
  immediate: '执行',
  input: '插入',
  select: '选择',
};

/** 输入框上方弹出的 / 目录。分组和条目完全按服务端下发的顺序渲染。 */
export function CommandPalette({
  groups,
  onPick,
}: {
  groups: CommandGroup[];
  onPick: (item: CommandItem) => void;
}) {
  if (groups.length === 0) return null;
  return (
    <View style={styles.panel}>
      <ScrollView keyboardShouldPersistTaps="always" style={styles.panelScroll}>
        {groups.map((group) => (
          <View key={group.id}>
            <Text style={styles.groupTitle}>{group.title}</Text>
            {group.items.map((item) => (
              <Pressable
                key={item.id}
                style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
                onPress={() => onPick(item)}
              >
                <View style={styles.rowMain}>
                  <Text style={styles.name} numberOfLines={1}>
                    /{item.name}
                  </Text>
                  {item.description ? (
                    <Text style={styles.desc} numberOfLines={1}>
                      {item.description}
                    </Text>
                  ) : null}
                </View>
                <Text style={styles.badge}>{KIND_BADGE[item.ui?.kind ?? ''] ?? '技能'}</Text>
              </Pressable>
            ))}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

/** ui.kind === 'select' 的通用二级菜单：模型、权限等共用同一套渲染。 */
export function CommandOptionsSheet({
  state,
  onClose,
  onPick,
}: {
  state: { command: string; options: CommandOption[]; loading: boolean } | null;
  onClose: () => void;
  onPick: (option: CommandOption) => void;
}) {
  return (
    <Modal visible={state !== null} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => undefined}>
          <Text style={styles.sheetTitle}>/{state?.command ?? ''}</Text>
          {state?.loading ? (
            <View style={styles.sheetLoading}>
              <ActivityIndicator color="#8A90A0" />
            </View>
          ) : state && state.options.length > 0 ? (
            <ScrollView style={styles.sheetScroll}>
              {state.options.map((option) => (
                <Pressable
                  key={option.id}
                  style={({ pressed }) => [styles.option, pressed ? styles.rowPressed : null]}
                  onPress={() => onPick(option)}
                >
                  <View style={styles.optionMain}>
                    <Text style={[styles.optionLabel, option.selected ? styles.optionLabelOn : null]}>
                      {option.label}
                    </Text>
                    {option.detail || option.description ? (
                      <Text style={styles.optionDetail} numberOfLines={2}>
                        {option.detail ?? option.description}
                      </Text>
                    ) : null}
                  </View>
                  {option.selected ? <Text style={styles.optionCheck}>✓</Text> : null}
                </Pressable>
              ))}
            </ScrollView>
          ) : (
            <Text style={styles.sheetEmpty}>没有可选项</Text>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  panel: {
    marginHorizontal: 10,
    marginBottom: 6,
    backgroundColor: '#14161B',
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#262A33',
    overflow: 'hidden',
  },
  panelScroll: { maxHeight: 232 },
  groupTitle: {
    color: '#5B6070',
    fontSize: 10,
    letterSpacing: 1,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  rowPressed: { backgroundColor: '#1B1E25' },
  rowMain: { flex: 1 },
  name: { color: '#EDEFF3', fontSize: 13.5, fontWeight: '600' },
  desc: { color: '#6E7585', fontSize: 11, marginTop: 2 },
  badge: { color: '#5B6070', fontSize: 10 },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
    padding: 14,
  },
  sheet: {
    backgroundColor: '#14161B',
    borderRadius: 16,
    paddingVertical: 8,
    maxHeight: '62%',
  },
  sheetTitle: {
    color: '#7A8091',
    fontSize: 12,
    fontWeight: '700',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  sheetScroll: { paddingBottom: 6 },
  sheetLoading: { paddingVertical: 28, alignItems: 'center' },
  sheetEmpty: { color: '#5B6070', fontSize: 13, padding: 20 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  optionMain: { flex: 1 },
  optionLabel: { color: '#D6DAE3', fontSize: 14.5 },
  optionLabelOn: { color: '#3DDC97', fontWeight: '700' },
  optionDetail: { color: '#6E7585', fontSize: 11.5, marginTop: 3, lineHeight: 16 },
  optionCheck: { color: '#3DDC97', fontSize: 14, fontWeight: '700' },
});
