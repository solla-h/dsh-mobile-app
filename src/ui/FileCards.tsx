import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { baseName, fileKindLabel, type PresentedFile } from '../protocol/files';
import { useTheme, useThemedStyles } from './theme';
import type { Palette } from '../theme/tokens';

export interface FileUiState {
  status: 'resolving' | 'downloading' | 'ready' | 'error';
  /** 0..1，仅 downloading 时有意义 */
  progress?: number;
  localUri?: string;
  message?: string;
}

/** 一轮回复底部的交付文件卡片。字节不在这里，点开才下载。 */
export function FileCards({
  files,
  states,
  onOpen,
}: {
  files: PresentedFile[];
  states: Record<string, FileUiState>;
  onOpen: (path: string) => void;
}) {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  if (files.length === 0) return null;
  return (
    <View style={styles.wrap}>
      {files.map((file) => {
        const name = baseName(file.path);
        const state = states[file.path];
        const status = state?.status ?? 'idle';
        const busy = status === 'resolving' || status === 'downloading';
        return (
          <Pressable
            key={file.path}
            style={({ pressed }) => [styles.card, pressed ? styles.cardPressed : null]}
            onPress={() => onOpen(file.path)}
            disabled={busy}
          >
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{fileKindLabel(name)}</Text>
            </View>
            <View style={styles.body}>
              <Text style={styles.name} numberOfLines={1}>
                {name}
              </Text>
              {file.description ? (
                <Text style={styles.desc} numberOfLines={2}>
                  {file.description}
                </Text>
              ) : null}
              {status === 'error' && state?.message ? (
                <Text style={styles.error} numberOfLines={2}>
                  {state.message}
                </Text>
              ) : null}
            </View>
            <View style={styles.trailing}>
              {busy ? (
                <>
                  <ActivityIndicator size="small" color={t.text.muted} />
                  <Text style={styles.trailingText}>
                    {status === 'resolving'
                      ? '解析中'
                      : state?.progress !== undefined
                        ? Math.round(state.progress * 100) + '%'
                        : '下载中'}
                  </Text>
                </>
              ) : (
                <Text style={[styles.trailingText, status === 'error' ? styles.retry : null]}>
                  {status === 'ready' ? '打开' : status === 'error' ? '重试' : '下载'}
                </Text>
              )}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const makeStyles = (t: Palette) =>
  StyleSheet.create({
  wrap: { marginTop: 8, gap: 6 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: t.bg.subtle,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.border.default,
  },
  cardPressed: { backgroundColor: t.bg.surface },
  badge: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: t.bg.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: t.text.primary, fontSize: 9.5, fontWeight: '700', letterSpacing: 0.4 },
  body: { flex: 1 },
  name: { color: t.text.primary, fontSize: 13.5, fontWeight: '600' },
  desc: { color: t.text.muted, fontSize: 11.5, marginTop: 2, lineHeight: 16 },
  error: { color: t.semantic.dangerText, fontSize: 11, marginTop: 3 },
  trailing: { alignItems: 'flex-end', gap: 4 },
  trailingText: { color: t.text.muted, fontSize: 11, fontWeight: '600' },
  retry: { color: t.semantic.dangerText },
});
