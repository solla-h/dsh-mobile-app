import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme, useThemedStyles } from '../theme';
import { WhaleOrbStage } from './WhaleOrbStage';
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
  /** 上滑取消这次录音 */
  onCancelVoice: () => void;
  recording: boolean;
  transcribing: boolean;
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
  onCancelVoice,
  recording,
  transcribing,
}: Props) {
  const styles = useThemedStyles(makeStyles);
  const t = useTheme();
  return (
    <View style={styles.root}>
      <View style={styles.head}>
        <Text style={styles.headTitle} maxFontSizeMultiplier={1.2} numberOfLines={1}>
          ACTIVE FOCUS · 最近会话{items.length > 0 ? `（${items.length}）` : ''}
        </Text>
        <Text style={styles.headHint} maxFontSizeMultiplier={1.2} numberOfLines={1}>
          点按进入 · 按住直接语音回
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
            {connected ? '还没有会话' : '连接断开'}
          </Text>
          <Text style={styles.emptyHint} maxFontSizeMultiplier={1.3}>
            {connected ? '按住下方语音球，直接开第一个任务' : '顶部提示可以点一下重连'}
          </Text>
        </View>
      ) : (
        <View style={styles.grid}>
          {items.map((item, index) => (
            <FocusCard
              key={item.sessionId}
              item={item}
              index={index}
              onOpen={onOpen}
              onHold={onHoldCard}
              onRelease={onRelease}
              voiceReady={voiceReady}
            />
          ))}
        </View>
      )}

      <View style={styles.orbStage}>
        <Text style={styles.orbCaption} maxFontSizeMultiplier={1.2}>
          默认归属工作区：{workspaceLabel}
        </Text>
        <WhaleOrbStage
          theme={t.name === 'paper' ? 'PAPER' : 'EINK_SLATE'}
          voiceReady={voiceReady}
          transcribing={transcribing}
          onDoubleTap={onCreate}
          onVoiceStart={onHoldOrb}
          onVoiceLaunch={() => onRelease()}
          onVoiceCancel={onCancelVoice}
        />
        {transcribing ? (
          <Text style={styles.orbHint} maxFontSizeMultiplier={1.3}>
            服务端识别中…
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** 2x2 卡片：宽度按容器百分比，高度由内容撑开，字号有上限倍率。 */
function FocusCard({
  item,
  index,
  onOpen,
  onHold,
  onRelease,
  voiceReady,
}: {
  item: FocusItem;
  index: number;
  onOpen: (sessionId: string) => void;
  onHold: (sessionId: string) => void;
  onRelease: () => void;
  voiceReady: boolean;
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
        <Text
          style={[
            styles.cardTag,
            waiting ? styles.tagWaiting : item.running ? styles.tagRunning : styles.tagIdle,
          ]}
          maxFontSizeMultiplier={1.2}
        >
          {waiting ? '待审批' : item.running ? '进行中' : '已就绪'}
        </Text>
      </View>
      <Text style={styles.cardTitle} numberOfLines={2} maxFontSizeMultiplier={1.3}>
        {item.title || '未命名会话'}
      </Text>
      <Text style={styles.cardSummary} numberOfLines={2} maxFontSizeMultiplier={1.3}>
        {plainText(item.summary) ||
          (waiting ? 'agent 停在这里，等你确认' : item.running ? '正在回复…' : '上一轮已结束')}
      </Text>
      <View style={styles.cardBottom}>
        <Text style={styles.cardTime} maxFontSizeMultiplier={1.2}>
          {`#${String(index + 1).padStart(2, '0')} · ${relativeTime(item.updatedAt)}`}
        </Text>
        {voiceReady ? (
          <Text style={styles.cardHold} maxFontSizeMultiplier={1.2}>
            按住直回
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

/** 大纲里的回复是 markdown 原文，卡片上只留文字：去掉标题井号、星号、行内代码。 */
function plainText(text: string): string {
  return text
    .replace(/[*#>`]/g, '')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
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
    head: { paddingTop: 4, paddingBottom: 8, gap: 2 },
    headTitle: { color: t.text.primary, fontSize: 13, fontWeight: '700', letterSpacing: 0.6 },
    headHint: { color: t.text.muted, fontSize: 11 },
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
    tagIdle: { color: t.text.muted },
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
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.bg.elevatedAnswer,
      borderWidth: 1.5,
      borderColor: t.border.activeOrigin,
    },
    orbCaption: { color: t.text.muted, fontSize: 11, letterSpacing: 0.3 },
    // 麦克风用三个 View 拼，避免 emoji 破坏单色调
    micCapsule: {
      width: 10,
      height: 16,
      borderRadius: 5,
      backgroundColor: t.text.secondary,
    },
    micCradle: {
      width: 18,
      height: 8,
      borderWidth: 1.4,
      borderTopWidth: 0,
      borderColor: t.text.secondary,
      borderBottomLeftRadius: 9,
      borderBottomRightRadius: 9,
      marginTop: -1,
    },
    micStem: { width: 1.4, height: 3, backgroundColor: t.text.secondary },
    micOn: { backgroundColor: t.action.primaryText },
    micCradleOn: { borderColor: t.action.primaryText },
    orbLive: { backgroundColor: t.action.primaryBg, borderColor: t.action.primaryBg },
    orbHint: { color: t.text.muted, fontSize: 12 },
  });
