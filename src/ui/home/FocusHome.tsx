import { useEffect, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useThemedStyles } from '../theme';
import type { Palette } from '../../theme/tokens';
import type { FocusEntry } from '../../protocol/focus';

/**
 * 首页「聚焦」页：上半屏只放需要人管的会话，下半屏是一枚语音球。
 *
 * 网格高度由内容撑开（0~4 张），球区吃掉剩余空间——比例是算出来的，
 * 不是把屏幕切成 64/36。屏幕矮、字放大时都不会裁切。
 */
export interface FocusItem extends FocusEntry {
  /** 会话的 cwd，用来在卡片角上标一行短目录名 */
  cwd: string;
}

interface Props {
  items: FocusItem[];
  connected: boolean;
  pendingTotal: number;
  /** 语音是否可用；不可用时按住球给提示而不是静默失败 */
  voiceReady: boolean;
  /** 当前工作区名字，显示在网格上方 */
  workspaceLabel: string;
  onPickWorkspace: () => void;
  onOpen: (sessionId: string) => void;
  onCreate: () => void;
  onHoldOrb: () => void;
  onHoldCard: (sessionId: string) => void;
  /** 松手：结束录音 */
  onRelease: () => void;
  recording: boolean;
  transcribing: boolean;
  /** 服务端允许的单条录音上限（秒），用来显示倒计时/提示 */
  maxRecordSeconds: number;
}

export function FocusHome({
  items,
  connected,
  pendingTotal,
  voiceReady,
  workspaceLabel,
  onPickWorkspace,
  onOpen,
  onCreate,
  onHoldOrb,
  onHoldCard,
  onRelease,
  recording,
  transcribing,
  maxRecordSeconds,
}: Props) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.root}>
      <View style={styles.head}>
        <Text style={styles.headTitle} maxFontSizeMultiplier={1.3}>
          现在有谁在等我
        </Text>
        <Text style={styles.headCount} maxFontSizeMultiplier={1.3}>
          {pendingTotal > 0 ? pendingTotal + ' 条待办' : items.length > 0 ? '进行中' : ''}
        </Text>
      </View>

      <Pressable style={styles.wsRow} onPress={onPickWorkspace} hitSlop={6}>
        <Text style={styles.wsLabel} maxFontSizeMultiplier={1.3}>
          新会话开在
        </Text>
        <Text style={styles.wsName} numberOfLines={1} maxFontSizeMultiplier={1.3}>
          {workspaceLabel} ›
        </Text>
      </Pressable>

      {items.length === 0 ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyTitle} maxFontSizeMultiplier={1.3}>
            {connected ? '当前所有 Agent 均已就绪' : '连接断开'}
          </Text>
          <Text style={styles.emptyHint} maxFontSizeMultiplier={1.3}>
            {connected ? '按住下方语音球，直接开一个新任务' : '顶部提示可以点一下重连'}
          </Text>
        </View>
      ) : (
        <View style={styles.grid}>
          {items.map((item) => (
            <FocusCard
              key={item.sessionId}
              item={item}
              onOpen={onOpen}
              onHold={onHoldCard}
              onRelease={onRelease}
            />
          ))}
        </View>
      )}

      <View style={styles.orbStage}>
        <VoiceOrb
          onTap={onCreate}
          onHold={onHoldOrb}
          onRelease={onRelease}
          voiceReady={voiceReady}
          recording={recording}
        />
        <Text style={styles.orbHint} maxFontSizeMultiplier={1.3}>
          {recording
            ? `正在听… 松手发送（最长 ${maxRecordSeconds}s）`
            : transcribing
              ? '正在识别…'
              : voiceReady
                ? '按住说话 · 轻点用文字'
                : '轻点新建会话 · 语音未启用'}
        </Text>
      </View>
    </View>
  );
}

/** 2x2 卡片：宽度按容器百分比，高度由内容撑开，字号有上限倍率。 */
function FocusCard({
  item,
  onOpen,
  onHold,
  onRelease,
}: {
  item: FocusItem;
  onOpen: (sessionId: string) => void;
  onHold: (sessionId: string) => void;
  onRelease: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const waiting = item.pendingCount > 0;
  const dir = shortDir(item.cwd);
  return (
    <Pressable
      style={[styles.card, waiting ? styles.cardWaiting : styles.cardRunning]}
      onPress={() => onOpen(item.sessionId)}
      onLongPress={() => onHold(item.sessionId)}
      onPressOut={onRelease}
      delayLongPress={600}
      accessibilityHint={waiting ? '长按可以直接语音回复' : '正在进行中'}
    >
      <View style={styles.cardTop}>
        <View style={[styles.dot, waiting ? styles.dotWaiting : styles.dotRunning]} />
        <Text style={styles.cardDir} numberOfLines={1} maxFontSizeMultiplier={1.3}>
          {dir}
        </Text>
        <Text style={[styles.cardTag, waiting ? styles.tagWaiting : styles.tagRunning]} maxFontSizeMultiplier={1.2}>
          {waiting ? '待审批' : '进行中'}
        </Text>
      </View>
      <Text style={styles.cardTitle} numberOfLines={2} maxFontSizeMultiplier={1.3}>
        {item.title || '未命名会话'}
      </Text>
      <Text style={styles.cardSummary} numberOfLines={2} maxFontSizeMultiplier={1.3}>
        {item.summary || (waiting ? 'agent 停在这里，等你确认' : '正在回复…')}
      </Text>
      <View style={styles.cardBottom}>
        <Text style={styles.cardTime} maxFontSizeMultiplier={1.2}>
          {relativeTime(item.updatedAt)}
        </Text>
        {waiting ? (
          <Text style={styles.cardHold} maxFontSizeMultiplier={1.2}>
            🎤 按住直回
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

/**
 * 语音球。静息时外圈缓慢呼吸，按住时放大——只用 Animated 的 scale/opacity，
 * 走原生驱动，不碰布局，所以不会和列表或手势打架。
 */
function VoiceOrb({
  onTap,
  onHold,
  onRelease,
  voiceReady,
  recording,
}: {
  onTap: () => void;
  onHold: () => void;
  onRelease: () => void;
  voiceReady: boolean;
  recording: boolean;
}) {
  const styles = useThemedStyles(makeStyles);
  // 用 state 持有 Animated.Value：渲染期读它是合法的（react-hooks/refs 禁止渲染期读 ref）。
  const [breath] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, { toValue: 1, duration: 1200, useNativeDriver: true }),
        Animated.timing(breath, { toValue: 0, duration: 1200, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [breath]);

  const ringScale = breath.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] });
  const ringOpacity = breath.interpolate({ inputRange: [0, 1], outputRange: [0.12, 0.28] });

  return (
    <Pressable
      onPress={onTap}
      onLongPress={onHold}
      onPressOut={onRelease}
      delayLongPress={600}
      style={styles.orbHit}
      accessibilityHint={voiceReady ? '按住说话新建会话，轻点用文字' : '轻点新建会话'}
    >
      <Animated.View
        style={[styles.orbRing, { opacity: ringOpacity, transform: [{ scale: ringScale }] }]}
      />
      <View style={[styles.orb, recording && styles.orbLive]} />
    </Pressable>
  );
}

/** 只取最后两层目录，和弧形转盘的副标题保持一致的省略方式。 */
function shortDir(cwd: string): string {
  const parts = cwd.split(/[\\/]/).filter(Boolean);
  return parts.slice(-2).join('/') || '默认目录';
}

function relativeTime(at: number): string {
  if (!at) return '';
  const diff = Date.now() - at;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return Math.floor(diff / 60_000) + ' 分钟前';
  if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + ' 小时前';
  return Math.floor(diff / 86_400_000) + ' 天前';
}

const makeStyles = (t: Palette) =>
  StyleSheet.create({
    root: { flex: 1, paddingHorizontal: 16 },
    head: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      paddingTop: 4,
      paddingBottom: 10,
    },
    headTitle: { color: t.text.primary, fontSize: 15, fontWeight: '700' },
    headCount: { color: t.text.muted, fontSize: 12 },
    wsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingBottom: 10,
    },
    wsLabel: { color: t.text.muted, fontSize: 11 },
    wsName: { color: t.text.secondary, fontSize: 12, fontWeight: '600', flexShrink: 1 },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    card: {
      width: '48.5%',
      minHeight: 112,
      borderRadius: 16,
      padding: 12,
      gap: 6,
    },
    cardWaiting: {
      backgroundColor: t.bg.elevatedAnswer,
      borderWidth: 1,
      borderColor: t.semantic.gateAmberText,
    },
    cardRunning: {
      backgroundColor: t.bg.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border.default,
    },
    cardTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    dot: { width: 6, height: 6, borderRadius: 3 },
    dotWaiting: { backgroundColor: t.semantic.gateAmberText },
    dotRunning: { backgroundColor: t.text.muted },
    cardDir: { flex: 1, color: t.text.muted, fontSize: 10 },
    cardTag: { fontSize: 10, fontWeight: '700' },
    tagWaiting: { color: t.semantic.gateAmberText },
    tagRunning: { color: t.text.secondary },
    cardTitle: { color: t.text.primary, fontSize: 13, fontWeight: '700', lineHeight: 18 },
    cardSummary: { color: t.text.secondary, fontSize: 11, lineHeight: 15 },
    cardBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto' },
    cardTime: { color: t.text.muted, fontSize: 10 },
    cardHold: { color: t.text.muted, fontSize: 10 },
    emptyBox: { paddingVertical: 26, gap: 6 },
    emptyTitle: { color: t.text.primary, fontSize: 15, fontWeight: '600' },
    emptyHint: { color: t.text.muted, fontSize: 12 },
    orbStage: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
    orbHit: { width: 112, height: 112, alignItems: 'center', justifyContent: 'center' },
    orbRing: {
      position: 'absolute',
      width: 112,
      height: 112,
      borderRadius: 56,
      borderWidth: 1,
      borderColor: t.border.default,
    },
    orb: {
      width: 80,
      height: 80,
      borderRadius: 40,
      backgroundColor: t.bg.elevatedAnswer,
      borderWidth: 1.5,
      borderColor: t.border.activeOrigin,
    },
    orbLive: { backgroundColor: t.action.primaryBg, borderColor: t.action.primaryBg },
    orbHint: { color: t.text.muted, fontSize: 12 },
  });
