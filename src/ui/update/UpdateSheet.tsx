import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { currentLanguage, tr } from '../../i18n';
import { useThemedStyles } from '../theme';
import type { Palette } from '../../theme/tokens';
import type { LatestManifest, UpdateEvaluation } from '../../update/manifest';

/**
 * 更新结果弹窗（issue #12，只展示「检查」结果）。
 *
 * 刻意没有「下载并安装」按钮：本块不做下载 / 校验和 / 安装，那是 chunk 4。
 * 这里只给「稍后」和跳 Releases 手动下载两个出口。
 *
 * 只有 update-available 会挂载本弹窗；up-to-date 由调用方用轻提示处理。
 */

interface Props {
  visible: boolean;
  /** 本次检查拿到的 latest.json。 */
  manifest: LatestManifest;
  /** evaluateUpdate 的返回值（update-available）。 */
  evaluation: UpdateEvaluation;
  /** 最近一次检查时间（毫秒）；手动检查时就是这次的时间。 */
  checkedAt?: number;
  onClose: () => void;
  onManualDownload: () => void;
}

/** 相对时间；与列表同口径，避免同一界面出现两种时间语言。 */
export function checkedAgo(at: number): string {
  const diff = Math.max(0, Date.now() - at);
  if (diff < 60_000) return tr("刚刚");
  if (diff < 3_600_000) return Math.floor(diff / 60_000) + tr(" 分钟前");
  if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + tr(" 小时前");
  return Math.floor(diff / 86_400_000) + tr(" 天前");
}

/** 弱警告码 → 一行人话；未知码不展示（机器码留给日志）。 */
function weakWarningLabel(code: string): string | null {
  switch (code) {
    case 'gateway-unknown':
      return tr("无法确认本机网关版本，请自行核对");
    case 'gateway-outdated':
      return tr("本机网关版本低于新版要求");
    case 'dsh-unknown':
      return tr("无法确认本机 DSH 版本，请自行核对");
    case 'dsh-outdated':
      return tr("本机 DSH 版本低于新版要求");
    case 'voice-unknown':
      return tr("无法确认本机语音模块版本，请自行核对");
    case 'voice-outdated':
      return tr("本机语音模块版本低于新版要求");
    case 'protocol-unknown':
      return tr("无法确认本机协议版本，请先更新宿主网关");
    default:
      return null;
  }
}

export function UpdateSheet({
  visible,
  manifest,
  evaluation,
  checkedAt,
  onClose,
  onManualDownload,
}: Props) {
  const styles = useThemedStyles(makeStyles);

  // 按当前语言取发布说明；当前语言缺失时退回另一份，两份都没有就整区不展示。
  const notes = manifest.releaseNotes;
  const releaseNotes = notes
    ? currentLanguage() === 'zh'
      ? notes['zh-CN'] ?? notes.en
      : notes.en ?? notes['zh-CN']
    : undefined;

  const hostBlocked = evaluation.kind === 'update-available' && evaluation.hostBlocked;
  const weakWarnings =
    evaluation.kind === 'update-available'
      ? evaluation.weakWarnings
          .map((code) => weakWarningLabel(code))
          .filter((label): label is string => label !== null)
      : [];

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => undefined} testID="update-sheet">
          <View style={styles.titleRow}>
            <Text style={styles.title} maxFontSizeMultiplier={1.3}>
              {tr("发现新版本")}
            </Text>
            <Pressable hitSlop={10} onPress={onClose} accessibilityLabel={tr("关闭")}>
              <Text style={styles.close}>×</Text>
            </Pressable>
          </View>

          <ScrollView bounces={false}>
            <View style={styles.versionBlock}>
              <Text style={styles.version}>{manifest.version}</Text>
              <Text style={styles.tag}>{manifest.tag}</Text>
            </View>

            {checkedAt === undefined ? null : (
              <Text style={styles.checkedAt}>
                {tr("最近检查：{0}", [checkedAgo(checkedAt)])}
              </Text>
            )}

            {hostBlocked ? (
              <Text style={styles.blocked}>{tr("请先更新宿主网关再升级 App")}</Text>
            ) : null}

            {weakWarnings.map((label, index) => (
              <Text key={`${index}-${label}`} style={styles.warning}>
                {label}
              </Text>
            ))}

            {releaseNotes ? (
              <>
                <Text style={styles.section}>{tr("发布说明")}</Text>
                <Text style={styles.notes}>{releaseNotes}</Text>
              </>
            ) : null}
          </ScrollView>

          <View style={styles.buttons}>
            <Pressable
              style={[styles.button, styles.secondaryButton]}
              onPress={onClose}
              testID="update-later"
            >
              <Text style={styles.secondaryLabel}>{tr("稍后")}</Text>
            </Pressable>
            <Pressable
              style={[styles.button, styles.primaryButton]}
              onPress={onManualDownload}
              testID="update-manual-download"
            >
              <Text style={styles.primaryLabel}>{tr("去 Releases 手动下载")}</Text>
            </Pressable>
          </View>
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
      maxHeight: '84%',
    },
    titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    title: { color: t.text.primary, fontSize: 16.5, fontWeight: '700', flex: 1 },
    close: { color: t.text.muted, fontSize: 22, paddingHorizontal: 4 },
    versionBlock: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 10 },
    version: { color: t.text.primary, fontSize: 20, fontWeight: '700' },
    tag: { color: t.text.muted, fontSize: 12 },
    checkedAt: { color: t.text.muted, fontSize: 11, marginTop: 4 },
    blocked: {
      color: t.semantic.dangerText,
      backgroundColor: t.semantic.dangerBg,
      fontSize: 12,
      lineHeight: 17,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 8,
      marginTop: 12,
    },
    warning: { color: t.semantic.gateAmberText, fontSize: 11.5, lineHeight: 16, marginTop: 8 },
    section: {
      color: t.text.secondary,
      fontSize: 12,
      fontWeight: '700',
      marginTop: 16,
      marginBottom: 6,
    },
    notes: { color: t.text.secondary, fontSize: 12.5, lineHeight: 18 },
    buttons: { flexDirection: 'row', gap: 10, marginTop: 18 },
    button: { flex: 1, alignItems: 'center', borderRadius: 10, paddingVertical: 11 },
    secondaryButton: { backgroundColor: t.action.secondaryBg },
    primaryButton: { backgroundColor: t.action.primaryBg },
    secondaryLabel: { color: t.action.secondaryText, fontSize: 13, fontWeight: '700' },
    primaryLabel: { color: t.action.primaryText, fontSize: 13, fontWeight: '700' },
  });
