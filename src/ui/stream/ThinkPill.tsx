import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  UIManager,
  View,
} from 'react-native';
import { PILL_HEIGHT, TYPE } from '../../theme/tokens';
import { softFeedback, tapFeedback } from '../haptics';
import { MONO, useTheme } from '../theme';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface Props {
  text: string;
  /**
   * Stage 01 正在流式输出 <think>：默认展开，配打字机游标；
   * 一旦进入 Stage 03 正式回答（answerStarted = true 或 streaming = false），立刻自动折叠成 34pt 单行胶囊。
   */
  streaming?: boolean;
  /** 正式回答正文是否已经开始输出（一旦为 true，即使回合还没彻底结束也立刻自动折叠推理） */
  answerStarted?: boolean;
  /** 思考开始时间戳（ms），用于实时跳动显示 0m 12s */
  startedAt?: number;
  /** 已知的思考耗时，比如 1m 42s */
  elapsed?: string;
}

/**
 * Stage 01 打字机默认展开 → Stage 03 正式回答开始瞬间自动折叠为 34pt 单行胶囊（§2.1）。
 * 用户随时可点按胶囊原地展开/收起复查。
 */
export function ThinkPill({ text, streaming, answerStarted, startedAt, elapsed }: Props) {
  const t = useTheme();
  // 只有还在流式思考、且正式回答还没开始吐字时，才处于 Stage 01 自动展开态
  const activelyThinking = Boolean(streaming && !answerStarted);
  const [manual, setManual] = useState<boolean | null>(null);
  const prevThinkingRef = useRef(activelyThinking);
  const [liveSec, setLiveSec] = useState(0);

  // 当从 Stage 01 (正在思考) 切换到 Stage 03 (正式回答开始) 时，主动触发过阻尼无回弹折叠与柔触反馈
  useEffect(() => {
    if (prevThinkingRef.current && !activelyThinking) {
      LayoutAnimation.configureNext( LayoutAnimation.Presets.easeInEaseOut );
      softFeedback();
      setManual(null);
    }
    prevThinkingRef.current = activelyThinking;
  }, [activelyThinking]);

  // 实时计时器：在思考阶段每秒刷新耗时
  useEffect(() => {
    if (!activelyThinking || !startedAt) return;
    const update = () => {
      setLiveSec(Math.max(1, Math.floor((Date.now() - startedAt) / 1000)));
    };
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [activelyThinking, startedAt]);

  const open = manual ?? activelyThinking;
  const summary = firstLine(text);
  const timeLabel = elapsed ?? (liveSec > 0 ? formatDuration(liveSec) : undefined);
  const tokenEst = estimateTokens(text);

  const toggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    tapFeedback();
    setManual(!open);
  };

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: t.bg.subtle, borderColor: t.border.subtle },
      ]}
    >
      <Pressable
        style={styles.header}
        onPress={toggle}
        hitSlop={4}
        accessibilityRole="button"
        accessibilityLabel={open ? '收起思考过程' : '展开思考过程'}
      >
        {activelyThinking ? (
          <ActivityIndicator size="small" color={t.text.muted} style={styles.spinner} />
        ) : (
          <Text style={[styles.sparkle, { color: t.text.muted }]}>✦</Text>
        )}
        <Text style={[styles.label, { color: t.text.primary }]} numberOfLines={1}>
          {activelyThinking ? '正在深度思考 <think>…' : '已深度思考'}
        </Text>
        <Text style={[styles.meta, { color: t.text.muted }]} numberOfLines={1}>
          ({[timeLabel, tokenEst].filter(Boolean).join(' · ')})
        </Text>
        {!open && summary ? (
          <Text style={[styles.summary, { color: t.text.secondary }]} numberOfLines={1}>
            · {summary}
          </Text>
        ) : null}
        <View style={styles.tail}>
          <Text style={[styles.meta, { color: t.text.muted }]}>{open ? '收起' : '展开'}</Text>
          <Text style={[styles.chevron, { color: t.text.muted }]}>{open ? '⌃' : '⌄'}</Text>
        </View>
      </Pressable>
      {open ? (
        <View style={[styles.body, { borderTopColor: t.border.subtle }]}>
          <Text style={[styles.bodyText, { color: t.text.secondary }]}>
            {text}
            {activelyThinking ? (
              <Text style={[styles.cursor, { color: t.text.primary }]}> ▍</Text>
            ) : null}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function firstLine(text: string): string {
  const lines = text
    .trim()
    .split('\n')
    .map((item) => item.replace(/^[#>*\-\d.\s]+/, '').trim())
    .filter(Boolean);
  const picked = lines[lines.length - 1] ?? lines[0] ?? '';
  return picked.length > 46 ? picked.slice(0, 46) + '…' : picked;
}

function formatDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
}

function estimateTokens(text: string): string {
  const count = Math.max(1, Math.round(text.length * 0.6));
  if (count >= 1000) return (count / 1000).toFixed(1) + 'k tok';
  return count + ' tok';
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  header: {
    minHeight: PILL_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 11,
    gap: 5,
  },
  spinner: { transform: [{ scale: 0.68 }], width: 14 },
  sparkle: { fontSize: 11, lineHeight: 14 },
  label: { ...TYPE.pill, fontFamily: MONO, fontWeight: '600', flexShrink: 0 },
  meta: {
    ...TYPE.pill,
    fontFamily: MONO,
    fontVariant: ['tabular-nums'],
    flexShrink: 0,
  },
  summary: { ...TYPE.pill, flex: 1 },
  tail: { flexDirection: 'row', alignItems: 'center', gap: 3, marginLeft: 'auto', paddingLeft: 4 },
  chevron: { ...TYPE.pill, fontFamily: MONO },
  body: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 11,
    paddingTop: 8,
    paddingBottom: 10,
  },
  bodyText: { ...TYPE.mono, fontFamily: MONO, lineHeight: 17 },
  cursor: { fontSize: 11, fontWeight: '700' },
});
