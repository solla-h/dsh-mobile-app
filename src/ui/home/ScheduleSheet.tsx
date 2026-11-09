import { useCallback, useEffect, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  mapScheduleDelete,
  mapScheduleHistory,
  mapScheduleUpdate,
  type ScheduleHistoryItem,
} from '../../protocol/schedules';
import { tapFeedback } from '../haptics';
import { useTheme, useThemedStyles } from '../theme';
import type { Palette } from '../../theme/tokens';
import type { GatewayClient } from '../../transport/gateway-client';

/**
 * 定时任务详情抽屉：改标题、删除、看投递历史。
 *
 * 协议约束：
 * - 走 control 连接；
 * - update 的 expected 必须原样带目录里的完整记录（网关会剥元数据），只改 title；
 * - 删除会移除投递记录但不会撤回已入队消息；
 * - 没有创建接口（新任务由 Agent 的 schedule_create 工具创建）。
 */

interface Props {
  client: GatewayClient;
  /** schedule-catalog 里的原始条目（含原 sessionId/status 元数据） */
  item: Record<string, unknown>;
  onClose: () => void;
  /** 更新/删除成功后让上层重查目录 */
  onChanged: () => void;
}

function pickText(item: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

export function ScheduleSheet({ client, item, onClose, onChanged }: Props) {
  const styles = useThemedStyles(makeStyles);
  const t = useTheme();
  const id = typeof item.id === 'string' ? item.id : '';
  const sessionId = typeof item.sessionId === 'string' ? item.sessionId : '';
  const initialTitle = pickText(item, ['title', 'name']) ?? pickText(item, ['prompt']) ?? id;
  const prompt = pickText(item, ['prompt']);
  const status = pickText(item, ['status', 'state']);
  const scheduleText = pickText(item, ['cron', 'expression', 'human', 'description']);

  const [title, setTitle] = useState(initialTitle);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [history, setHistory] = useState<ScheduleHistoryItem[] | null>(null);

  useEffect(() => {
    const off = client.onFrame((frame) => {
      const kind = (frame as { kind?: string }).kind;
      if (kind === 'schedule-update') {
        const result = mapScheduleUpdate(frame);
        setBusy(false);
        if (!result) return;
        if (result.updated) {
          tapFeedback();
          setNotice('已保存');
          onChanged();
        } else {
          setNotice('保存失败：' + (result.code ?? '任务可能已被修改或结束'));
          onChanged();
        }
      } else if (kind === 'schedule-delete') {
        const result = mapScheduleDelete(frame);
        setBusy(false);
        if (!result) return;
        if (result.deleted) {
          tapFeedback();
          onClose();
          onChanged();
        } else {
          setNotice('删除失败：' + (result.code ?? '任务未找到'));
          onChanged();
        }
      } else if (kind === 'schedule-history') {
        const result = mapScheduleHistory(frame);
        setBusy(false);
        if (result) {
          setHistory(result.records);
          if (result.code) setNotice('历史读取异常：' + result.code);
        }
      } else if (kind === 'error') {
        setBusy(false);
        const frameRecord = frame as { requestType?: string; message?: string };
        if (frameRecord.requestType?.startsWith('schedule-')) {
          setNotice(frameRecord.message ?? '操作失败');
        }
      }
    });
    return off;
  }, [client, onChanged, onClose]);

  const saveTitle = useCallback(() => {
    if (!sessionId || !id) return;
    const next = title.trim();
    if (!next || next === initialTitle) {
      onClose();
      return;
    }
    setBusy(true);
    setNotice(null);
    client.send({
      type: 'schedule-update',
      sessionId,
      id,
      expected: item,
      title: next,
    });
  }, [client, id, initialTitle, item, onClose, sessionId, title]);

  const remove = useCallback(() => {
    if (!sessionId || !id) return;
    Alert.alert(
      '删除定时任务',
      '删除后这条任务的投递记录也会移除（已入队的消息不会撤回）。确定？',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: () => {
            setBusy(true);
            setNotice(null);
            client.send({ type: 'schedule-delete', sessionId, id });
          },
        },
      ],
      { cancelable: true },
    );
  }, [client, id, sessionId]);

  const loadHistory = useCallback(() => {
    if (!sessionId || !id) return;
    setBusy(true);
    setNotice(null);
    client.send({ type: 'schedule-history', sessionId, id, limit: 20 });
  }, [client, id, sessionId]);

  const editable = Boolean(sessionId && id);

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => undefined}>
          <View style={styles.titleRow}>
            <Text style={styles.title} numberOfLines={2} maxFontSizeMultiplier={1.3}>
              {initialTitle}
            </Text>
            <Pressable hitSlop={10} onPress={onClose}>
              <Text style={styles.close}>×</Text>
            </Pressable>
          </View>
          <Text style={styles.meta} numberOfLines={1}>
            {[id, status].filter(Boolean).join(' · ')}
          </Text>
          {scheduleText ? <Text style={styles.meta}>{scheduleText}</Text> : null}
          {prompt ? (
            <ScrollView style={styles.promptBox} nestedScrollEnabled>
              <Text style={styles.promptText}>{prompt}</Text>
            </ScrollView>
          ) : null}

          {notice ? <Text style={styles.notice}>{notice}</Text> : null}

          {editable ? (
            <>
              <Text style={styles.section}>改标题</Text>
              <TextInput
                style={styles.input}
                value={title}
                onChangeText={setTitle}
                placeholder="任务标题"
                placeholderTextColor={t.text.muted}
                editable={!busy}
              />
              <View style={styles.actionsRow}>
                <Pressable
                  style={[styles.button, styles.buttonPrimary, busy && styles.buttonDisabled]}
                  disabled={busy}
                  onPress={saveTitle}
                >
                  <Text style={styles.buttonTextPrimary}>{busy ? '处理中…' : '保存标题'}</Text>
                </Pressable>
                <Pressable
                  style={[styles.button, styles.buttonNeutral, busy && styles.buttonDisabled]}
                  disabled={busy}
                  onPress={loadHistory}
                >
                  <Text style={styles.buttonText}>投递历史</Text>
                </Pressable>
                <Pressable
                  style={[styles.button, styles.buttonDanger, busy && styles.buttonDisabled]}
                  disabled={busy}
                  onPress={remove}
                >
                  <Text style={styles.buttonTextDanger}>删除</Text>
                </Pressable>
              </View>

              {history !== null ? (
                <>
                  <Text style={styles.section}>最近投递</Text>
                  {history.length === 0 ? (
                    <Text style={styles.empty}>还没有投递记录。</Text>
                  ) : (
                    <ScrollView style={styles.historyBox} nestedScrollEnabled>
                      {history.map((record, index) => (
                        <View key={index} style={styles.historyRow}>
                          <Text style={styles.historyTime}>
                            {record.at ? new Date(record.at).toLocaleString() : '—'}
                          </Text>
                          <Text style={styles.historyStatus}>
                            {[record.status, record.kind].filter(Boolean).join(' · ') || '记录'}
                          </Text>
                          {record.summary ? (
                            <Text style={styles.historySummary} numberOfLines={2}>
                              {record.summary}
                            </Text>
                          ) : null}
                        </View>
                      ))}
                    </ScrollView>
                  )}
                </>
              ) : null}
            </>
          ) : (
            <Text style={styles.empty}>这条任务没有归属会话，只能查看。</Text>
          )}

          <Text style={styles.footnote}>
            新定时任务由 agent 用 schedule_create 工具创建；这里只做管理。
          </Text>
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
      paddingHorizontal: 18,
      paddingTop: 16,
      paddingBottom: 26,
      maxHeight: '86%',
    },
    titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
    title: { flex: 1, color: t.text.primary, fontSize: 16.5, fontWeight: '700' },
    close: { color: t.text.muted, fontSize: 22, paddingHorizontal: 4 },
    meta: { color: t.text.muted, fontSize: 11, marginTop: 3 },
    promptBox: {
      marginTop: 10,
      maxHeight: 120,
      backgroundColor: t.bg.subtle,
      borderRadius: 10,
      padding: 10,
    },
    promptText: { color: t.text.secondary, fontSize: 12, lineHeight: 17 },
    notice: { color: t.semantic.gateAmberText, fontSize: 12, marginTop: 10 },
    section: {
      color: t.text.secondary,
      fontSize: 12,
      fontWeight: '700',
      marginTop: 14,
      marginBottom: 6,
    },
    input: {
      backgroundColor: t.bg.subtle,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border.default,
      color: t.text.primary,
      fontSize: 13,
      paddingHorizontal: 10,
      paddingVertical: 8,
    },
    actionsRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
    button: { flex: 1, borderRadius: 11, paddingVertical: 9, alignItems: 'center' },
    buttonPrimary: { backgroundColor: t.action.primaryBg },
    buttonNeutral: {
      backgroundColor: t.bg.subtle,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border.default,
    },
    buttonDanger: { backgroundColor: t.semantic.dangerBg },
    buttonDisabled: { opacity: 0.45 },
    buttonTextPrimary: { color: t.action.primaryText, fontSize: 12.5, fontWeight: '700' },
    buttonText: { color: t.text.secondary, fontSize: 12.5, fontWeight: '700' },
    buttonTextDanger: { color: t.semantic.dangerText, fontSize: 12.5, fontWeight: '700' },
    empty: { color: t.text.muted, fontSize: 12, paddingVertical: 8 },
    historyBox: { maxHeight: 220 },
    historyRow: {
      paddingVertical: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.border.subtle,
      gap: 2,
    },
    historyTime: { color: t.text.muted, fontSize: 10.5, fontVariant: ['tabular-nums'] },
    historyStatus: { color: t.text.primary, fontSize: 12, fontWeight: '600' },
    historySummary: { color: t.text.secondary, fontSize: 11.5, lineHeight: 16 },
    footnote: { color: t.text.muted, fontSize: 10.5, lineHeight: 15, marginTop: 14 },
  });
