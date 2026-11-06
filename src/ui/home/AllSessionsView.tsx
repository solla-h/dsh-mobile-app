import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  describePending,
  pendingItems,
  type PendingMap,
} from '../../protocol/pending';
import type { SessionItem } from '../../protocol/types';
import type { Palette } from '../../theme/tokens';
import { outbox } from '../../transport/outbox';
import { useTheme, useThemedStyles } from '../theme';
import type { HomeRow } from './rows';

/** 列表上的相对时间：比绝对时间戳好读，也不用为「耗时」去拉 session-stats。 */
function ago(at: number): string {
  if (!at) return '';
  const diff = Date.now() - at;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return Math.floor(diff / 60_000) + ' 分钟前';
  if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + ' 小时前';
  return Math.floor(diff / 86_400_000) + ' 天前';
}

interface Props {
  connected: boolean;
  creating: boolean;
  /** 会话总数（决定是否显示搜索框），不是当前可见数。 */
  sessionCount: number;
  /** 当前搜索/归档过滤后的会话数，显示在目录标题旁。 */
  visibleCount: number;
  rows: HomeRow[];
  search: string;
  onChangeSearch: (value: string) => void;
  pending: PendingMap;
  draftIds: readonly string[];
  outboxTick: number;
  archivedCount: number;
  showArchived: boolean;
  onToggleShowArchived: () => void;
  onToggleGroup: (groupId: string) => void;
  deviceName?: string;
  protocol?: number;
  onOpenHost: () => void;
  onCreate: () => void;
  onOpenSession: (session: SessionItem) => void;
  onOpenSessionMenu: (session: SessionItem) => void;
}

/**
 * 「全部会话」页：设备信息、搜索、工作区分组和会话行。
 *
 * 搜索词、折叠状态、草稿标记都留在 App 里由这里受控使用——
 * 切 Tab 或从会话页返回时组件会重挂载，状态不能在组件内部。
 */
export function AllSessionsView({
  connected,
  creating,
  sessionCount,
  visibleCount,
  rows,
  search,
  onChangeSearch,
  pending,
  draftIds,
  outboxTick,
  archivedCount,
  showArchived,
  onToggleShowArchived,
  onToggleGroup,
  deviceName,
  protocol,
  onOpenHost,
  onCreate,
  onOpenSession,
  onOpenSessionMenu,
}: Props) {
  const t = useTheme();
  const styles = useThemedStyles(makeStyles);

  return (
    <>
      <Pressable
        style={styles.metaRow}
        onPress={onOpenHost}
        accessibilityRole="button"
        accessibilityHint="打开宿主信息"
      >
        <Text style={styles.metaLabel}>设备</Text>
        <Text style={styles.metaValue}>{deviceName ?? '未知'}</Text>
        <Text style={styles.metaLabel}>协议</Text>
        <Text style={styles.metaValue}>v{protocol ?? '?'}</Text>
        <Text style={styles.metaAction}>宿主 ›</Text>
      </Pressable>
      {sessionCount > 3 ? (
        <View style={styles.searchWrap}>
          <TextInput
            style={styles.searchInput}
            value={search}
            onChangeText={onChangeSearch}
            placeholder="搜索标题或目录"
            placeholderTextColor={t.text.muted}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel="搜索会话"
          />
          {search ? (
            <Pressable
              hitSlop={10}
              onPress={() => onChangeSearch('')}
              style={styles.searchClear}
              accessibilityRole="button"
              accessibilityLabel="清空搜索"
            >
              <Text style={styles.searchClearText} allowFontScaling={false}>
                ×
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      <View style={styles.dirHead}>
        <Text style={styles.dirTitle} maxFontSizeMultiplier={1.3}>
          全部工作区与会话目录
        </Text>
        <Text style={styles.dirCount}>{visibleCount} 个</Text>
        <Pressable
          style={[styles.newButton, !connected && styles.newButtonOff]}
          onPress={onCreate}
          disabled={creating || !connected}
          accessibilityRole="button"
          accessibilityLabel="新建会话"
          accessibilityState={{ disabled: creating || !connected }}
        >
          {creating ? (
            <ActivityIndicator size="small" color={t.text.secondary} />
          ) : (
            <Text style={[styles.newButtonText, !connected && styles.newButtonTextOff]}>+ 新建</Text>
          )}
        </Pressable>
      </View>
      <Text style={styles.dirSub} maxFontSizeMultiplier={1.3}>
        按工作区分组 · 无框排版 · 长按一行有更多操作
      </Text>
      <FlatList
        data={rows}
        keyExtractor={(row) => (row.kind === 'group' ? 'g:' + row.id : row.item.sessionId)}
        // 草稿/待发标记不在 item 里，得靠 extraData 才会重绘。
        extraData={`${outboxTick}:${draftIds.join(',')}`}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {!connected ? '连接断开，正在重连…' : search ? '没有匹配的会话' : '还没有会话'}
          </Text>
        }
        ListFooterComponent={
          archivedCount > 0 ? (
            <Pressable
              style={styles.archiveToggle}
              onPress={onToggleShowArchived}
              accessibilityRole="button"
              accessibilityState={{ expanded: showArchived }}
            >
              <Text style={styles.archiveToggleText}>
                {showArchived ? '隐藏已归档' : `已归档 ${archivedCount} 个 · 显示`}
              </Text>
            </Pressable>
          ) : undefined
        }
        renderItem={({ item: row }) => {
          if (row.kind === 'group') {
            return (
              <Pressable
                style={styles.groupHead}
                onPress={() => onToggleGroup(row.id)}
                accessibilityRole="button"
                accessibilityLabel={`${row.title}，${row.count} 个会话`}
                accessibilityHint={row.collapsed ? '展开分组' : '折叠分组'}
                accessibilityState={{ expanded: !row.collapsed }}
              >
                <Text style={styles.groupCaret} allowFontScaling={false}>
                  {row.collapsed ? '▸' : '▾'}
                </Text>
                <Text style={styles.groupTitle} numberOfLines={1} maxFontSizeMultiplier={1.3}>
                  {row.title}
                </Text>
                <Text style={styles.groupCount} maxFontSizeMultiplier={1.3}>
                  {row.count}
                </Text>
              </Pressable>
            );
          }
          const item = row.item;
          const waiting = pendingItems(pending, item.sessionId);
          return (
            <Pressable
              testID={`session-row-${item.sessionId}`}
              style={[styles.card, row.indent && styles.cardIndent]}
              onPress={() => onOpenSession(item)}
              onLongPress={() => onOpenSessionMenu(item)}
              delayLongPress={320}
              accessibilityRole="button"
              accessibilityHint="长按打开更多操作"
              accessibilityActions={[{ name: 'more', label: '更多操作' }]}
              onAccessibilityAction={(event) => {
                if (event.nativeEvent.actionName === 'more') onOpenSessionMenu(item);
              }}
            >
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle} numberOfLines={1}>
                  {item.projections?.values.title ?? '未命名会话'}
                </Text>
                {item.running ? <View style={styles.runningDot} /> : null}
              </View>
              <Text style={styles.cardMeta} numberOfLines={1}>
                {`${ago(item.updatedAt)} · ${item.cwd ?? ''}`}
              </Text>
              {waiting.length > 0 ? (
                <View style={styles.pendingPill}>
                  <View style={styles.pendingDot} />
                  <Text style={styles.pendingText} numberOfLines={1}>
                    {describePending(waiting)}
                  </Text>
                </View>
              ) : null}
              {(() => {
                const pendingCount = outbox.countFor(item.sessionId);
                const hasDraft = draftIds.includes(item.sessionId);
                if (!pendingCount && !hasDraft) return null;
                return (
                  <View style={styles.tagRow}>
                    {pendingCount > 0 ? (
                      <Text style={styles.tagWarn}>待发送 {pendingCount}</Text>
                    ) : null}
                    {hasDraft ? <Text style={styles.tag}>草稿</Text> : null}
                  </View>
                );
              })()}
            </Pressable>
          );
        }}
      />
    </>
  );
}

const makeStyles = (t: Palette) =>
  StyleSheet.create({
    metaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 20,
      paddingBottom: 12,
      gap: 8,
    },
    metaLabel: { color: t.text.muted, fontSize: 12 },
    metaValue: { color: t.text.secondary, fontSize: 12, marginRight: 12 },
    metaAction: { flex: 1, textAlign: 'right', color: t.text.muted, fontSize: 11 },
    searchWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      marginHorizontal: 20,
      marginBottom: 10,
      backgroundColor: t.bg.surface,
      borderRadius: 10,
      paddingHorizontal: 12,
    },
    searchInput: { flex: 1, color: t.text.primary, fontSize: 14, paddingVertical: 9 },
    searchClear: { paddingHorizontal: 6, paddingVertical: 4 },
    searchClearText: { color: t.text.muted, fontSize: 18, lineHeight: 20 },
    tagRow: { flexDirection: 'row', gap: 6, marginTop: 8 },
    tag: {
      color: t.text.primary,
      fontSize: 10,
      fontWeight: '600',
      backgroundColor: t.bg.surface,
      paddingHorizontal: 7,
      paddingVertical: 2,
      borderRadius: 999,
      overflow: 'hidden',
    },
    tagWarn: {
      color: t.semantic.gateAmberText,
      fontSize: 10,
      fontWeight: '600',
      backgroundColor: t.semantic.gateAmberBg,
      paddingHorizontal: 7,
      paddingVertical: 2,
      borderRadius: 999,
      overflow: 'hidden',
    },
    archiveToggle: { alignItems: 'center', paddingVertical: 14 },
    archiveToggleText: { color: t.text.muted, fontSize: 12, fontWeight: '600' },
    newButton: {
      paddingHorizontal: 12,
      paddingVertical: 4,
      borderRadius: 999,
      backgroundColor: t.bg.surface,
      minWidth: 62,
      alignItems: 'center',
    },
    newButtonOff: {
      opacity: 0.45,
    },
    newButtonTextOff: {
      color: t.text.muted,
    },
    newButtonText: { color: t.text.secondary, fontSize: 12 },
    // 底部 Tab 栏是兄弟节点，列表自己留出 72 的内边距，最后一行才不会被压住
    listContent: { paddingHorizontal: 20, paddingBottom: 72 },
    // 无框行：不要背景、圆角和阴影，只留一条底部分割线。
    card: {
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.border.subtle,
    },
    // 缩进 + 左侧导轨线，层级靠这一条竖线表达
    cardIndent: {
      marginLeft: 14,
      paddingLeft: 12,
      borderLeftWidth: 1,
      borderLeftColor: t.border.default,
    },
    groupHead: {
      flexDirection: 'row',
      alignItems: 'center',
      height: 38,
      gap: 8,
      marginTop: 4,
    },
    dirHead: {
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: 8,
      paddingHorizontal: 20,
      paddingTop: 2,
    },
    dirTitle: { flex: 1, color: t.text.primary, fontSize: 20, fontWeight: '700' },
    dirCount: { color: t.text.muted, fontSize: 11 },
    dirSub: { color: t.text.muted, fontSize: 11, paddingHorizontal: 20, paddingBottom: 6 },
    groupCaret: { color: t.text.muted, fontSize: 11, width: 12 },
    groupTitle: { flex: 1, color: t.text.primary, fontSize: 14, fontWeight: '700' },
    groupCount: { color: t.text.muted, fontSize: 11 },
    cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    cardTitle: { color: t.text.primary, fontSize: 15, fontWeight: '600', flex: 1 },
    runningDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: t.semantic.diffAddText,
      marginLeft: 8,
    },
    cardMeta: { color: t.text.muted, fontSize: 12, marginTop: 6 },
    pendingPill: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 8,
      paddingHorizontal: 8,
      paddingVertical: 5,
      borderRadius: 8,
      backgroundColor: t.border.default,
    },
    pendingDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: t.semantic.gateAmberText,
      marginRight: 6,
    },
    pendingText: { flex: 1, color: t.semantic.gateAmberText, fontSize: 11 },
    empty: { color: t.text.muted, fontSize: 13, paddingVertical: 20 },
  });
