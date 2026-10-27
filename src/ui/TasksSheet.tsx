import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { describePhase, type GoalInfo, type TodoItem } from '../protocol/tasks';
import { useThemedStyles } from './theme';
import type { Palette } from '../theme/tokens';

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
  const styles = useThemedStyles(makeStyles);
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

const makeStyles = (t: Palette) =>
  StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
    padding: 14,
  },
  sheet: {
    backgroundColor: t.bg.canvas,
    borderRadius: 16,
    paddingTop: 14,
    paddingBottom: 8,
    maxHeight: '70%',
  },
  title: { color: t.text.primary, fontSize: 15, fontWeight: '700', paddingHorizontal: 16, paddingBottom: 10 },
  goalCard: {
    marginHorizontal: 14,
    marginBottom: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: t.bg.canvas,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.action.primaryBg,
  },
  goalHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  goalTag: {
    color: t.text.primary,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: t.bg.surface,
  },
  goalPhase: { color: t.text.muted, fontSize: 11 },
  goalText: { color: t.text.primary, fontSize: 13.5, lineHeight: 19, marginTop: 8 },
  goalMeta: { color: t.text.muted, fontSize: 11, marginTop: 6 },
  goalActions: { flexDirection: 'row', gap: 10, marginTop: 10 },
  goalAction: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: t.bg.surface,
  },
  goalActionText: { color: t.text.secondary, fontSize: 12, fontWeight: '600' },
  danger: { color: t.semantic.dangerText },
  list: { maxHeight: 380 },
  listContent: { paddingHorizontal: 16, paddingBottom: 10 },
  row: { flexDirection: 'row', gap: 10, paddingVertical: 7 },
  mark: { width: 16, color: t.text.muted, fontSize: 13, lineHeight: 20 },
  markDone: { color: t.semantic.diffAddText },
  markActive: { color: t.semantic.gateAmberText },
  text: { flex: 1, color: t.text.primary, fontSize: 13.5, lineHeight: 20 },
  textDone: { color: t.text.muted, textDecorationLine: 'line-through' },
  empty: { color: t.text.muted, fontSize: 13, paddingVertical: 16 },
});
