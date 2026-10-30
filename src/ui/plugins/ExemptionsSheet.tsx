import { useCallback, useEffect, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { tapFeedback } from '../haptics';
import { useTheme, useThemedStyles } from '../theme';
import type { Palette } from '../../theme/tokens';
import type { PluginManager } from './usePluginManager';
import type { VersionExemption } from '../../protocol/plugins';

/**
 * 版本豁免：高级诊断页。
 *
 * 这是我们给语音包跨 rc 强开用的那套机制。协议约定：
 * - 读取返回 exemptions + warnings；
 * - 写入要 packageVersion + runtimeVersion + enabled，acceptRisk=true 表示用户
 *   看到了具体不兼容版本并明确接受风险——UI 必须先展示版本对再勾风险。
 */

interface Props {
  manager: PluginManager;
  onClose: () => void;
}

export function ExemptionsSheet({ manager, onClose }: Props) {
  const styles = useThemedStyles(makeStyles);
  const t = useTheme();
  const [items, setItems] = useState<VersionExemption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pkg, setPkg] = useState('');
  const [runtime, setRuntime] = useState('');
  const [acceptRisk, setAcceptRisk] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setError(null);
    manager
      .exemptions()
      .then((list) => setItems(list))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [manager]);

  useEffect(() => {
    const kick = setTimeout(load, 0);
    return () => clearTimeout(kick);
  }, [load]);

  const submit = () => {
    const packageVersion = pkg.trim();
    const runtimeVersion = runtime.trim();
    if (!packageVersion || !runtimeVersion) {
      Alert.alert('缺少参数', '包版本与运行时版本都要填。');
      return;
    }
    if (!acceptRisk) {
      Alert.alert('请先确认', '版本豁免会绕过兼容性检查，确认你了解风险后再勾选。');
      return;
    }
    setBusy(true);
    manager
      .setExemption(packageVersion, runtimeVersion, true, true)
      .then(() => {
        setBusy(false);
        setPkg('');
        setRuntime('');
        setAcceptRisk(false);
        load();
      })
      .catch((err: unknown) => {
        setBusy(false);
        Alert.alert('设置失败', err instanceof Error ? err.message : String(err));
      });
  };

  const revoke = (item: VersionExemption) => {
    if (!item.packageVersion || !item.runtimeVersion) return;
    setBusy(true);
    manager
      .setExemption(item.packageVersion, item.runtimeVersion, false)
      .then(() => {
        setBusy(false);
        load();
      })
      .catch((err: unknown) => {
        setBusy(false);
        Alert.alert('撤销失败', err instanceof Error ? err.message : String(err));
      });
  };

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => undefined}>
          <View style={styles.titleRow}>
            <Text style={styles.title} maxFontSizeMultiplier={1.3}>
              版本豁免
            </Text>
            <Pressable hitSlop={10} onPress={onClose}>
              <Text style={styles.close}>×</Text>
            </Pressable>
          </View>
          <Text style={styles.hint}>
            高风险设置：让与当前 DSH 版本不兼容的插件包强行启用。只在明确知道后果时使用。
          </Text>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          <ScrollView bounces={false} style={styles.list}>
            {items !== null && items.length === 0 ? (
              <Text style={styles.empty}>当前没有豁免记录。</Text>
            ) : null}
            {(items ?? []).map((item, index) => (
              <View key={index} style={styles.itemRow}>
                <View style={styles.itemBody}>
                  <Text style={styles.itemPkg} numberOfLines={1}>
                    {item.packageVersion ?? '?'}
                  </Text>
                  <Text style={styles.itemMeta}>
                    运行时 {item.runtimeVersion ?? '?'} · {item.acceptRisk ? '已接受风险' : '未接受风险'}
                  </Text>
                </View>
                <Text style={[styles.itemState, item.enabled ? styles.itemOn : styles.itemOff]}>
                  {item.enabled ? '生效中' : '已停用'}
                </Text>
                {item.enabled ? (
                  <Pressable hitSlop={6} disabled={busy} onPress={() => revoke(item)}>
                    <Text style={styles.revoke}>撤销</Text>
                  </Pressable>
                ) : null}
              </View>
            ))}
          </ScrollView>

          <Text style={styles.section}>新增豁免</Text>
          <TextInput
            style={styles.input}
            value={pkg}
            onChangeText={setPkg}
            placeholder="包版本，例如 dsh-plugin-speech@0.1.7-alpha.1"
            placeholderTextColor={t.text.muted}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TextInput
            style={[styles.input, styles.inputGap]}
            value={runtime}
            onChangeText={setRuntime}
            placeholder="运行时版本，例如 0.2.1-rc.3"
            placeholderTextColor={t.text.muted}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <View style={styles.riskRow}>
            <Switch
              value={acceptRisk}
              onValueChange={(value) => {
                tapFeedback();
                setAcceptRisk(value);
              }}
              trackColor={{ false: styles.switchOff.backgroundColor, true: styles.switchDanger.backgroundColor }}
              thumbColor={styles.switchThumb.backgroundColor}
              ios_backgroundColor={styles.switchOff.backgroundColor}
            />
            <Text style={styles.riskText}>我了解并接受版本不兼容的风险</Text>
          </View>

          <View style={styles.footer}>
            <Pressable style={[styles.button, styles.buttonNeutral]} onPress={onClose}>
              <Text style={styles.buttonText}>关闭</Text>
            </Pressable>
            <Pressable
              style={[styles.button, styles.buttonPrimary, (busy || !acceptRisk) && styles.buttonDisabled]}
              disabled={busy || !acceptRisk}
              onPress={submit}
            >
              <Text style={[styles.buttonText, styles.buttonTextPrimary]}>
                {busy ? '提交中…' : '设置豁免'}
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
    hint: { color: t.text.muted, fontSize: 11, lineHeight: 15, marginTop: 4 },
    errorText: { color: t.semantic.dangerText, fontSize: 12, marginTop: 8 },
    list: { marginTop: 10, maxHeight: 180 },
    empty: { color: t.text.muted, fontSize: 12, paddingVertical: 10 },
    itemRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 9,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.border.subtle,
    },
    itemBody: { flex: 1, minWidth: 0 },
    itemPkg: { color: t.text.primary, fontSize: 12.5, fontWeight: '600' },
    itemMeta: { color: t.text.muted, fontSize: 10.5, marginTop: 1 },
    itemState: { fontSize: 11, fontWeight: '700' },
    itemOn: { color: t.semantic.diffAddText },
    itemOff: { color: t.text.muted },
    revoke: { color: t.semantic.dangerText, fontSize: 12, fontWeight: '700' },
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
      fontSize: 12.5,
      paddingHorizontal: 10,
      paddingVertical: 9,
    },
    inputGap: { marginTop: 8 },
    riskRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
    riskText: { flex: 1, color: t.semantic.gateAmberText, fontSize: 11.5, lineHeight: 16 },
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
    switchDanger: { backgroundColor: t.semantic.diffDelText },
    switchThumb: { backgroundColor: t.bg.elevatedAnswer },
  });
