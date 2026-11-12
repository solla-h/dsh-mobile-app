import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { TYPE } from '../../theme/tokens';
import { MONO, useTheme } from '../theme';
import { DiffView, type QuoteLine } from '../stream/DiffView';
import { tr } from '../../i18n';

interface Props {
  visible: boolean;
  target: string;
  reason?: string;
  diff?: string;
  nextCommand?: string;
  /** shell/exec 类审批必须看到命令；拿不到时禁止批准 */
  commandRequired?: boolean;
  highRisk?: boolean;
  busy?: boolean;
  /** 上一次提交失败的原因；展开态也要能看到 */
  error?: string | null;
  trusted?: boolean;
  dir?: string;
  onToggleTrust?: () => void;
  onClose: () => void;
  onApprove: () => void;
  onReject: () => void;
  onQuote?: (line: QuoteLine) => void;
}

/**
 * 展开态：78% 高的零干扰三段式决策卡（§2.3 方案 B）。
 * 01 为什么改（R1 推理结论） / 02 改哪里（核心 Diff 预览，点按行引用） / 03 后续动作（批准后自动执行）。
 */
export function TriageSheet({
  visible,
  target,
  reason,
  diff,
  nextCommand,
  commandRequired,
  highRisk,
  busy,
  error,
  trusted,
  dir,
  onToggleTrust,
  onClose,
  onApprove,
  onReject,
  onQuote,
}: Props) {
  const t = useTheme();
  const commandBlocked = Boolean(commandRequired && !nextCommand?.trim());
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
          <View style={[styles.head, { borderBottomColor: t.border.subtle }]}>
            <View style={styles.headText}>
              <View style={styles.badgeRow}>
                <View
                  style={[
                    styles.kickerBadge,
                    {
                      backgroundColor: highRisk
                        ? t.semantic.dangerBg
                        : t.semantic.gateAmberBg,
                      borderColor: highRisk
                        ? t.semantic.dangerText
                        : t.semantic.gateAmberText,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.kickerText,
                      {
                        color: highRisk
                          ? t.semantic.dangerText
                          : t.semantic.gateAmberText,
                      },
                    ]}
                  >
                    {tr("审批详情")}
                  </Text>
                </View>
              </View>
              <Text style={[styles.title, { color: t.text.primary }]} numberOfLines={1}>
                {target}
              </Text>
            </View>
            <Pressable
              hitSlop={10}
              onPress={onClose}
              style={[styles.closeBtn, { backgroundColor: t.bg.surface, borderColor: t.border.default }]}
            >
              <Text style={[styles.close, { color: t.text.secondary }]}>{tr("收起回底栏 ⌄")}</Text>
            </Pressable>
          </View>

          <ScrollView style={styles.body} contentContainerStyle={styles.bodyInner}>
            <Section index="01" title={tr("为什么改 (R1 推理结论)")} palette={t}>
              <View style={[styles.cardBox, { backgroundColor: t.bg.subtle, borderColor: t.border.subtle }]}>
                <Text style={[styles.reason, { color: t.text.primary }]}>
                  {reason?.trim() || tr("定位到当前模块需要应用此变更以推进后续验证流程。")}
                </Text>
              </View>
            </Section>

            {diff ? (
              <Section index="02" title={tr("改哪里 (点击任意代码行可引用微调)")} palette={t}>
                <DiffView
                  source={diff}
                  file={target}
                  limit={80}
                  onQuote={(line) => {
                    onQuote?.(line);
                    onClose();
                  }}
                />
              </Section>
            ) : null}

            <Section index="03" title={tr("后续动作（允许后自动执行）")} palette={t}>
              <View style={[styles.cardBox, { backgroundColor: t.bg.subtle, borderColor: t.border.subtle }]}>
                <Text
                  style={[
                    styles.command,
                    { color: commandBlocked ? t.semantic.dangerText : t.text.secondary },
                  ]}
                >
                  {nextCommand?.trim()
                    ? nextCommand
                    : commandBlocked
                      ? tr("命令详情不可用。请到 Web UI 确认这条命令后再决定。")
                      : tr("应用该变更并继续执行当前会话中的后续工具队列")}
                </Text>
              </View>
            </Section>

            {onToggleTrust && dir ? (
              <Pressable
                onPress={onToggleTrust}
                style={[
                  styles.trustRow,
                  {
                    backgroundColor: trusted ? t.bg.surface : t.bg.subtle,
                    borderColor: trusted ? t.text.primary : t.border.subtle,
                  },
                ]}
              >
                <Text style={[styles.trustLabel, { color: t.text.primary }]} numberOfLines={1}>
                  {tr("本会话内自动允许同类目录 (") + dir + '/*)'}
                </Text>
                <Text style={[styles.trustCheck, { color: t.text.primary }]}>
                  {trusted ? tr("✓ 已开启") : tr("开启")}
                </Text>
              </Pressable>
            ) : null}
          </ScrollView>

          {error ? (
            <Text style={[styles.sheetError, { color: t.semantic.dangerText }]} numberOfLines={2}>
              {error}
            </Text>
          ) : null}

          <View style={[styles.footer, { borderTopColor: t.border.default }]}>
            <Pressable
              style={[
                styles.big,
                styles.reject,
                { borderColor: t.border.default, backgroundColor: t.bg.surface },
              ]}
              onPress={onReject}
              disabled={busy}
            >
              <Text style={[styles.bigText, { color: t.text.primary }]}>{tr("× 拒绝")}</Text>
            </Pressable>
            <Pressable
              style={[styles.big, styles.approve, { backgroundColor: t.action.primaryBg }]}
              onPress={onApprove}
              disabled={busy || commandBlocked}
            >
              <Text style={[styles.bigText, { color: t.action.primaryText }]}>
                {commandBlocked ? tr("命令不可见 · 无法决定") : busy ? tr("处理中…") : tr("✓ 允许一次")}
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
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(20, 20, 18, 0.48)' },
  backdropFill: { flex: 1 },
  sheet: {
    height: '78%',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  headText: { flex: 1, gap: 4 },
  badgeRow: { flexDirection: 'row', alignItems: 'center' },
  kickerBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
  },
  kickerText: { ...TYPE.mono, fontFamily: MONO, fontSize: 10, fontWeight: '700' },
  title: { ...TYPE.title, fontFamily: MONO, fontWeight: '700' },
  closeBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  close: { ...TYPE.mono, fontFamily: MONO, fontSize: 11 },
  body: { flex: 1 },
  bodyInner: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 18, gap: 14 },
  section: { gap: 6 },
  sectionTitle: { ...TYPE.caption, fontFamily: MONO, fontSize: 11, fontWeight: '600' },
  cardBox: {
    padding: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  reason: { ...TYPE.body },
  command: { ...TYPE.mono, fontFamily: MONO },
  trustRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  trustLabel: { ...TYPE.mono, fontFamily: MONO, flex: 1 },
  trustCheck: { ...TYPE.mono, fontFamily: MONO, fontWeight: '700' },
  sheetError: { ...TYPE.caption, paddingHorizontal: 16, paddingBottom: 4 },
  footer: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 24,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  big: { flex: 1, minHeight: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  reject: { borderWidth: StyleSheet.hairlineWidth },
  approve: {},
  bigText: { ...TYPE.body, fontWeight: '600' },
});
