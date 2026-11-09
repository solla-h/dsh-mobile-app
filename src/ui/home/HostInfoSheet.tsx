import { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';


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
import { useThemedStyles } from '../theme';
import type { Palette } from '../../theme/tokens';
import type { GatewayClient } from '../../transport/gateway-client';

/**
 * 宿主信息与全局默认（PROTOCOL.md §10/§12）。
 *
 * - host：版本 / 工作目录 / 默认模型 / 挂载会话数 / 能否打开路径
 * - defaults：默认 Agent 预设、默认权限及可选项
 * - set-default：修改全局默认（写操作，走 control 连接更稳）
 */

interface Props {
  control: GatewayClient;
  onClose: () => void;
}

export function HostInfoSheet({ control, onClose }: Props) {
  const styles = useThemedStyles(makeStyles);
  const [host, setHost] = useState<HostInfo | null>(null);
  const [defaults, setDefaults] = useState<DefaultsInfo | null>(null);
  const [presets, setPresets] = useState<PresetList | null>(null);
  /** 内联选择模式：Android 上 Modal 套 Modal 不显示，选择列表就在本抽屉内切换。 */
  const [picking, setPicking] = useState<null | 'preset' | 'permission' | 'font'>(null);
  const { id: fontId, setId: setFontId } = useFontScale();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

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
          setNotice('已保存');
          reload();
        } else {
          setNotice('保存失败');
        }
      } else if (kind === 'error') {
        setBusy(false);
        const frameRecord = frame as { requestType?: string; message?: string };
        if (frameRecord.requestType === 'set-default') {
          setNotice(frameRecord.message ?? '保存失败');
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
              宿主与全局默认
            </Text>
            <Pressable hitSlop={10} onPress={onClose}>
              <Text style={styles.close}>×</Text>
            </Pressable>
          </View>

          <ScrollView bounces={false}>
            <Text style={styles.section}>宿主</Text>
            {host === null ? (
              <Text style={styles.empty}>读取中…</Text>
            ) : (
              <>
                <Fact label="版本" value={host.version} />
                <Fact label="工作目录" value={host.cwd} mono />
                <Fact
                  label="默认模型"
                  value={[host.provider, host.model].filter(Boolean).join(' · ') || undefined}
                />
                <Fact
                  label="挂载会话"
                  value={host.attachedSessions !== undefined ? String(host.attachedSessions) : undefined}
                />
                <Fact
                  label="可打开路径"
                  value={host.canOpenPath === undefined ? undefined : host.canOpenPath ? '是' : '否'}
                />
              </>
            )}

            {notice ? <Text style={styles.notice}>{notice}</Text> : null}

            <Text style={styles.section}>全局默认（新会话生效）</Text>
            {defaults === null ? (
              <Text style={styles.empty}>读取中…</Text>
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
                    <Text style={styles.rowLabel}>默认 Agent 预设</Text>
                    <Text style={styles.rowValue}>
                      {presets ? presetName(presets.presets, defaults.agentPresetDefault) : '—'}
                    </Text>
                  </View>
                  <Text style={styles.rowAction}>
                    {defaults.modeSelectionEnabled ? (busy ? '保存中…' : '修改') : '已禁用'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.row}
                  onPress={() => setPicking('permission')}
                >
                  <View style={styles.rowBody}>
                    <Text style={styles.rowLabel}>默认权限</Text>
                    <Text style={styles.rowValue}>
                      {defaults.permissionDefaultOptions.find(
                        (option) => option.value === defaults.permissionDefault,
                      )?.name ?? defaults.permissionDefault ?? '—'}
                    </Text>
                  </View>
                  <Text style={styles.rowAction}>{busy ? '保存中…' : '修改'}</Text>
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
                    <Text style={styles.rowLabel}>全局字号</Text>
                    <Text style={styles.rowValue}>
                      {FONT_SCALES.find((item) => item.id === fontId)?.label ?? '标准'}
                    </Text>
                  </View>
                  <Text style={styles.rowAction}>修改</Text>
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
                  {picking === 'preset' ? '默认 Agent 预设' : '默认权限'}
                </Text>
                <Pressable hitSlop={10} onPress={() => setPicking(null)}>
                  <Text style={styles.pickerBack}>返回</Text>
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
            修改只影响主机侧新建会话的默认值；当前会话的模型/权限在会话页底部切换。
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
