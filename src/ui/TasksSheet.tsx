import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { describePhase, type GoalInfo, type TodoItem } from '../protocol/tasks';

const STATUS_MARK: Record<string, string> = {
  completed: '✓',
  in_progress: '◐',
  pending: '○',
};

/** 任务列表 + 当前目标。只读展示，目标允许暂停/继续/清除。 */
export function TasksSheet({
  visible,
  todos,
  goal,
  onClose,
  onPause,
  onResume,
  onClear,
}: {
  visible: boolean;
  todos: TodoItem[] | null;
  goal: GoalInfo | null;
  onClose: () => void;
  onPause: () => void;
  onResume: () => void;
  onClear: () => void;
}) {
  const done = todos?.filter((item) => item.status === 'completed').length ?? 0;
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => undefined}>
          <Text style={styles.title}>
            任务{todos && todos.length ? ` · ${done}/${todos.length}` : ''}
          </Text>

          {goal ? (
            <View style={styles.goalCard}>
              <View style={styles.goalHeader}>
                <Text style={styles.goalTag}>目标</Text>
                <Text style={styles.goalPhase}>{describePhase(goal.phase)}</Text>
              </View>
              <Text style={styles.goalText}>{goal.objective}</Text>
              {goal.roundsStarted !== undefined || goal.maxGoalRounds !== undefined ? (
                <Text style={styles.goalMeta}>
                  轮次 {goal.roundsStarted ?? 0}
                  {goal.maxGoalRounds ? ' / ' + goal.maxGoalRounds : ''}
                </Text>
              ) : null}
              <View style={styles.goalActions}>
                {goal.phase === 'paused' || goal.phase === 'blocked' ? (
                  <Pressable style={styles.goalAction} onPress={onResume}>
                    <Text style={styles.goalActionText}>继续</Text>
                  </Pressable>
                ) : (
                  <Pressable style={styles.goalAction} onPress={onPause}>
                    <Text style={styles.goalActionText}>暂停</Text>
                  </Pressable>
                )}
                <Pressable style={styles.goalAction} onPress={onClear}>
                  <Text style={[styles.goalActionText, styles.danger]}>清除</Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {todos && todos.length ? (
              todos.map((item, index) => (
                <View key={index} style={styles.row}>
                  <Text
                    style={[
                      styles.mark,
                      item.status === 'completed' ? styles.markDone : null,
                      item.status === 'in_progress' ? styles.markActive : null,
                    ]}
                  >
                    {STATUS_MARK[item.status] ?? '○'}
                  </Text>
                  <Text
                    style={[styles.text, item.status === 'completed' ? styles.textDone : null]}
                  >
                    {item.content}
                  </Text>
                </View>
              ))
            ) : (
              <Text style={styles.empty}>
                {todos === null ? '这个会话还没有任务列表' : '任务列表是空的'}
              </Text>
            )}
          </ScrollView>
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
    padding: 14,
  },
  sheet: {
    backgroundColor: '#14161B',
    borderRadius: 16,
    paddingTop: 14,
    paddingBottom: 8,
    maxHeight: '70%',
  },
  title: { color: '#F5F6F8', fontSize: 15, fontWeight: '700', paddingHorizontal: 16, paddingBottom: 10 },
  goalCard: {
    marginHorizontal: 14,
    marginBottom: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#12161F',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#22304A',
  },
  goalHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  goalTag: {
    color: '#8FB6FF',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: '#1A2233',
  },
  goalPhase: { color: '#7A8091', fontSize: 11 },
  goalText: { color: '#EDEFF3', fontSize: 13.5, lineHeight: 19, marginTop: 8 },
  goalMeta: { color: '#5B6070', fontSize: 11, marginTop: 6 },
  goalActions: { flexDirection: 'row', gap: 10, marginTop: 10 },
  goalAction: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#1B1E25',
  },
  goalActionText: { color: '#C9CDD6', fontSize: 12, fontWeight: '600' },
  danger: { color: '#FF7A7A' },
  list: { maxHeight: 380 },
  listContent: { paddingHorizontal: 16, paddingBottom: 10 },
  row: { flexDirection: 'row', gap: 10, paddingVertical: 7 },
  mark: { width: 16, color: '#4C5261', fontSize: 13, lineHeight: 20 },
  markDone: { color: '#3DDC97' },
  markActive: { color: '#F5B84C' },
  text: { flex: 1, color: '#D6DAE3', fontSize: 13.5, lineHeight: 20 },
  textDone: { color: '#5B6070', textDecorationLine: 'line-through' },
  empty: { color: '#5B6070', fontSize: 13, paddingVertical: 16 },
});
