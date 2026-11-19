import { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as Application from 'expo-application';


import {
  mapDefaults,
  mapHost,
  mapSetDefault,
  type DefaultsInfo,
  type HostInfo,
} from '../../protocol/runtime';
import { mapPresetList, presetName, type PresetList } from '../../protocol/presets';
import { tapFeedback } from '../haptics';
import { FONT_SCALES, useFontScale, type FontScaleId } from '../fontScale';
import { tr, languageOptions, useLanguage, type Language } from '../../i18n';
import { useThemedStyles } from '../theme';
import type { Palette } from '../../theme/tokens';
import type { GatewayClient } from '../../transport/gateway-client';
import { checkForUpdate, parseBuildVersion } from '../../update/checker';
import { evaluateUpdate, type LatestManifest, type UpdateEvaluation } from '../../update/manifest';
import { loadUpdateState } from '../../storage/update-state';
import { checkedAgo } from '../update/UpdateSheet';

/**
 * 宿主信息与全局默认（PROTOCOL.md §10/§12）。
 *
 * - host：版本 / 工作目录 / 默认模型 / 挂载会话数 / 能否打开路径
 * - defaults：默认 Agent 预设、默认权限及可选项
 * - set-default：修改全局默认（写操作，走 control 连接更稳）
 */

export interface UpdateAvailablePayload {
  manifest: LatestManifest;
  evaluation: UpdateEvaluation;
  checkedAt: number;
}

interface Props {
  control: GatewayClient;
  onClose: () => void;
  /** hello.protocol；未配对时为 undefined，门禁只会给弱警告。 */
  protocol?: number;
  /** 手动检查发现新版本：由 App 挂载全局 UpdateSheet。 */
  onUpdateAvailable?: (payload: UpdateAvailablePayload) => void;
}

/** failed 的机器码 → 用户可读句子；未知码保留原码便于反馈。 */
function updateFailureText(error: string): string {
  if (error === 'timeout') return tr("检查更新超时，请稍后再试");
  if (error === 'network') return tr("检查更新失败：网络不可用");
  const status = /^http-(\d{3})$/.exec(error)?.[1];
  if (status) return tr("检查更新失败：服务器返回 {0}", [status]);
  if (error === 'invalid-manifest') return tr("检查更新失败：更新信息格式不正确");
  return tr("检查更新失败：{0}", [error]);
}

export function HostInfoSheet({ control, onClose, protocol, onUpdateAvailable }: Props) {
  const styles = useThemedStyles(makeStyles);
  const [host, setHost] = useState<HostInfo | null>(null);
  const [defaults, setDefaults] = useState<DefaultsInfo | null>(null);
  const [presets, setPresets] = useState<PresetList | null>(null);
  /** 内联选择模式：Android 上 Modal 套 Modal 不显示，选择列表就在本抽屉内切换。 */
  const [picking, setPicking] = useState<null | 'preset' | 'permission' | 'font' | 'language'>(null);
  const { id: fontId, setId: setFontId } = useFontScale();
  const { language, setLanguage } = useLanguage();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  /** 更新检查：加载态、最近检查时间与「有新版本」角标。 */
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateNotice, setUpdateNotice] = useState<string | null>(null);
  const [lastCheckAt, setLastCheckAt] = useState<number | null>(null);
  const [hasUpdate, setHasUpdate] = useState(false);

  const reload = useCallback(() => {
    control.send({ type: 'host' });
    control.send({ type: 'defaults' });
    control.send({ type: 'agent-presets' });
  }, [control]);

  useEffect(() => {
    reload();
    const off = control.onFrame((frame) => {
      const kind = (frame as { kind?: string }).kind;
      if (kind === 'host') {
        setHost(mapHost(frame));
      } else if (kind === 'defaults') {
        setDefaults(mapDefaults(frame));
      } else if (kind === 'agent-presets') {
        setPresets(mapPresetList(frame));
      } else if (kind === 'set-default') {
        const result = mapSetDefault(frame);
        setBusy(false);
        if (!result) return;
        if (result.applied) {
          tapFeedback();
          setNotice(tr("已保存"));
          reload();
        } else {
          setNotice(tr("保存失败"));
        }
      } else if (kind === 'error') {
        setBusy(false);
        const frameRecord = frame as { requestType?: string; message?: string };
        if (frameRecord.requestType === 'set-default') {
          setNotice(frameRecord.message ?? tr("保存失败"));
        }
      }
    });
    return off;
  }, [control, reload]);

  const setDefault = useCallback(
    (target: 'agent-preset' | 'permission', value: string) => {
      setBusy(true);
      setNotice(null);
      control.send({ type: 'set-default', target, value });
    },
    [control],
  );

  /** 打开抽屉时回显上次自动检查的时间与「有新版本」角标（读缓存，不发请求）。 */
  useEffect(() => {
    let alive = true;
    void loadUpdateState().then((state) => {
      if (!alive) return;
      setLastCheckAt(state.lastCheckAt);
      const versionCode = parseBuildVersion(Application.nativeBuildVersion);
      if (state.cachedManifest !== null && versionCode !== null) {
        const evaluation = evaluateUpdate({ versionCode, protocol }, state.cachedManifest);
        setHasUpdate(evaluation.kind === 'update-available');
      }
    });
    return () => {
      alive = false;
    };
  }, [protocol]);

  /**
   * 手动检查：绕过节流，成功/失败都就地给反馈。
   * 有更新交给 App 的全局 UpdateSheet（本抽屉在 Android 上会被 Modal 盖住，
   * 内嵌第二层 Modal 不显示——与文件顶部 picking 的注释同因）。
   */
  const runUpdateCheck = useCallback(async () => {
    const versionCode = parseBuildVersion(Application.nativeBuildVersion);
    if (versionCode === null) {
      setUpdateNotice(tr("无法读取本机版本号"));
      return;
    }
    setCheckingUpdate(true);
    setUpdateNotice(null);
    try {
      const result = await checkForUpdate({ versionCode, protocol }, { manual: true });
      if (result.kind === 'checked' || result.kind === 'cached') {
        setLastCheckAt(result.checkedAt);
        setHasUpdate(result.evaluation.kind === 'update-available');
        if (result.kind === 'checked' && result.evaluation.kind === 'update-available') {
          tapFeedback();
          if (onUpdateAvailable) {
            onUpdateAvailable({
              manifest: result.manifest,
              evaluation: result.evaluation,
              checkedAt: result.checkedAt,
            });
            return;
          }
          // 没有全局弹窗可挂（非 Android）：就地说明，别让点击看起来没反应。
          setUpdateNotice(tr("发现新版本 {0}", [result.manifest.tag]));
          return;
        }
        setUpdateNotice(tr("已是最新版本"));
        return;
      }
      if (result.kind === 'invalid') {
        setUpdateNotice(tr("检查更新失败：更新信息格式不正确"));
        return;
      }
      // 手动失败才提示；自动检查失败在 App 侧静默。
      setUpdateNotice(updateFailureText(result.error));
    } catch {
      setUpdateNotice(tr("检查更新失败"));
    } finally {
      setCheckingUpdate(false);
    }
  }, [onUpdateAvailable, protocol]);

  const presetActions = (presets?.presets ?? []).map((preset) => ({
    id: preset.id,
    label:
      (defaults?.agentPresetDefault === preset.id ? '✓ ' : '') + (preset.name || preset.id),
    hint: preset.description,
  }));

  const permissionActions = (defaults?.permissionDefaultOptions ?? []).map((option) => ({
    id: option.value,
    label: (defaults?.permissionDefault === option.value ? '✓ ' : '') + option.name,
    hint: option.description,
  }));

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => undefined}>
          <View style={styles.titleRow}>
            <Text style={styles.title} maxFontSizeMultiplier={1.3}>
              
              {tr("宿主与全局默认")}
            </Text>
            <Pressable hitSlop={10} onPress={onClose}>
              <Text style={styles.close}>×</Text>
            </Pressable>
          </View>

          <ScrollView bounces={false}>
            {/* 语言与字号一样走行内展开，且放在宿主信息之前：离线时也要能改本地设置。 */}
            <Text style={styles.section}>{tr("界面")}</Text>
            {picking === 'language' ? (
              <View style={styles.fontPicker}>
                {languageOptions().map((option) => (
                  <TouchableOpacity
                    key={option.id}
                    style={styles.fontRow}
                    onPress={() => {
                      tapFeedback();
                      setLanguage(option.id as Language);
                      setPicking(null);
                    }}
                  >
                    <Text style={styles.fontLabel}>
                      {(language === option.id ? '✓ ' : '') + option.label}
                    </Text>
                    <Text style={styles.fontHint}>{option.hint}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}
            <TouchableOpacity style={styles.row} onPress={() => setPicking('language')}>
              <View style={styles.rowBody}>
                <Text style={styles.rowLabel}>{tr("语言")}</Text>
                <Text style={styles.rowValue}>
                  {languageOptions().find((option) => option.id === language)?.label ?? tr("中文")}
                </Text>
              </View>
              <Text style={styles.rowAction}>{tr("修改")}</Text>
            </TouchableOpacity>

            <Text style={styles.section}>{tr("检查更新")}</Text>
            <TouchableOpacity
              style={styles.row}
              disabled={checkingUpdate}
              onPress={() => void runUpdateCheck()}
            >
              <View style={styles.rowBody}>
                <Text style={styles.rowLabel}>
                  {tr("当前版本 {0}", [
                    [Application.nativeApplicationVersion, Application.nativeBuildVersion]
                      .filter(Boolean)
                      .join(' · ') || tr("未知"),
                  ])}
                </Text>
                <Text style={styles.rowValue}>
                  {lastCheckAt === null
                    ? tr("从未检查")
                    : tr("最近检查：{0}", [checkedAgo(lastCheckAt)])}
                </Text>
              </View>
              <Text style={[styles.rowAction, hasUpdate ? styles.rowActionAlert : null]}>
                {checkingUpdate ? tr("检查中…") : hasUpdate ? tr("有新版本") : tr("检查")}
              </Text>
            </TouchableOpacity>

            <Text style={styles.section}>{tr("宿主")}</Text>
            {host === null ? (
              <Text style={styles.empty}>{tr("读取中…")}</Text>
            ) : (
              <>
                <Fact label={tr("版本")} value={host.version} />
                <Fact label={tr("工作目录")} value={host.cwd} mono />
                <Fact
                  label={tr("默认模型")}
                  value={[host.provider, host.model].filter(Boolean).join(' · ') || undefined}
                />
                <Fact
                  label={tr("挂载会话")}
                  value={host.attachedSessions !== undefined ? String(host.attachedSessions) : undefined}
                />
                <Fact
                  label={tr("可打开路径")}
                  value={host.canOpenPath === undefined ? undefined : host.canOpenPath ? tr("是") : tr("否")}
                />
              </>
            )}

            {updateNotice ? <Text style={styles.notice}>{updateNotice}</Text> : null}
            {notice ? <Text style={styles.notice}>{notice}</Text> : null}

            <Text style={styles.section}>{tr("全局默认（新会话生效）")}</Text>
            {defaults === null ? (
              <Text style={styles.empty}>{tr("读取中…")}</Text>
            ) : (
              <>
                {/* onPress 不用 onPressIn：手指一落下就触发的话，
                    在列表上滑动会顺手把选择器打开。禁用态也不再进选择器。 */}
                <TouchableOpacity
                  style={styles.row}
                  disabled={!defaults.modeSelectionEnabled}
                  onPress={() => setPicking('preset')}
                >
                  <View style={styles.rowBody}>
                    <Text style={styles.rowLabel}>{tr("默认 Agent 预设")}</Text>
                    <Text style={styles.rowValue}>
                      {presets ? presetName(presets.presets, defaults.agentPresetDefault) : '—'}
                    </Text>
                  </View>
                  <Text style={styles.rowAction}>
                    {defaults.modeSelectionEnabled ? (busy ? tr("保存中…") : tr("修改")) : tr("已禁用")}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.row}
                  onPress={() => setPicking('permission')}
                >
                  <View style={styles.rowBody}>
                    <Text style={styles.rowLabel}>{tr("默认权限")}</Text>
                    <Text style={styles.rowValue}>
                      {defaults.permissionDefaultOptions.find(
                        (option) => option.value === defaults.permissionDefault,
                      )?.name ?? defaults.permissionDefault ?? '—'}
                    </Text>
                  </View>
                  <Text style={styles.rowAction}>{busy ? tr("保存中…") : tr("修改")}</Text>
                </TouchableOpacity>
                {picking === 'font' ? (
                  <View style={styles.fontPicker}>
                    {FONT_SCALES.map((item) => (
                      <TouchableOpacity
                        key={item.id}
                        style={styles.fontRow}
                        onPress={() => {
                          tapFeedback();
                          setFontId(item.id as FontScaleId);
                          setPicking(null);
                        }}
                      >
                        <Text style={styles.fontLabel}>
                          {(item.id === fontId ? '✓ ' : '') + item.label}
                        </Text>
                        <Text style={styles.fontHint}>{item.hint}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                ) : null}
                <TouchableOpacity
                  style={styles.row}
                  onPress={() => setPicking('font')}
                >
                  <View style={styles.rowBody}>
                    <Text style={styles.rowLabel}>{tr("全局字号")}</Text>
                    <Text style={styles.rowValue}>
                      {FONT_SCALES.find((item) => item.id === fontId)?.label ?? tr("标准")}
                    </Text>
                  </View>
                  <Text style={styles.rowAction}>{tr("修改")}</Text>
                </TouchableOpacity>
              </>
            )}
          </ScrollView>

          {/* 字号走行内展开（174 行那个 fontPicker），不进这块底部通用选择区；
              写成 picking !== null 会让点「全局字号」时同时弹出一个「默认权限」面板，
              点中任意一项就会往网关写全局 set-default。 */}
          {picking === 'preset' || picking === 'permission' ? (
            <View style={styles.pickerWrap}>
              <View style={styles.pickerHead}>
                <Text style={styles.pickerTitle}>
                  {picking === 'preset' ? tr("默认 Agent 预设") : tr("默认权限")}
                </Text>
                <Pressable hitSlop={10} onPress={() => setPicking(null)}>
                  <Text style={styles.pickerBack}>{tr("返回")}</Text>
                </Pressable>
              </View>
              <ScrollView style={styles.pickerList} bounces={false}>
                {(picking === 'preset' ? presetActions : permissionActions).map((option) => (
                  <Pressable
                    key={option.id}
                    style={styles.pickerRow}
                    disabled={busy}
                    onPress={() => {
                      setPicking(null);
                      setDefault(picking === 'preset' ? 'agent-preset' : 'permission', option.id);
                    }}
                  >
                    <View style={styles.pickerBody}>
                      <Text style={styles.pickerLabel}>{option.label}</Text>
                      {option.hint ? (
                        <Text style={styles.pickerHint} numberOfLines={2}>
                          {option.hint}
                        </Text>
                      ) : null}
                    </View>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          ) : null}

          <Text style={styles.footnote}>
            
            {tr("修改只影响主机侧新建会话的默认值；当前会话的模型/权限在会话页底部切换。")}
          </Text>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Fact({ label, value, mono }: { label: string; value?: string; mono?: boolean }) {
  const styles = useThemedStyles(makeStyles);
  if (!value) return null;
  return (
    <View style={styles.factRow}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={[styles.factValue, mono ? styles.factMono : null]} numberOfLines={2}>
        {value}
      </Text>
    </View>
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
    section: {
      color: t.text.secondary,
      fontSize: 12,
      fontWeight: '700',
      marginTop: 14,
      marginBottom: 6,
    },
    factRow: { flexDirection: 'row', gap: 10, paddingVertical: 4 },
    factLabel: { width: 66, color: t.text.muted, fontSize: 11.5 },
    factValue: { flex: 1, color: t.text.secondary, fontSize: 11.5 },
    factMono: { fontVariant: ['tabular-nums'] },
    empty: { color: t.text.muted, fontSize: 12, paddingVertical: 8 },
    notice: { color: t.semantic.gateAmberText, fontSize: 12, marginTop: 10 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.border.subtle,
    },
    rowBody: { flex: 1, minWidth: 0 },
    rowLabel: { color: t.text.primary, fontSize: 13, fontWeight: '600' },
    rowValue: { color: t.text.muted, fontSize: 11, marginTop: 2 },
    rowAction: { color: t.text.secondary, fontSize: 12, fontWeight: '700' },
    rowActionAlert: { color: t.semantic.gateAmberText },
    footnote: { color: t.text.muted, fontSize: 10.5, lineHeight: 15, marginTop: 14 },
    fontPicker: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.border.default,
      marginTop: 8,
      paddingTop: 6,
    },
    fontRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 8,
    },
    fontLabel: { color: t.text.primary, fontSize: 13, fontWeight: '600', width: 70 },
    fontHint: { color: t.text.muted, fontSize: 11 },
    pickerWrap: {
      marginTop: 14,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.border.default,
      paddingTop: 10,
      maxHeight: 300,
    },
    pickerHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 4,
    },
    pickerTitle: { color: t.text.primary, fontSize: 14, fontWeight: '700' },
    pickerBack: { color: t.text.secondary, fontSize: 12, fontWeight: '700' },
    pickerList: { maxHeight: 260 },
    pickerRow: {
      paddingVertical: 9,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.border.subtle,
    },
    pickerBody: { gap: 2 },
    pickerLabel: { color: t.text.primary, fontSize: 13 },
    pickerHint: { color: t.text.muted, fontSize: 10.5, lineHeight: 14 },
  });
