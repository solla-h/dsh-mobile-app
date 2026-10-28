import { useEffect, useMemo, useState } from 'react';
import { Animated, PanResponder, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import type { SessionItem } from '../../protocol/types';
import { MOTION, TYPE } from '../../theme/tokens';
import { MONO, useTheme } from '../theme';

interface Props {
  sessions: SessionItem[];
  activeId?: string;
  onSelect: (sessionId: string) => void;
}

const STRIP_H = 96;
const CARD_W = 184;
const CARD_H = 74;
/** 卡片中心间距：比卡片高 12pt，留一条呼吸缝，8 张也不会叠在一起。 */
const PITCH = 86;
/** 抛物线弧度：每远离选中间隔一格，就往屏幕边缘收 0.55 * d²。 */
const CURVE = 2.1;
/** 选中卡右边缘距屏幕边缘的基准距离，给外侧卡片留出弧顶空间。 */
const ANCHOR_RIGHT = 72;
const MAX_ITEMS = 8;

/**
 * 右侧拇指弧形会话转盘（§2.2）。
 * 静止态只是一条 2pt 感应条；按住后沿右侧展开一道弧形刻度，
 * 上下滑动选会话，松手即刻切换。选中项用弹簧吸附，切换有惯性。
 */
export function ArcDial({ sessions, activeId, onSelect }: Props) {
  const t = useTheme();
  const { height } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const list = useMemo(() => sessions.slice(0, MAX_ITEMS), [sessions]);
  // 渲染期不能读 ref，用 useState 拿一个稳定的 Animated.Value。
  const focus = useState(() => new Animated.Value(0))[0];

  const centerY = height * 0.46 + STRIP_H / 2;

  useEffect(() => {
    Animated.spring(focus, {
      toValue: index,
      useNativeDriver: true,
      tension: MOTION.collapse.tension,
      friction: 17,
    }).start();
  }, [focus, index]);

  const responder = useMemo(() => {
    /** 手指落在哪个刻度上：纵向按卡片间距等分，中间那格对准圆心。 */
    const indexAt = (pageY: number) =>
      clamp(Math.round((pageY - centerY) / PITCH + (list.length - 1) / 2), 0, list.length - 1);

    return PanResponder.create({
      onStartShouldSetPanResponder: () => list.length > 1,
      onMoveShouldSetPanResponder: () => list.length > 1,
      onPanResponderGrant: (_event, gesture) => {
        if (list.length < 2) return;
        setOpen(true);
        focus.setValue(indexAt(gesture.y0));
        setIndex(indexAt(gesture.y0));
      },
      onPanResponderMove: (_event, gesture) => {
        const next = indexAt(gesture.moveY);
        setIndex((current) => (current === next ? current : next));
      },
      onPanResponderRelease: (_event, gesture) => {
        setOpen(false);
        const picked = list[indexAt(gesture.moveY || gesture.y0)];
        if (picked && picked.sessionId !== activeId) onSelect(picked.sessionId);
      },
      onPanResponderTerminate: () => setOpen(false),
    });
  }, [activeId, centerY, focus, list, onSelect]);

  if (list.length < 2) return null;

  return (
    <>
      <View
        style={[styles.strip, { backgroundColor: t.border.default }]}
        // 2pt 只是视觉宽度：手指按不准，而且贴边会被系统返回手势抢走。
        // 命中区往左扩 22pt、上下各扩 18pt，并从边缘内缩 2pt 让开手势热区。
        hitSlop={{ left: 22, right: 0, top: 18, bottom: 18 }}
        {...responder.panHandlers}
        accessibilityRole="adjustable"
        accessibilityLabel="按住呼出会话转盘"
      >
        <View style={[styles.stripDot, { backgroundColor: t.text.muted }]} />
      </View>

      {open ? (
        <View style={styles.overlay} pointerEvents="none">
          <View style={styles.preview}>
            <Text style={[styles.previewCode, { color: t.text.muted }]}>{codeOf(index)}</Text>
            <Text style={[styles.previewTitle, { color: t.text.primary }]} numberOfLines={2}>
              {titleOf(list[index])}
            </Text>
            <Text style={[styles.previewMeta, { color: t.text.secondary }]} numberOfLines={1}>
              {repoOf(list[index])} · {list[index]?.running ? '运行中' : '空闲'}
            </Text>
          </View>

          {list.map((item, i) => {
            const selected = i === index;
            const delta = Animated.subtract(i, focus);
            const span = Math.max(1, list.length - 1);
            const steps = range(-span, span);
            return (
              <Animated.View
                key={item.sessionId}
                style={[
                  styles.card,
                  {
                    right: ANCHOR_RIGHT,
                    top: centerY - CARD_H / 2,
                    backgroundColor: selected ? t.bg.elevatedAnswer : t.bg.surface,
                    borderColor: selected ? t.text.primary : t.border.default,
                    zIndex: 40 - Math.abs(i - index),
                    opacity: delta.interpolate({
                      inputRange: steps,
                      outputRange: steps.map((d) => Math.max(0.22, 1 - 0.16 * Math.abs(d))),
                      extrapolate: 'clamp',
                    }),
                    transform: [
                      {
                        translateX: delta.interpolate({
                          inputRange: steps,
                          // 正号：越远的卡越往屏幕边缘靠，弧顶朝左，像贴在虎口上的刻度盘。
                          outputRange: steps.map((d) => CURVE * d * d),
                          extrapolate: 'clamp',
                        }),
                      },
                      {
                        translateY: delta.interpolate({
                          inputRange: steps,
                          outputRange: steps.map((d) => d * PITCH),
                          extrapolate: 'clamp',
                        }),
                      },
                      {
                        scale: delta.interpolate({
                          inputRange: steps,
                          outputRange: steps.map((d) => Math.max(0.7, 1 - 0.07 * Math.abs(d))),
                          extrapolate: 'clamp',
                        }),
                      },
                    ],
                  },
                ]}
              >
                <View style={styles.cardHead}>
                  <Text style={[styles.cardCode, { color: t.text.muted }]}>{codeOf(i)}</Text>
                  <View
                    style={[
                      styles.cardDot,
                      { backgroundColor: item.running ? t.semantic.gateAmberText : t.text.muted },
                    ]}
                  />
                </View>
                <Text style={[styles.cardTitle, { color: t.text.primary }]} numberOfLines={1}>
                  {titleOf(item)}
                </Text>
                <Text style={[styles.cardMeta, { color: t.text.muted }]} numberOfLines={1}>
                  {repoOf(item)}
                </Text>
              </Animated.View>
            );
          })}
        </View>
      ) : null}
    </>
  );
}

/** [-n..n] 的整数序列，给 interpolate 当 inputRange。 */
function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = from; i <= to; i += 1) out.push(i);
  return out;
}

function codeOf(index: number): string {
  return String(index + 1).padStart(2, '0');
}

function titleOf(item: SessionItem | undefined): string {
  return item?.projections?.values.title?.trim() || '未命名会话';
}

function repoOf(item: SessionItem | undefined): string {
  const cwd = item?.cwd ?? '';
  const parts = cwd.split('/').filter(Boolean);
  return parts.slice(-2).join('/') || '—';
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const styles = StyleSheet.create({
  strip: {
    position: 'absolute',
    right: 2,
    top: '46%',
    width: 2,
    height: STRIP_H,
    borderRadius: 1,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
  },
  stripDot: { width: 4, height: 4, borderRadius: 2, position: 'absolute', right: -1 },
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.28)',
    zIndex: 30,
  },
  preview: { position: 'absolute', left: 16, top: 72, width: 200, gap: 4 },
  previewCode: { ...TYPE.mono, fontFamily: MONO },
  previewTitle: { ...TYPE.title, fontWeight: '600' },
  previewMeta: { ...TYPE.caption },
  card: {
    position: 'absolute',
    width: CARD_W,
    height: CARD_H,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 7,
    justifyContent: 'center',
    gap: 2,
    overflow: 'hidden',
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardCode: { ...TYPE.pill, fontFamily: MONO },
  cardDot: { width: 5, height: 5, borderRadius: 2.5 },
  cardTitle: { ...TYPE.body, fontWeight: '600' },
  cardMeta: { ...TYPE.caption, fontFamily: MONO },
});
