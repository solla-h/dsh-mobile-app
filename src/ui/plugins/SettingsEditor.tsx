import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import {
  currentValue,
  schemaFields,
  type PluginOp,
  type SchemaField,
  type SettingNamespace,
} from '../../protocol/plugins';
import { tapFeedback } from '../haptics';
import { useTheme, useThemedStyles } from '../theme';
import type { Palette } from '../../theme/tokens';
import type { PluginManager } from './usePluginManager';

/**
 * 配置编辑器：按 namespace.schema 渲染表单。
 *
 * 协议约束：
 * - 展示 value / base / user 三层中实际生效的值；secrets 只显示「已设置」，永不回传明文；
 * - 保存只提交改动路径（set/unset），带读取时的 expectedRevision 做乐观锁；
 * - 版本冲突或远端改动（plugin-settings-changed）时重读，让用户决定怎么合并。
 */

interface Props {
  manager: PluginManager;
  ns: string;
  onClose: () => void;
}

interface FieldState {
  text: string | null;
  changed: boolean;
  cleared: boolean; // unset 过的字段
}

export function SettingsEditor({ manager, ns, onClose }: Props) {
  const styles = useThemedStyles(makeStyles);
  const t = useTheme();
  const [namespace, setNamespace] = useState<SettingNamespace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, FieldState>>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [item] = await manager.loadSettings(ns);
      setNamespace(item ?? null);
      setDraft({});
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [manager, ns]);

  useEffect(() => {
    const kick = setTimeout(() => void load(), 0);
    return () => clearTimeout(kick);
  }, [load]);

  // 编辑期间远端改了这个节：提示重读，避免用旧 revision 保存被 CAS 拒掉。
  useEffect(() => {
    if (manager.settingsChanged && manager.settingsChanged.ns === ns) {
      Alert.alert('远端已更新', '这个配置节刚在别处被修改，已为你重新读取。', [
        { text: '好', onPress: () => void load() },
      ]);
      manager.clearSettingsChanged();
    }
  }, [manager, ns, load]);

  const fields = useMemo(() => (namespace ? schemaFields(namespace) : []), [namespace]);

  const stateOf = (field: SchemaField): FieldState =>
    draft[field.path.join('.')] ?? { text: null, changed: false, cleared: false };

  const baseValue = (field: SchemaField): unknown =>
    namespace ? currentValue(namespace, field.path) : undefined;

  const displayValue = (field: SchemaField): string => {
    const state = stateOf(field);
    if (state.cleared) return '';
    if (state.text !== null) return state.text;
    const value = baseValue(field);
    if (value === undefined) return '';
    return field.type === 'json' ? JSON.stringify(value, null, 2) : String(value);
  };

  const setField = (field: SchemaField, text: string | null) => {
    setDraft((current) => ({
      ...current,
      [field.path.join('.')]: { text, changed: true, cleared: false },
    }));
  };

  const clearField = (field: SchemaField) => {
    setDraft((current) => ({
      ...current,
      [field.path.join('.')]: { text: null, changed: true, cleared: true },
    }));
  };

  const conflict = Boolean(namespace?.revision !== undefined) && manager.settingsChanged !== null;

  const save = () => {
    if (!namespace || namespace.revision === undefined) {
      Alert.alert('无法保存', '配置节缺少 revision，无法安全写入。');
      return;
    }
    const ops: PluginOp[] = [];
    for (const field of fields) {
      const state = stateOf(field);
      if (!state.changed) continue;
      if (state.cleared) {
        ops.push({ op: 'unset', path: field.path });
        continue;
      }
      const raw = state.text ?? '';
      let value: unknown;
      switch (field.type) {
        case 'boolean':
          value = raw === 'true';
          break;
        case 'number': {
          const num = Number(raw);
          if (Number.isNaN(num)) {
            Alert.alert('格式错误', `${field.label} 不是数字`);
            return;
          }
          value = num;
          break;
        }
        case 'json':
          try {
            value = raw.trim() === '' ? {} : JSON.parse(raw);
          } catch {
            Alert.alert('格式错误', `${field.label} 不是合法 JSON`);
            return;
          }
          break;
        default:
          value = raw;
      }
      ops.push({ op: 'set', path: field.path, value });
    }
    if (ops.length === 0) {
      onClose();
      return;
    }
    setSaving(true);
    void manager
      .saveSettings(ns, namespace.revision, ops)
      .then(() => {
        setSaving(false);
        onClose();
      })
      .catch((err: unknown) => {
        setSaving(false);
        const message = err instanceof Error ? err.message : String(err);
        if (/revision|conflict|冲突/i.test(message)) {
          Alert.alert('版本冲突', '配置在别处被修改过，将重新读取最新值。', [
            { text: '重读', onPress: () => void load() },
          ]);
        } else {
          Alert.alert('保存失败', message);
        }
      });
  };

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => undefined}>
          <View style={styles.titleRow}>
            <Text style={styles.title} maxFontSizeMultiplier={1.3}>
              配置 · {ns}
            </Text>
            <Pressable hitSlop={10} onPress={onClose}>
              <Text style={styles.close}>×</Text>
            </Pressable>
          </View>

          {namespace && namespace.revision !== undefined ? (
            <Text style={styles.revision}>revision {namespace.revision} · 乐观锁保存</Text>
          ) : null}
          {conflict ? <Text style={styles.conflict}>检测到远端修改，建议关闭后重读再保存。</Text> : null}

          {loading ? (
            <Text style={styles.loading}>读取中…</Text>
          ) : error ? (
            <>
              <Text style={styles.errorText}>{error}</Text>
              <Pressable style={styles.retry} onPress={() => void load()}>
                <Text style={styles.retryText}>重试</Text>
              </Pressable>
            </>
          ) : namespace === null || namespace.error ? (
            <Text style={styles.errorText}>{namespace?.error ?? '配置节不存在'}</Text>
          ) : (
            <ScrollView bounces={false} style={styles.formScroll}>
              {fields.map((field) => {
                const state = stateOf(field);
                if (field.type === 'boolean') {
                  const value = state.text !== null ? state.text === 'true' : baseValue(field) === true;
                  return (
                    <View key={field.path.join('.')} style={styles.fieldRow}>
                      <View style={styles.fieldBody}>
                        <Text style={styles.fieldLabel} maxFontSizeMultiplier={1.3}>
                          {field.label}
                        </Text>
                        {field.description ? (
                          <Text style={styles.fieldDesc} numberOfLines={2}>
                            {field.description}
                          </Text>
                        ) : null}
                      </View>
                      <Switch
                        value={value}
                        disabled={!namespace.writable}
                        onValueChange={(next) => {
                          tapFeedback();
                          setField(field, String(next));
                        }}
                        trackColor={{ false: styles.switchOff.backgroundColor, true: styles.switchOn.backgroundColor }}
                        thumbColor={styles.switchThumb.backgroundColor}
                        ios_backgroundColor={styles.switchOff.backgroundColor}
                      />
                    </View>
                  );
                }
                if (field.type === 'enum') {
                  const current = displayValue(field);
                  return (
                    <View key={field.path.join('.')} style={styles.fieldRowVertical}>
                      <Text style={styles.fieldLabel} maxFontSizeMultiplier={1.3}>
                        {field.label}
                      </Text>
                      <View style={styles.enumRow}>
                        {(field.enumValues ?? []).map((option) => {
                          const optionText = String(option);
                          const selected = current === optionText;
                          return (
                            <Pressable
                              key={optionText}
                              style={[styles.enumChip, selected ? styles.enumChipOn : null]}
                              disabled={!namespace.writable}
                              onPress={() => setField(field, optionText)}
                            >
                              <Text
                                style={[styles.enumText, selected ? styles.enumTextOn : null]}
                                numberOfLines={1}
                              >
                                {optionText}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </View>
                  );
                }
                const secret = field.secret === true;
                const secretSet = namespace.secrets?.some(
                  (item) => item.set === true && item.path?.[0] === field.path[0],
                );
                const isMultiline = field.type === 'json';
                return (
                  <View key={field.path.join('.')} style={styles.fieldRowVertical}>
                    <View style={styles.fieldHead}>
                      <Text style={styles.fieldLabel} maxFontSizeMultiplier={1.3}>
                        {field.label}
                      </Text>
                      {secret ? (
                        secretSet && !state.cleared ? (
                          <Text style={styles.secretBadge}>已设置</Text>
                        ) : (
                          <Text style={styles.secretOff}>未设置</Text>
                        )
                      ) : null}
                      {secret && secretSet && namespace.writable ? (
                        <Pressable hitSlop={6} onPress={() => clearField(field)}>
                          <Text style={styles.secretClear}>清除</Text>
                        </Pressable>
                      ) : null}
                    </View>
                    {field.description ? (
                      <Text style={styles.fieldDesc} numberOfLines={2}>
                        {field.description}
                      </Text>
                    ) : null}
                    {secret ? null : (
                      <TextInput
                        style={[styles.input, isMultiline ? styles.inputMultiline : null]}
                        value={displayValue(field)}
                        onChangeText={(text) => setField(field, text)}
                        editable={!namespace.writable ? false : !secret}
                        placeholder={secret ? '（不回传明文）' : undefined}
                        placeholderTextColor={t.text.muted}
                        autoCapitalize="none"
                        autoCorrect={false}
                        multiline={isMultiline}
                      />
                    )}
                    {secret ? null : state.changed ? (
                      <Text style={styles.changedHint}>已修改 · 保存时提交</Text>
                    ) : null}
                  </View>
                );
              })}
            </ScrollView>
          )}

          <View style={styles.footer}>
            <Pressable style={[styles.button, styles.buttonNeutral]} onPress={onClose}>
              <Text style={styles.buttonText}>取消</Text>
            </Pressable>
            <Pressable
              style={[styles.button, styles.buttonPrimary, (!namespace?.writable || saving) && styles.buttonDisabled]}
              disabled={!namespace?.writable || saving}
              onPress={save}
            >
              <Text style={[styles.buttonText, styles.buttonTextPrimary]}>
                {saving ? '保存中…' : '保存'}
              </Text>
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
    revision: { color: t.text.muted, fontSize: 10.5, marginTop: 2, fontVariant: ['tabular-nums'] },
    conflict: { color: t.semantic.gateAmberText, fontSize: 11.5, marginTop: 4 },
    loading: { color: t.text.muted, fontSize: 12.5, paddingVertical: 20 },
    errorText: { color: t.semantic.dangerText, fontSize: 12.5, paddingVertical: 12 },
    retry: {
      alignSelf: 'flex-start',
      backgroundColor: t.bg.subtle,
      borderRadius: 10,
      paddingHorizontal: 14,
      paddingVertical: 8,
    },
    retryText: { color: t.text.secondary, fontSize: 12.5, fontWeight: '700' },
    formScroll: { marginTop: 10 },
    fieldRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.border.subtle,
    },
    fieldRowVertical: {
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.border.subtle,
      gap: 6,
    },
    fieldBody: { flex: 1, minWidth: 0 },
    fieldHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    fieldLabel: { color: t.text.primary, fontSize: 13, fontWeight: '600', flexShrink: 1 },
    fieldDesc: { color: t.text.muted, fontSize: 11, lineHeight: 15 },
    secretBadge: {
      color: t.semantic.diffAddText,
      backgroundColor: t.semantic.diffAddBg,
      fontSize: 9.5,
      fontWeight: '700',
      paddingHorizontal: 5,
      paddingVertical: 1,
      borderRadius: 5,
      overflow: 'hidden',
    },
    secretOff: { color: t.text.muted, fontSize: 9.5 },
    secretClear: { color: t.semantic.dangerText, fontSize: 11, fontWeight: '700' },
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
    inputMultiline: { minHeight: 88, textAlignVertical: 'top' },
    changedHint: { color: t.semantic.gateAmberText, fontSize: 10 },
    enumRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    enumChip: {
      borderRadius: 9,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border.default,
      backgroundColor: t.bg.subtle,
      paddingHorizontal: 10,
      paddingVertical: 6,
      maxWidth: '100%',
    },
    enumChipOn: { backgroundColor: t.action.primaryBg, borderColor: t.action.primaryBg },
    enumText: { color: t.text.secondary, fontSize: 12 },
    enumTextOn: { color: t.action.primaryText, fontWeight: '700' },
    footer: { flexDirection: 'row', gap: 10, marginTop: 14 },
    button: {
      flex: 1,
      borderRadius: 12,
      paddingVertical: 11,
      alignItems: 'center',
    },
    buttonNeutral: { backgroundColor: t.bg.subtle, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border.default },
    buttonPrimary: { backgroundColor: t.action.primaryBg },
    buttonDisabled: { opacity: 0.45 },
    buttonText: { color: t.text.secondary, fontSize: 13, fontWeight: '700' },
    buttonTextPrimary: { color: t.action.primaryText },
    switchOff: { backgroundColor: t.border.default },
    switchOn: { backgroundColor: t.semantic.live },
    switchThumb: { backgroundColor: t.bg.elevatedAnswer },
  });
