import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  buildAnswers,
  draftComplete,
  pickDisplayReason,
  type DraftAnswer,
  type PendingApproval,
  type PendingQuestion,
  type QuestionAnswer,
} from '../protocol/interactions';
import { approvalRisk } from '../protocol/risk';
import { chargeStartFeedback, successFeedback } from './haptics';
import { useTheme, useThemedStyles } from './theme';
import type { Palette } from '../theme/tokens';

interface Props {
  approval: PendingApproval | null;
  question: PendingQuestion | null;
  error: string | null;
  /** 用户点了「稍后」：只是收起面板，请求仍然挂起，不会被取消。 */
  hidden: boolean;
  onDismiss: () => void;
  onApproval: (outcome: 'allowed-once' | 'rejected') => void;
  onAnswer: (answers: QuestionAnswer[]) => void;
  onCancelQuestion: () => void;
}

export function InteractionSheet({
  approval,
  question,
  error,
  hidden,
  onDismiss,
  onApproval,
  onAnswer,
  onCancelQuestion,
}: Props) {
  const styles = useThemedStyles(makeStyles);
  const requestKey = approval?.rpcId ?? question?.rpcId ?? '';

  return (
    <Modal
      visible={Boolean(requestKey) && !hidden}
      transparent
      animationType="slide"
      statusBarTranslucent
      presentationStyle="overFullScreen"
      onRequestClose={onDismiss}
    >
      <Pressable style={styles.backdrop} onPress={onDismiss}>
        <KeyboardAvoidingView behavior="padding" style={styles.sheetWrap}>
          <Pressable style={styles.sheet} onPress={() => undefined}>
            <View style={styles.grabber} />
            <View style={styles.kickerRow}>
              <Text style={styles.kicker}>{approval ? '需要审批' : '需要你回答'}</Text>
              {approval?.toolName ? (
                <Text style={styles.toolChip} numberOfLines={1}>
                  {approval.toolName}
                </Text>
              ) : null}
              {question ? (
                <Text style={styles.toolChip} numberOfLines={1}>
                  {question.questions.length > 1 ? question.questions.length + ' 个问题' : '1 个问题'}
                </Text>
              ) : null}
              <Pressable hitSlop={10} style={styles.later} onPress={onDismiss}>
                <Text style={styles.laterText}>稍后</Text>
              </Pressable>
            </View>
            {approval ? (
              <ApprovalBody
                key={approval.rpcId}
                approval={approval}
                error={error}
                onApproval={onApproval}
              />
            ) : question ? (
              <QuestionBody
                key={question.rpcId}
                question={question}
                error={error}
                onAnswer={onAnswer}
                onCancel={onCancelQuestion}
              />
            ) : null}
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

function ApprovalBody({
  approval,
  error,
  onApproval,
}: {
  approval: PendingApproval;
  error: string | null;
  onApproval: (outcome: 'allowed-once' | 'rejected') => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const reason = pickDisplayReason(approval.displayReason, approval.reason);
  const risk = useMemo(() => approvalRisk(approval), [approval]);
  // 用 state 装 Animated.Value：渲染期读 ref.current 会被 react-hooks/refs 拦。
  const [fill] = useState(() => new Animated.Value(0));
  const doneRef = useRef(false);
  const high = risk.level === 'high';

  const startCharge = () => {
    if (doneRef.current) return;
    chargeStartFeedback();
    Animated.timing(fill, {
      toValue: 1,
      duration: 550,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (!finished || doneRef.current) return;
      doneRef.current = true;
      successFeedback();
      onApproval('allowed-once');
    });
  };

  const cancelCharge = () => {
    if (doneRef.current) return;
    fill.stopAnimation(() => {
      // 松手后 120ms 归零：够快，也不会有跳变感。
      Animated.timing(fill, { toValue: 0, duration: 120, useNativeDriver: false }).start();
    });
  };

  return (
    <View>
      <Text style={styles.reason}>{reason || '该操作需要你确认后才能继续。'}</Text>
      {high ? (
        <View style={styles.riskRow}>
          <Text style={styles.riskTag}>高危</Text>
          <Text style={styles.riskText}>{risk.labels.join(' · ')}</Text>
        </View>
      ) : null}
      <Text style={styles.note}>这是一次性授权，只对当前这一次操作生效。</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.buttonRow}>
        <Pressable style={[styles.button, styles.reject]} onPress={() => onApproval('rejected')}>
          <Text style={styles.rejectText}>拒绝</Text>
        </Pressable>
        {high ? (
          <Pressable
            style={[styles.button, styles.allow, styles.holdButton]}
            onPressIn={startCharge}
            onPressOut={cancelCharge}
            accessibilityHint="按住半秒才会放行，防止误触"
          >
            <Animated.View
              style={[
                styles.holdFill,
                {
                  width: fill.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
                },
              ]}
            />
            <Text style={styles.allowText}>长按 0.5s 放行</Text>
          </Pressable>
        ) : (
          <Pressable style={[styles.button, styles.allow]} onPress={() => onApproval('allowed-once')}>
            <Text style={styles.allowText}>允许一次</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function QuestionBody({
  question,
  error,
  onAnswer,
  onCancel,
}: {
  question: PendingQuestion;
  error: string | null;
  onAnswer: (answers: QuestionAnswer[]) => void;
  onCancel: () => void;
}) {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [drafts, setDrafts] = useState<Record<string, DraftAnswer>>(() =>
    Object.fromEntries(question.questions.map((item) => [item.id, { selected: [], custom: '' }])),
  );

  useEffect(() => {
    setDrafts(Object.fromEntries(question.questions.map((item) => [item.id, { selected: [], custom: '' }])));
  }, [question.rpcId, question.questions]);

  const complete = useMemo(() => draftComplete(question.questions, drafts), [question.questions, drafts]);

  const toggle = (questionId: string, label: string, multi: boolean) => {
    setDrafts((current) => {
      const draft = current[questionId] ?? { selected: [], custom: '' };
      if (multi) {
        const selected = draft.selected.includes(label)
          ? draft.selected.filter((item) => item !== label)
          : [...draft.selected, label];
        return { ...current, [questionId]: { ...draft, selected } };
      }
      const selected = draft.selected.includes(label) ? [] : [label];
      // 单选：选了选项就清掉自定义输入。
      return { ...current, [questionId]: { selected, custom: selected.length ? '' : draft.custom } };
    });
  };

  const setCustom = (questionId: string, custom: string) => {
    setDrafts((current) => {
      const draft = current[questionId] ?? { selected: [], custom: '' };
      const questionItem = question.questions.find((item) => item.id === questionId);
      const clearSelected = custom.length > 0 && !questionItem?.multiSelect;
      return { ...current, [questionId]: { selected: clearSelected ? [] : draft.selected, custom } };
    });
  };

  return (
    <View style={styles.flex}>
      <ScrollView style={styles.questionScroll} contentContainerStyle={styles.questionContent}>
        {question.questions.map((item, index) => {
          const draft = drafts[item.id] ?? { selected: [], custom: '' };
          const multi = Boolean(item.multiSelect);
          return (
            <View key={item.id} style={styles.questionBlock}>
              {item.header ? <Text style={styles.questionHeader}>{item.header}</Text> : null}
              <Text style={styles.questionTitle}>
                {question.questions.length > 1 ? `${index + 1}. ` : ''}
                {item.question}
              </Text>
              {item.detail ? <Text style={styles.questionDetail}>{item.detail}</Text> : null}
              {!item.options?.length ? (
                <Text style={styles.noOptions}>
                  模型这次没有给出选项，直接在下面输入答案即可。
                </Text>
              ) : null}
              {(item.options ?? []).map((option) => {
                const checked = draft.selected.includes(option.label);
                return (
                  <Pressable
                    key={option.label}
                    style={[styles.option, checked ? styles.optionChecked : null]}
                    onPress={() => toggle(item.id, option.label, multi)}
                  >
                    <View style={[styles.marker, multi ? styles.markerBox : styles.markerCircle, checked ? styles.markerOn : null]}>
                      {checked ? <View style={[styles.markerDot, multi ? styles.markerDotBox : null]} /> : null}
                    </View>
                    <View style={styles.optionText}>
                      <Text style={styles.optionLabel}>{option.label}</Text>
                      {option.description ? (
                        <Text style={styles.optionDescription}>{option.description}</Text>
                      ) : null}
                    </View>
                  </Pressable>
                );
              })}
              <TextInput
                style={styles.customInput}
                value={draft.custom}
                onChangeText={(text) => setCustom(item.id, text)}
                placeholder={
                  !item.options?.length
                    ? '输入你的答案'
                    : multi
                      ? '补充说明（可选）'
                      : '或者自己写一个答案'
                }
                placeholderTextColor={t.text.muted}
                multiline
              />
            </View>
          );
        })}
      </ScrollView>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.buttonRow}>
        <Pressable
          style={[styles.button, styles.reject]}
          onPress={() =>
            Alert.alert('跳过这个问题？', '跳过会让 agent 收到「用户取消」，这一轮不会记录任何答案。', [
              { text: '继续回答', style: 'cancel' },
              { text: '跳过', style: 'destructive', onPress: onCancel },
            ])
          }
        >
          <Text style={styles.rejectText}>跳过</Text>
        </Pressable>
        <Pressable
          style={[styles.button, styles.allow, !complete && styles.buttonDisabled]}
          disabled={!complete}
          onPress={() => onAnswer(buildAnswers(question.questions, drafts))}
        >
          <Text style={styles.allowText}>提交</Text>
        </Pressable>
      </View>
    </View>
  );
}

const makeStyles = (t: Palette) =>
  StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheetWrap: { width: '100%' },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: t.border.default,
    marginBottom: 12,
  },
  sheet: {
    backgroundColor: t.bg.canvas,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 28,
    maxHeight: '82%',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: t.border.default,
  },
  flex: { maxHeight: '100%' },
  kickerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  later: {
    marginLeft: 'auto',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: t.bg.surface,
  },
  laterText: { color: t.text.secondary, fontSize: 12, fontWeight: '600' },
  kicker: { color: t.semantic.gateAmberText, fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  toolChip: {
    flexShrink: 1,
    color: t.text.primary,
    fontSize: 11,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: t.bg.surface,
    overflow: 'hidden',
  },
  reason: { color: t.text.primary, fontSize: 15, lineHeight: 22 },
  note: { color: t.text.muted, fontSize: 12, marginTop: 10 },
  error: { color: t.semantic.dangerText, fontSize: 12, marginTop: 10 },
  buttonRow: { flexDirection: 'row', gap: 10, marginTop: 18 },
  button: { flex: 1, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  buttonDisabled: { opacity: 0.35 },
  reject: { backgroundColor: t.bg.surface },
  rejectText: { color: t.text.secondary, fontSize: 15, fontWeight: '600' },
  allow: { backgroundColor: t.action.primaryBg },
  allowText: { color: t.bg.canvas, fontSize: 15, fontWeight: '700' },
  riskRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  riskTag: {
    color: t.semantic.dangerText,
    fontSize: 10,
    fontWeight: '700',
    backgroundColor: t.semantic.dangerBg,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
  },
  riskText: { color: t.semantic.gateAmberText, fontSize: 11 },
  holdButton: { overflow: 'hidden', justifyContent: 'center' },
  holdFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: t.semantic.gateAmberText,
  },
  questionScroll: { flexGrow: 0, flexShrink: 1 },
  questionContent: { paddingBottom: 6 },
  questionBlock: { marginBottom: 18 },
  questionHeader: { color: t.text.muted, fontSize: 11, letterSpacing: 1, marginBottom: 4 },
  questionTitle: { color: t.text.primary, fontSize: 15, fontWeight: '600', lineHeight: 21 },
  questionDetail: { color: t.text.muted, fontSize: 12, marginTop: 4, lineHeight: 17 },
  noOptions: {
    color: t.semantic.gateAmberText,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 8,
    backgroundColor: t.semantic.gateAmberBg,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: t.bg.surface,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 8,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  optionChecked: { borderColor: t.action.primaryBg, backgroundColor: t.bg.canvas },
  marker: {
    width: 18,
    height: 18,
    borderWidth: 1.5,
    borderColor: t.border.default,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  markerCircle: { borderRadius: 9 },
  markerBox: { borderRadius: 4 },
  markerOn: { borderColor: t.action.primaryBg },
  markerDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: t.action.primaryBg },
  markerDotBox: { borderRadius: 2 },
  optionText: { flex: 1 },
  optionLabel: { color: t.text.primary, fontSize: 14 },
  optionDescription: { color: t.text.muted, fontSize: 12, marginTop: 2, lineHeight: 17 },
  customInput: {
    backgroundColor: t.bg.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: t.text.primary,
    fontSize: 14,
    marginTop: 10,
    minHeight: 44,
    textAlignVertical: 'top',
  },
});
