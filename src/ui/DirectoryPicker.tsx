import { ActivityIndicator, FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { DirectoryListing } from '../protocol/directories';
import { useTheme, useThemedStyles } from './theme';
import type { Palette } from '../theme/tokens';

/**
 * 目录选择器：给「新建会话」指定一个项目目录。
 *
 * 数据由调用方通过 directories 帧拉取，这里只负责画。网关只列子目录
 * （不列文件），所以点一行就是往下走一层，确认按钮把当前 path 交给
 * session-create 的 cwd。
 */
export function DirectoryPicker({
  visible,
  listing,
  loading,
  error,
  onOpen,
  onRetry,
  onConfirm,
  onClose,
}: {
  visible: boolean;
  listing: DirectoryListing | null;
  loading: boolean;
  error: string | null;
  onOpen: (path?: string) => void;
  onRetry: () => void;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => undefined}>
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.title}>选择目录</Text>
              <Text style={styles.subtitle}>新会话会在选中的目录里启动</Text>
            </View>
            <Pressable hitSlop={10} onPress={onClose}>
              <Text style={styles.close}>取消</Text>
            </Pressable>
          </View>

          {listing ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.crumbs}
              contentContainerStyle={styles.crumbsContent}
            >
              {listing.crumbs.map((crumb, index) => {
                const current = index === listing.crumbs.length - 1;
                return (
                  <View key={crumb.path} style={styles.crumbWrap}>
                    {index > 0 ? <Text style={styles.crumbSep}>›</Text> : null}
                    <Pressable hitSlop={6} onPress={() => onOpen(crumb.path)} disabled={current}>
                      <Text style={[styles.crumb, current && styles.crumbCurrent]} numberOfLines={1}>
                        {crumb.name}
                      </Text>
                    </Pressable>
                  </View>
                );
              })}
            </ScrollView>
          ) : null}

          {loading && !listing ? (
            <View style={styles.center}>
              <ActivityIndicator color={t.text.muted} />
            </View>
          ) : error ? (
            <View style={styles.center}>
              <Text style={styles.error} numberOfLines={3}>
                {error}
              </Text>
              <Pressable style={styles.retry} onPress={onRetry} hitSlop={8}>
                <Text style={styles.retryText}>重试</Text>
              </Pressable>
            </View>
          ) : (
            <FlatList
              style={styles.list}
              data={listing?.entries ?? []}
              keyExtractor={(item) => item.path}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={<Text style={styles.empty}>这个目录里没有子文件夹</Text>}
              renderItem={({ item }) => (
                <Pressable style={styles.row} onPress={() => onOpen(item.path)}>
                  <Text style={[styles.rowName, item.hidden && styles.rowHidden]} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={styles.rowChevron}>›</Text>
                </Pressable>
              )}
            />
          )}

          <View style={styles.footer}>
            <Text style={styles.path} numberOfLines={1} ellipsizeMode="head">
              {listing?.path ?? '正在读取…'}
            </Text>
            <Pressable
              style={[styles.confirm, (!listing || loading || Boolean(error)) && styles.confirmOff]}
              disabled={!listing || loading || Boolean(error)}
              onPress={onConfirm}
            >
              {loading && listing ? (
                <ActivityIndicator size="small" color={t.bg.canvas} />
              ) : (
                <Text style={styles.confirmText}>在这里新建会话</Text>
              )}
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (t: Palette) =>
  StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: t.bg.canvas,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingTop: 14,
    paddingBottom: 24,
    height: '78%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  headerText: { flex: 1 },
  title: { color: t.text.primary, fontSize: 16, fontWeight: '700' },
  subtitle: { color: t.text.muted, fontSize: 12, marginTop: 3 },
  close: { color: t.text.muted, fontSize: 14, fontWeight: '600', paddingLeft: 12, paddingTop: 2 },
  crumbs: { flexGrow: 0, maxHeight: 34, paddingHorizontal: 14 },
  crumbsContent: { alignItems: 'center', paddingVertical: 6 },
  crumbWrap: { flexDirection: 'row', alignItems: 'center' },
  crumb: { color: t.text.muted, fontSize: 12, maxWidth: 160 },
  crumbCurrent: { color: t.text.primary, fontWeight: '600' },
  crumbSep: { color: t.text.muted, fontSize: 12, marginHorizontal: 6 },
  list: { flex: 1, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.border.default },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.bg.surface,
  },
  rowName: { flex: 1, color: t.text.primary, fontSize: 14 },
  rowHidden: { color: t.text.muted },
  rowChevron: { color: t.text.muted, fontSize: 18, marginLeft: 8 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  empty: { color: t.text.muted, fontSize: 13, textAlign: 'center', paddingVertical: 32 },
  error: { color: t.semantic.dangerText, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  retry: { marginTop: 14, paddingHorizontal: 18, paddingVertical: 8, borderRadius: 8, backgroundColor: t.bg.surface },
  retryText: { color: t.text.primary, fontSize: 13, fontWeight: '600' },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: t.border.default,
  },
  path: { color: t.text.muted, fontSize: 11, marginBottom: 10 },
  confirm: { backgroundColor: t.text.secondary, borderRadius: 10, paddingVertical: 13, alignItems: 'center' },
  confirmOff: { opacity: 0.45 },
  confirmText: { color: t.bg.canvas, fontSize: 15, fontWeight: '700' },
});
