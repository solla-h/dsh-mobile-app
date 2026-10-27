import { CameraView, useCameraPermissions } from 'expo-camera';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme, useThemedStyles } from './theme';
import type { Palette } from '../theme/tokens';

interface Props {
  onScanned: (payload: string) => void;
  onCancel: () => void;
}

export function ScanScreen({ onScanned, onCancel }: Props) {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [permission, requestPermission] = useCameraPermissions();
  const [error, setError] = useState<string | null>(null);
  const handledRef = useRef(false);

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) {
      requestPermission().catch(() => undefined);
    }
  }, [permission, requestPermission]);

  const handleScan = (data: string) => {
    if (handledRef.current) return;
    handledRef.current = true;
    if (!data || data.length < 20) {
      setError('这不是配对二维码');
      setTimeout(() => {
        handledRef.current = false;
        setError(null);
      }, 1500);
      return;
    }
    onScanned(data);
  };

  if (!permission) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={t.text.secondary} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>需要相机权限</Text>
        <Text style={styles.hint}>
          扫码配对要用摄像头读取终端里的二维码。不给权限也可以退回手动粘贴。
        </Text>
        <Pressable style={styles.primary} onPress={() => requestPermission().catch(() => undefined)}>
          <Text style={styles.primaryText}>授予权限</Text>
        </Pressable>
        <Pressable style={styles.secondary} onPress={onCancel}>
          <Text style={styles.secondaryText}>返回</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={({ data }) => handleScan(data)}
      />
      <View style={styles.overlay} pointerEvents="box-none">
        <View style={styles.topBar}>
          <Pressable onPress={onCancel} hitSlop={12} style={styles.close}>
            <Text style={styles.closeText}>关闭</Text>
          </Pressable>
        </View>
        <View style={styles.frameWrap} pointerEvents="none">
          <View style={styles.frame}>
            <View style={[styles.corner, styles.cornerTL]} />
            <View style={[styles.corner, styles.cornerTR]} />
            <View style={[styles.corner, styles.cornerBL]} />
            <View style={[styles.corner, styles.cornerBR]} />
          </View>
          <Text style={styles.frameHint}>
            对准终端里的二维码{error ? `\n${error}` : ''}
          </Text>
        </View>
        <Text style={styles.footer}>在服务器上运行 dsh-pair，扫描它打印的二维码</Text>
      </View>
    </View>
  );
}

const FRAME = 240;

const makeStyles = (t: Palette) =>
  StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  center: {
    flex: 1,
    backgroundColor: t.bg.canvas,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  title: { color: t.text.primary, fontSize: 18, fontWeight: '600', marginBottom: 10 },
  hint: { color: t.text.muted, fontSize: 13, lineHeight: 20, textAlign: 'center', marginBottom: 22 },
  primary: {
    backgroundColor: t.action.primaryBg,
    borderRadius: 12,
    paddingHorizontal: 24,
    paddingVertical: 12,
    minWidth: 160,
    alignItems: 'center',
  },
  primaryText: { color: t.bg.canvas, fontSize: 15, fontWeight: '700' },
  secondary: { marginTop: 12, paddingVertical: 10 },
  secondaryText: { color: t.text.muted, fontSize: 14 },
  overlay: { flex: 1, justifyContent: 'space-between' },
  topBar: { paddingTop: 54, paddingHorizontal: 18, alignItems: 'flex-end' },
  close: {
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  closeText: { color: t.text.primary, fontSize: 14 },
  frameWrap: { alignItems: 'center' },
  frame: { width: FRAME, height: FRAME },
  corner: { position: 'absolute', width: 28, height: 28, borderColor: t.semantic.diffAddText },
  cornerTL: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 8 },
  cornerTR: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 8 },
  cornerBL: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 8 },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 8 },
  frameHint: { color: t.text.secondary, fontSize: 13, marginTop: 18, textAlign: 'center', lineHeight: 19 },
  footer: {
    color: t.text.muted,
    fontSize: 12,
    textAlign: 'center',
    paddingBottom: 42,
    paddingHorizontal: 24,
  },
});
