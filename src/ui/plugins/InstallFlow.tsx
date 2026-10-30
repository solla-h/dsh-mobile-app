import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { describeApplication, type PluginRegistries } from '../../protocol/plugins';
import { tapFeedback } from '../haptics';
import { useTheme, useThemedStyles } from '../theme';
import type { Palette } from '../../theme/tokens';
import type { PluginManager } from './usePluginManager';

/**
 * 添加插件安装流：registries → inspect → 用户确认 → install → 进度/日志 → 结果。
 *
 * 协议约束：
 * - inspect 的 refused 是带内结果，不是错误，展示原因后停在检查步；
 * - 安装中同一连接会推 plugin-install-state / plugin-install-log；
 * - 取消用 plugin-install-cancel，installId = 安装请求的 requestId；
 * - pendingBuilds 非空 → 必须用户明确批准这些具体包的构建脚本，再带 approvedBuilds 重装；
 *   切勿自动批准；
 * - 断线后不要盲目重装，用 installStatus(installId) 查询运行中的安装。
 */

interface Props {
  manager: PluginManager;
  writable: boolean;
  onClose: () => void;
}

type Step = 'input' | 'inspect' | 'installing' | 'done';

export function InstallFlow({ manager, writable, onClose }: Props) {
  const styles = useThemedStyles(makeStyles);
  const t = useTheme();
  // 面板重开时如果还有没结束的安装，直接落在进度页（初值判断，不走 effect）。
  const [step, setStep] = useState<Step>(
    manager.installProgress && manager.installProgress.finishedAt === undefined
      ? 'installing'
      : 'input',
  );
  const [spec, setSpec] = useState('');
  const [registries, setRegistries] = useState<PluginRegistries | null>(null);
  const [registryChoice, setRegistryChoice] = useState<string | null | undefined>(undefined);
  const [notice, setNotice] = useState<string | null>(null);
  const [inspectResult, setInspectResult] = useState<{ status: string; detail: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [logsOpen, setLogsOpen] = useState(true);
  const installIdRef = useRef<string | null>(null);
  const progress = manager.installProgress;

  useEffect(() => {
    // 打开就拉一次 registry 列表，给来源选择。
    manager
      .registries()
      .then((result) => {
        setRegistries(result);
        // 默认跟随宿主当前配置（undefined = 不传 registry）。
        setRegistryChoice(result.registry === undefined ? undefined : result.registry);
      })
      .catch((err: unknown) =>
        setNotice(err instanceof Error ? err.message : String(err)),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 安装请求发出后记录 installId（requestId 在 hook 内部生成，这里从进度帧回填）。
  useEffect(() => {
    if (progress && progress.requestId && installIdRef.current === null) {
      installIdRef.current = progress.requestId;
    }
  }, [progress]);
  // 安装完成是派生状态：进度帧带 finishedAt 就直接落在 done，不必再存一份。
  const effectiveStep: Step = progress?.finishedAt && step === 'installing' ? 'done' : step;

  const doInspect = useCallback(() => {
    const target = spec.trim();
    if (!target) return;
    setBusy(true);
    setNotice(null);
    manager
      .inspect(target, registryChoice)
      .then((inspection) => {
        setBusy(false);
        const detail = summarize(inspection.raw);
        setInspectResult({ status: inspection.status, detail });
        setStep('inspect');
      })
      .catch((err: unknown) => {
        setBusy(false);
        setNotice(err instanceof Error ? err.message : String(err));
      });
  }, [manager, spec, registryChoice]);

  const doInstallRef = useRef<(approvedBuilds?: string[]) => void>(() => undefined);
  const doInstall = useCallback(
    (approvedBuilds?: string[]) => {
      const target = spec.trim();
      if (!target) return;
      setBusy(true);
      setNotice(null);
      setStep('installing');
      manager
        .install(target, { enabled: true, registry: registryChoice, approvedBuilds })
        .then((result) => {
          setBusy(false);
          const note = describeApplication(result);
          if ((result.pendingBuilds ?? []).length > 0) {
            Alert.alert(
              '需要批准构建脚本',
              '这些包要在安装时执行构建脚本：\n' + (result.pendingBuilds ?? []).join('\n'),
              [
                { text: '取消', style: 'cancel' },
                {
                  text: '批准并重装',
                  onPress: () => doInstallRef.current(result.pendingBuilds ?? []),
                },
              ],
              { cancelable: false },
            );
          } else {
            setNotice(note ?? '安装完成');
            void manager.refresh();
          }
        })
        .catch((err: unknown) => {
          setBusy(false);
          setNotice('安装失败：' + (err instanceof Error ? err.message : String(err)));
        });
    },
    [manager, spec, registryChoice],
  );
  useEffect(() => {
    doInstallRef.current = doInstall;
  }, [doInstall]);

  const doCancel = useCallback(() => {
    const installId = installIdRef.current;
    if (!installId) {
      Alert.alert('无法取消', '还没有拿到安装 ID。');
      return;
    }
    manager
      .cancelInstall(installId)
      .then(() => setNotice('已发出取消信号'))
      .catch((err: unknown) =>
        setNotice('取消失败：' + (err instanceof Error ? err.message : String(err))),
      );
  }, [manager]);

  const registryOptions: { key: string; label: string; value: string | null | undefined }[] = [
    { key: 'host', label: '跟随宿主配置', value: undefined },
  ];
  if (registries?.registry) {
    registryOptions.push({ key: 'current', label: registries.registry, value: registries.registry });
  }
  for (const fallback of registries?.fallbackRegistries ?? []) {
    registryOptions.push({ key: fallback, label: fallback, value: fallback });
  }

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={step === 'installing' ? () => undefined : onClose}>
        <Pressable style={styles.sheet} onPress={() => undefined}>
          <View style={styles.titleRow}>
            <Text style={styles.title} maxFontSizeMultiplier={1.3}>
              添加插件
            </Text>
            {effectiveStep === 'installing' ? null : (
              <Pressable hitSlop={10} onPress={onClose}>
                <Text style={styles.close}>×</Text>
              </Pressable>
            )}
          </View>
          <Text style={styles.hint}>
            安装的是已有插件包（包名 / 本地路径 / Git / tarball），不是创建源码工程。
          </Text>

          {step === 'input' || step === 'inspect' ? (
            <>
              <TextInput
                style={styles.input}
                value={spec}
                onChangeText={setSpec}
                placeholder="例如 @scope/dsh-plugin-xxx 或本地绝对路径"
                placeholderTextColor={t.text.muted}
                autoCapitalize="none"
                autoCorrect={false}
                editable={writable && !busy}
              />

              {registryOptions.length > 1 ? (
                <View style={styles.registryWrap}>
                  <Text style={styles.registryLabel}>来源</Text>
                  <View style={styles.enumRow}>
                    {registryOptions.map((option) => {
                      const selected = registryChoice === option.value;
                      return (
                        <Pressable
                          key={option.key}
                          style={[styles.enumChip, selected ? styles.enumChipOn : null]}
                          onPress={() => setRegistryChoice(option.value)}
                        >
                          <Text
                            style={[styles.enumText, selected ? styles.enumTextOn : null]}
                            numberOfLines={1}
                          >
                            {option.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ) : null}

              {step === 'inspect' && inspectResult ? (
                <View style={styles.inspectCard}>
                  <Text
                    style={[
                      styles.inspectStatus,
                      inspectResult.status === 'accepted'
                        ? styles.inspectAccepted
                        : styles.inspectRefused,
                    ]}
                  >
                    {inspectResult.status === 'accepted' ? '检查通过' : '检查拒绝'}
                  </Text>
                  {inspectResult.detail ? (
                    <Text style={styles.inspectDetail}>{inspectResult.detail}</Text>
                  ) : null}
                </View>
              ) : null}

              {notice ? <Text style={styles.notice}>{notice}</Text> : null}

              <View style={styles.footer}>
                <Pressable style={[styles.button, styles.buttonNeutral]} onPress={onClose}>
                  <Text style={styles.buttonText}>关闭</Text>
                </Pressable>
                {step === 'input' ? (
                  <Pressable
                    style={[styles.button, styles.buttonPrimary, (!writable || !spec.trim() || busy) && styles.buttonDisabled]}
                    disabled={!writable || !spec.trim() || busy}
                    onPress={doInspect}
                  >
                    <Text style={[styles.buttonText, styles.buttonTextPrimary]}>
                      {busy ? '检查中…' : '检查'}
                    </Text>
                  </Pressable>
                ) : (
                  <>
                    <Pressable
                      style={[styles.button, styles.buttonNeutral]}
                      onPress={() => setStep('input')}
                    >
                      <Text style={styles.buttonText}>返回</Text>
                    </Pressable>
                    <Pressable
                      style={[
                        styles.button,
                        styles.buttonPrimary,
                        (!writable || busy || inspectResult?.status !== 'accepted') && styles.buttonDisabled,
                      ]}
                      disabled={!writable || busy || inspectResult?.status !== 'accepted'}
                      onPress={() => {
                        tapFeedback();
                        doInstall();
                      }}
                    >
                      <Text style={[styles.buttonText, styles.buttonTextPrimary]}>安装</Text>
                    </Pressable>
                  </>
                )}
              </View>
            </>
          ) : (
            <>
              <View style={styles.progressCard}>
                <View style={styles.progressHead}>
                  <View style={styles.progressDot} />
                  <Text style={styles.progressPhase}>
                    {progress?.attempt?.total
                      ? `阶段 ${progress.phase} · 第 ${progress.attempt.index ?? 1}/${progress.attempt.total} 个来源`
                      : `阶段 ${progress?.phase ?? 'installing'}`}
                  </Text>
                </View>
                {notice ? <Text style={styles.notice}>{notice}</Text> : null}
                <Pressable hitSlop={6} onPress={() => setLogsOpen((v) => !v)}>
                  <Text style={styles.logsToggle}>{logsOpen ? '收起日志' : '展开日志'}</Text>
                </Pressable>
                {logsOpen ? (
                  <ScrollView style={styles.logs} nestedScrollEnabled>
                    {(progress?.logs ?? []).slice(-40).map((log, index) => (
                      <Text key={index} style={styles.logLine} numberOfLines={4}>
                        {log.stream === 'stderr' ? '[err] ' : ''}
                        {log.text ?? ''}
                        {log.exitCode !== undefined ? ` (exit ${log.exitCode})` : ''}
                      </Text>
                    ))}
                    {(progress?.logs ?? []).length === 0 ? (
                      <Text style={styles.logLine}>等待输出…</Text>
                    ) : null}
                  </ScrollView>
                ) : null}
              </View>
              <View style={styles.footer}>
                {effectiveStep === 'installing' ? (
                  <>
                    <Pressable style={[styles.button, styles.buttonDanger]} onPress={doCancel}>
                      <Text style={[styles.buttonText, styles.buttonTextDanger]}>取消安装</Text>
                    </Pressable>
                    <Pressable style={[styles.button, styles.buttonNeutral]} onPress={onClose}>
                      <Text style={styles.buttonText}>后台等待</Text>
                    </Pressable>
                  </>
                ) : (
                  <>
                    <Pressable style={[styles.button, styles.buttonNeutral]} onPress={onClose}>
                      <Text style={styles.buttonText}>完成</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.button, styles.buttonPrimary]}
                      onPress={() => setStep('input')}
                    >
                      <Text style={[styles.buttonText, styles.buttonTextPrimary]}>再装一个</Text>
                    </Pressable>
                  </>
                )}
              </View>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** 检查结果摘要：不猜字段，有什么展示什么。 */
function summarize(raw: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const key of ['name', 'version', 'reason', 'message', 'detail']) {
    const value = raw[key];
    if (typeof value === 'string' && value.trim()) parts.push(key + ': ' + value.trim());
  }
  return parts.join(' · ');
}

const makeStyles = (t: Palette) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(20, 20, 18, 0.5)',
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: t.bg.elevatedAnswer,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      paddingHorizontal: 18,
      paddingTop: 16,
      paddingBottom: 24,
      maxHeight: '88%',
    },
    titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    title: { color: t.text.primary, fontSize: 17, fontWeight: '700', flex: 1 },
    close: { color: t.text.muted, fontSize: 22, paddingHorizontal: 6 },
    hint: { color: t.text.muted, fontSize: 11, lineHeight: 15, marginTop: 4 },
    input: {
      backgroundColor: t.bg.subtle,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border.default,
      color: t.text.primary,
      fontSize: 13,
      paddingHorizontal: 10,
      paddingVertical: 9,
      marginTop: 12,
    },
    registryWrap: { marginTop: 10, gap: 6 },
    registryLabel: { color: t.text.secondary, fontSize: 11.5, fontWeight: '700' },
    enumRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    enumChip: {
      borderRadius: 9,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border.default,
      backgroundColor: t.bg.subtle,
      paddingHorizontal: 10,
      paddingVertical: 6,
    },
    enumChipOn: { backgroundColor: t.action.primaryBg, borderColor: t.action.primaryBg },
    enumText: { color: t.text.secondary, fontSize: 11.5 },
    enumTextOn: { color: t.action.primaryText, fontWeight: '700' },
    inspectCard: {
      marginTop: 12,
      backgroundColor: t.bg.subtle,
      borderRadius: 12,
      padding: 12,
      gap: 4,
    },
    inspectStatus: { fontSize: 12.5, fontWeight: '700' },
    inspectAccepted: { color: t.semantic.diffAddText },
    inspectRefused: { color: t.semantic.dangerText },
    inspectDetail: { color: t.text.secondary, fontSize: 11.5, lineHeight: 16 },
    notice: { color: t.text.secondary, fontSize: 12, lineHeight: 17, marginTop: 10 },
    progressCard: {
      marginTop: 12,
      backgroundColor: t.bg.subtle,
      borderRadius: 12,
      padding: 12,
      gap: 8,
    },
    progressHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    progressDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: t.semantic.live,
    },
    progressPhase: { flex: 1, color: t.text.primary, fontSize: 12.5, fontWeight: '600' },
    logsToggle: { color: t.text.secondary, fontSize: 11.5, fontWeight: '700' },
    logs: { maxHeight: 180, backgroundColor: t.bg.canvas, borderRadius: 8, padding: 8 },
    logLine: { color: t.text.secondary, fontSize: 10, lineHeight: 14 },
    footer: { flexDirection: 'row', gap: 10, marginTop: 14 },
    button: {
      flex: 1,
      borderRadius: 12,
      paddingVertical: 11,
      alignItems: 'center',
    },
    buttonNeutral: { backgroundColor: t.bg.subtle, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border.default },
    buttonPrimary: { backgroundColor: t.action.primaryBg },
    buttonDanger: { backgroundColor: t.semantic.dangerBg },
    buttonDisabled: { opacity: 0.45 },
    buttonText: { color: t.text.secondary, fontSize: 13, fontWeight: '700' },
    buttonTextPrimary: { color: t.action.primaryText },
    buttonTextDanger: { color: t.semantic.dangerText },
  });
