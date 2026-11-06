import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { Palette } from '../../theme/tokens';
import { useTheme, useThemedStyles } from '../theme';
import { makeModalStyles } from './appStyles';

interface PairingCardProps {
  pairingText: string;
  onChangePairingText: (value: string) => void;
  manual: boolean;
  onToggleManual: () => void;
  busy: boolean;
  onScan: () => void;
  onPair: () => void;
}

/** 未配置网关时的配对页：扫码为主，手动粘贴为备选。 */
export function PairingCard({
  pairingText,
  onChangePairingText,
  manual,
  onToggleManual,
  busy,
  onScan,
  onPair,
}: PairingCardProps) {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={styles.pairCard}>
      <Text style={styles.sectionTitle}>配对</Text>
      <Text style={styles.pairHint}>
        在服务器上运行 dsh-pair，扫描它打印的二维码。配对码 5 分钟内有效。
      </Text>
      <Pressable
        testID="pairing-scan"
        accessibilityRole="button"
        accessibilityLabel="扫码配对"
        style={[styles.primaryButton, busy && styles.buttonDisabled]}
        disabled={busy}
        onPress={onScan}
        accessibilityState={{ disabled: busy }}
      >
        {busy ? (
          <ActivityIndicator color={t.bg.canvas} />
        ) : (
          <Text style={styles.primaryText}>扫码配对</Text>
        )}
      </Pressable>

      <Pressable
        testID="pairing-manual-toggle"
        accessibilityRole="button"
        accessibilityLabel={manual ? '收起手动输入' : '手动粘贴配对串'}
        style={styles.linkButton}
        onPress={onToggleManual}
      >
        <Text style={styles.linkText}>{manual ? '收起手动输入' : '手动粘贴配对串'}</Text>
      </Pressable>

      {manual ? (
        <View>
          <TextInput
            testID="pairing-payload"
            accessibilityLabel="配对内容"
            style={styles.input}
            multiline
            placeholder="粘贴配对内容（Base64URL）"
            placeholderTextColor={t.text.muted}
            value={pairingText}
            onChangeText={onChangePairingText}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Pressable
            testID="pairing-connect"
            accessibilityRole="button"
            accessibilityLabel="配对并连接"
            style={[styles.primaryButton, !pairingText.trim() && styles.buttonDisabled]}
            disabled={!pairingText.trim() || busy}
            onPress={onPair}
            accessibilityState={{ disabled: !pairingText.trim() || busy }}
          >
            <Text style={styles.primaryText}>配对并连接</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

interface AddGatewayModalProps {
  visible: boolean;
  pairingText: string;
  onChangePairingText: (value: string) => void;
  busy: boolean;
  onClose: () => void;
  onScan: () => void;
  onPair: () => void;
}

/** 已有多台网关时，从网关菜单添加另一台。 */
export function AddGatewayModal({
  visible,
  pairingText,
  onChangePairingText,
  busy,
  onClose,
  onScan,
  onPair,
}: AddGatewayModalProps) {
  const t = useTheme();
  const styles = useThemedStyles(makeModalStyles);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <Pressable style={styles.modalBackdrop} onPress={onClose} accessible={false}>
        <Pressable style={styles.modalCard} onPress={() => undefined} accessibilityViewIsModal>
          <Text style={styles.modalTitle} accessibilityRole="header">
            添加网关
          </Text>
          <Text style={styles.modalHint}>在服务器上运行 dsh-pair，扫码或粘贴它输出的配对串。</Text>
          <TextInput
            testID="add-gateway-payload"
            accessibilityLabel="配对内容"
            style={[styles.modalInput, styles.modalInputTall]}
            multiline
            placeholder="粘贴配对内容（Base64URL）"
            placeholderTextColor={t.text.muted}
            value={pairingText}
            onChangeText={onChangePairingText}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <View style={styles.modalActions}>
            <Pressable
              testID="add-gateway-scan"
              accessibilityRole="button"
              accessibilityLabel="扫码添加网关"
              style={styles.modalAction}
              onPress={onScan}
            >
              <Text style={styles.modalActionText}>扫码</Text>
            </Pressable>
            <Pressable
              testID="add-gateway-connect"
              accessibilityRole="button"
              accessibilityLabel="配对并连接"
              style={styles.modalAction}
              disabled={!pairingText.trim() || busy}
              onPress={onPair}
              accessibilityState={{ disabled: !pairingText.trim() || busy }}
            >
              <Text
                style={[
                  styles.modalPrimaryText,
                  !pairingText.trim() || busy ? styles.modalDisabled : null,
                ]}
              >
                配对并连接
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
    pairCard: { paddingTop: 8 },
    sectionTitle: {
      color: t.text.muted,
      fontSize: 12,
      letterSpacing: 1,
      textTransform: 'uppercase',
      paddingHorizontal: 20,
      paddingBottom: 8,
    },
    pairHint: { color: t.text.muted, fontSize: 13, paddingHorizontal: 20, paddingBottom: 12 },
    primaryButton: {
      marginHorizontal: 20,
      marginTop: 14,
      backgroundColor: t.action.primaryBg,
      borderRadius: 14,
      paddingVertical: 14,
      alignItems: 'center',
    },
    buttonDisabled: { opacity: 0.35 },
    primaryText: { color: t.bg.canvas, fontSize: 15, fontWeight: '600' },
    linkButton: { alignItems: 'center', paddingVertical: 12 },
    linkText: { color: t.text.muted, fontSize: 13 },
    input: {
      marginHorizontal: 20,
      minHeight: 96,
      borderRadius: 14,
      backgroundColor: t.bg.canvas,
      color: t.text.primary,
      padding: 14,
      fontSize: 13,
      textAlignVertical: 'top',
    },
  });
