import { useCallback, useEffect, useRef, useState } from 'react';
import type { File } from 'expo-file-system';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { currentLanguage, tr } from '../../i18n';
import { useThemedStyles } from '../theme';
import type { Palette } from '../../theme/tokens';
import type { LatestManifest, UpdateEvaluation } from '../../update/manifest';
import { downloadAndVerify, installApk, type DownloadFailure } from '../../update/installer';

/**
 * 更新结果弹窗（issue #12）：检查结果 + Android 下载/校验/安装。
 *
 * 平台边界：只有 Android 且 hostBlocked 为 false 时显示「下载并安装」；
 * 其它情况保持只读的「稍后 / 去 Releases 手动下载」，安装链路不在这里兜底。
 *
 * 安装没有成功回调：系统安装器接管后覆盖安装会重启进程，弹窗只能展示
 * 「等待安装器」；`installApk` 返回 launched 时关闭弹窗，needs-unknown-sources
 * 时停在授权提示，failed 时回到可重试的失败态。
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

/** 弹窗内的下载/校验/安装状态；一次下载对应一个 AbortController。 */
type Phase =
  | { kind: 'idle' }
  | { kind: 'downloading'; progress: number }
  | { kind: 'verifying' }
  | { kind: 'installing' }
  | { kind: 'needs-permission' }
  | { kind: 'failed'; reason: DownloadFailure | 'install' };

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

/** 失败原因码 → 用户能看懂的一句话；不把机器码带到界面。 */
function failureMessage(reason: DownloadFailure | 'install'): string {
  switch (reason) {
    case 'url':
      return tr("下载地址未通过校验，已取消下载。请改用手动下载");
    case 'download':
      return tr("下载失败，请检查网络后重试");
    case 'checksum':
      return tr("文件校验未通过，已删除下载内容。请重试或改用手动下载");
    case 'install':
      return tr("无法打开系统安装器，请重试或改用手动下载");
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

  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  /** 当前这次下载的取消句柄；取消/关闭/重试都会换掉它。 */
  const controllerRef = useRef<AbortController | null>(null);
  /** 用递增 id 让已经取消的异步结果失效，不再改状态。 */
  const runIdRef = useRef(0);
  /** 校验通过的包：授权未知来源后重试安装时直接复用，不重复下载。 */
  const readyFileRef = useRef<File | null>(null);

  useEffect(
    () => () => {
      runIdRef.current += 1;
      controllerRef.current?.abort();
    },
    [],
  );

  // 按当前语言取发布说明；当前语言缺失时退回另一份，两份都没有就整区不展示。
  const notes = manifest.releaseNotes;
  const releaseNotes = notes
    ? currentLanguage() === 'zh'
      ? notes['zh-CN'] ?? notes.en
      : notes.en ?? notes['zh-CN']
    : undefined;

  const hostBlocked = evaluation.kind === 'update-available' && evaluation.hostBlocked;
  const canInstall = Platform.OS === 'android' && !hostBlocked;
  const weakWarnings =
    evaluation.kind === 'update-available'
      ? evaluation.weakWarnings
          .map((code) => weakWarningLabel(code))
          .filter((label): label is string => label !== null)
      : [];

  const install = useCallback(
    async (file: File) => {
      setPhase({ kind: 'installing' });
      const status = await installApk(file);
      if (status === 'launched') {
        // 安装器已拉起；覆盖安装会重启进程，这里只负责收起弹窗。
        onClose();
        return;
      }
      if (status === 'needs-unknown-sources') {
        setPhase({ kind: 'needs-permission' });
        return;
      }
      readyFileRef.current = null;
      setPhase({ kind: 'failed', reason: 'install' });
    },
    [onClose],
  );

  const startDownload = useCallback(async () => {
    const controller = new AbortController();
    controllerRef.current = controller;
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    readyFileRef.current = null;
    setPhase({ kind: 'downloading', progress: 0 });

    const result = await downloadAndVerify(
      manifest,
      (progress) => {
        if (runIdRef.current !== runId) return;
        // 最后一次进度事件≈下载完成；之后才开始取 SHA256SUMS 与比对摘要。
        setPhase(progress >= 1 ? { kind: 'verifying' } : { kind: 'downloading', progress });
      },
      controller.signal,
    );

    if (runIdRef.current !== runId) return;
    controllerRef.current = null;

    if ('error' in result) {
      setPhase({ kind: 'failed', reason: result.error });
      return;
    }

    readyFileRef.current = result.file;
    await install(result.file);
  }, [install, manifest]);

  const cancelDownload = useCallback(() => {
    runIdRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
    setPhase({ kind: 'idle' });
  }, []);

  const retry = useCallback(() => {
    const file = readyFileRef.current;
    if (file === null) void startDownload();
    else void install(file);
  }, [install, startDownload]);

  const percent = phase.kind === 'downloading' ? Math.round(phase.progress * 100) : 0;

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

            {phase.kind === 'downloading' ? (
              <View style={styles.progressBlock}>
                <View style={styles.progressTrack}>
                  <View
                    style={[styles.progressFill, { width: `${percent}%` as const }]}
                    testID="update-progress-fill"
                  />
                </View>
                <View style={styles.progressRow}>
                  <Text style={styles.progressText}>{tr("正在下载更新包…")}</Text>
                  <Text style={styles.progressPercent} testID="update-progress">
                    {percent}%
                  </Text>
                </View>
              </View>
            ) : null}

            {phase.kind === 'verifying' ? (
              <Text style={styles.statusText}>{tr("正在校验…")}</Text>
            ) : null}

            {phase.kind === 'installing' ? (
              <Text style={styles.statusText}>{tr("已打开系统安装器，请按提示完成安装")}</Text>
            ) : null}

            {phase.kind === 'needs-permission' ? (
              <Text style={styles.warning}>
                {tr("请允许本应用「安装未知应用」，授权后返回这里重试")}
              </Text>
            ) : null}

            {phase.kind === 'failed' ? (
              <View style={styles.failureBlock}>
                <Text style={styles.failureTitle}>{tr("更新失败")}</Text>
                <Text style={styles.failureText}>{failureMessage(phase.reason)}</Text>
              </View>
            ) : null}
          </ScrollView>

          <View style={styles.actions}>
            {phase.kind === 'idle' && canInstall ? (
              <Pressable
                style={[styles.button, styles.primaryButton]}
                onPress={() => void startDownload()}
                testID="update-install"
              >
                <Text style={styles.primaryLabel}>{tr("下载并安装")}</Text>
              </Pressable>
            ) : null}

            {phase.kind === 'idle' ? (
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
            ) : null}

            {phase.kind === 'downloading' ? (
              <View style={styles.buttons}>
                <Pressable
                  style={[styles.button, styles.secondaryButton]}
                  onPress={cancelDownload}
                  testID="update-cancel"
                >
                  <Text style={styles.secondaryLabel}>{tr("取消")}</Text>
                </Pressable>
              </View>
            ) : null}

            {phase.kind === 'installing' ? (
              <View style={styles.buttons}>
                <Pressable
                  style={[styles.button, styles.secondaryButton]}
                  onPress={onClose}
                  testID="update-later"
                >
                  <Text style={styles.secondaryLabel}>{tr("稍后")}</Text>
                </Pressable>
              </View>
            ) : null}

            {phase.kind === 'needs-permission' || phase.kind === 'failed' ? (
              <View style={styles.buttons}>
                <Pressable
                  style={[styles.button, styles.primaryButton]}
                  onPress={retry}
                  testID="update-retry"
                >
                  <Text style={styles.primaryLabel}>{tr("重试")}</Text>
                </Pressable>
                <Pressable
                  style={[styles.button, styles.secondaryButton]}
                  onPress={onManualDownload}
                  testID="update-manual-download"
                >
                  <Text style={styles.secondaryLabel}>{tr("去 Releases 手动下载")}</Text>
                </Pressable>
              </View>
            ) : null}
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
    progressBlock: { marginTop: 16, gap: 8 },
    progressTrack: {
      height: 6,
      borderRadius: 3,
      backgroundColor: t.bg.subtle,
      overflow: 'hidden',
    },
    progressFill: { height: 6, borderRadius: 3, backgroundColor: t.action.primaryBg },
    progressRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    progressText: { color: t.text.secondary, fontSize: 12.5, lineHeight: 18 },
    statusText: { color: t.text.secondary, fontSize: 12.5, lineHeight: 18, marginTop: 14 },
    progressPercent: { color: t.text.primary, fontSize: 12, fontWeight: '700' },
    failureBlock: {
      backgroundColor: t.semantic.dangerBg,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 8,
      marginTop: 14,
    },
    failureTitle: { color: t.semantic.dangerText, fontSize: 12.5, fontWeight: '700' },
    failureText: { color: t.semantic.dangerText, fontSize: 12, lineHeight: 17, marginTop: 3 },
    actions: { gap: 10, marginTop: 18 },
    buttons: { flexDirection: 'row', gap: 10 },
    button: { flex: 1, alignItems: 'center', borderRadius: 10, paddingVertical: 11 },
    secondaryButton: { backgroundColor: t.action.secondaryBg },
    primaryButton: { backgroundColor: t.action.primaryBg },
    secondaryLabel: { color: t.action.secondaryText, fontSize: 13, fontWeight: '700' },
    primaryLabel: { color: t.action.primaryText, fontSize: 13, fontWeight: '700' },
  });
