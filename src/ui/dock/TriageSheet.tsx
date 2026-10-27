import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { TYPE } from '../../theme/tokens';
import { MONO, useTheme } from '../theme';
import { DiffView, type QuoteLine } from '../stream/DiffView';

interface Props {
  visible: boolean;
  target: string;
  reason?: string;
  diff?: string;
  nextCommand?: string;
  highRisk?: boolean;
  busy?: boolean;
  onClose: () => void;
  onApprove: () => void;
  onReject: () => void;
  onQuote?: (line: QuoteLine) => void;
}

/**
 * 展开态：78% 高的零干扰三段式决策卡（§2.3 方案 B）。
 * 01 为什么改 / 02 改哪里 / 03 后续动作。
 */
export function TriageSheet({
  visible,
  target,
  reason,
  diff,
  nextCommand,
  highRisk,
  busy,
  onClose,
  onApprove,
  onReject,
  onQuote,
}: Props) {
  const t = useTheme();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropFill} onPress={onClose} />
        <View
          style={[
            styles.sheet,
            { backgroundColor: t.bg.canvas, borderColor: t.border.default },
          ]}
        >
          <View style={styles.head}>
            <View style={styles.headText}>
              <Text style={[styles.title, { color: t.text.primary }]} numberOfLines={1}>
                {highRisk ? '高危审批' : '待批复'}
              </Text>
              <Text style={[styles.target, { color: t.text.muted }]} numberOfLines={1}>
                {target}
              </Text>
            </View>
            <Pressable hitSlop={10} onPress={onClose}>
              <Text style={[styles.close, { color: t.text.muted }]}>收起 ⌄</Text>
            </Pressable>
          </View>

          <ScrollView style={styles.body} contentContainerStyle={styles.bodyInner}>
            <Section index="01" title="为什么改" palette={t}>
              <Text style={[styles.reason, { color: t.text.secondary }]}>
                {reason?.trim() || '（这次调用没有附带说明）'}
              </Text>
            </Section>

            {diff ? (
              <Section index="02" title="改哪里" palette={t}>
                <DiffView source={diff} file={target} limit={80} onQuote={onQuote} />
              </Section>
            ) : null}

            {nextCommand ? (
              <Section index="03" title="后续动作" palette={t}>
                <Text style={[styles.command, { color: t.text.secondary }]}>{nextCommand}</Text>
              </Section>
            ) : null}
          </ScrollView>

          <View style={[styles.footer, { borderTopColor: t.border.default }]}>
            <Pressable
              style={[styles.big, styles.reject, { borderColor: t.border.default, backgroundColor: t.bg.surface }]}
              onPress={onReject}
              disabled={busy}
            >
              <Text style={[styles.bigText, { color: t.text.secondary }]}>拒绝并回滚</Text>
            </Pressable>
            <Pressable
              style={[styles.big, styles.approve, { backgroundColor: t.action.primaryBg }]}
              onPress={onApprove}
              disabled={busy}
            >
              <Text style={[styles.bigText, { color: t.action.primaryText }]}>
                {busy ? '处理中…' : '批准并继续队列'}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Section({
  index,
  title,
  palette,
  children,
}: {
  index: string;
  title: string;
  palette: ReturnType<typeof useTheme>;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: palette.text.muted }]}>
        {index}. {title}
      </Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' },
  backdropFill: { flex: 1 },
  sheet: {
    height: '78%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
    gap: 12,
  },
  headText: { flex: 1, gap: 2 },
  title: { ...TYPE.title, fontWeight: '600' },
  target: { ...TYPE.mono, fontFamily: MONO },
  close: { ...TYPE.caption, fontFamily: MONO },
  body: { flex: 1 },
  bodyInner: { paddingHorizontal: 16, paddingBottom: 16, gap: 14 },
  section: { gap: 8 },
  sectionTitle: { ...TYPE.caption, fontFamily: MONO, letterSpacing: 0.4 },
  reason: { ...TYPE.body },
  command: { ...TYPE.mono, fontFamily: MONO },
  footer: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 22,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  big: { flex: 1, minHeight: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  reject: { borderWidth: StyleSheet.hairlineWidth },
  approve: {},
  bigText: { ...TYPE.body, fontWeight: '600' },
});
