import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { baseName, fileKindLabel, type PresentedFile } from '../protocol/files';

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
                  <ActivityIndicator size="small" color="#8A90A0" />
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

const styles = StyleSheet.create({
  wrap: { marginTop: 8, gap: 6 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: '#101216',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#262A33',
  },
  cardPressed: { backgroundColor: '#1B1E25' },
  badge: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: '#1A2233',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#8FB6FF', fontSize: 9.5, fontWeight: '700', letterSpacing: 0.4 },
  body: { flex: 1 },
  name: { color: '#EDEFF3', fontSize: 13.5, fontWeight: '600' },
  desc: { color: '#6E7585', fontSize: 11.5, marginTop: 2, lineHeight: 16 },
  error: { color: '#FF7A7A', fontSize: 11, marginTop: 3 },
  trailing: { alignItems: 'flex-end', gap: 4 },
  trailingText: { color: '#7A8091', fontSize: 11, fontWeight: '600' },
  retry: { color: '#FF7A7A' },
});
