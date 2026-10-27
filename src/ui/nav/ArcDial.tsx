import { useMemo, useState } from 'react';
import { PanResponder, StyleSheet, Text, View } from 'react-native';
import type { SessionItem } from '../../protocol/types';
import { TYPE } from '../../theme/tokens';
import { MONO, useTheme } from '../theme';

interface Props {
  sessions: SessionItem[];
  activeId?: string;
  onSelect: (sessionId: string) => void;
}

const STRIP_H = 96;
const ITEM_H = 52;
const ARC_R = 175;
const HALF_SPAN = 48; // -48° ~ +48°

/**
 * 右侧拇指弧形会话转盘（§2.2）。
 * 静止态只是一条 2pt 感应条；按住后沿右侧展开一道弧形刻度，
 * 上下滑动选会话，松手即刻切换。
 */
export function ArcDial({ sessions, activeId, onSelect }: Props) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const list = useMemo(() => sessions.slice(0, 8), [sessions]);

  const responder = useMemo(() => {
    /** 手指落在哪个刻度上：纵向按卡片高度等分，中间那格对准圆心。 */
    const indexAt = (pageY: number) =>
      clamp(Math.round((pageY - centerY()) / ITEM_H + (list.length - 1) / 2), 0, list.length - 1);

    return PanResponder.create({
      onStartShouldSetPanResponder: () => list.length > 1,
      onMoveShouldSetPanResponder: () => list.length > 1,
      onPanResponderGrant: (_event, gesture) => {
        if (list.length < 2) return;
        setOpen(true);
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
  }, [list, activeId, onSelect]);

  if (list.length < 2) return null;

  return (
    <>
      <View
        style={[styles.strip, { backgroundColor: t.border.default }]}
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
            const theta =
              ((-HALF_SPAN + (HALF_SPAN * 2 * i) / Math.max(1, list.length - 1)) * Math.PI) / 180;
            const push = ARC_R * (1 - Math.cos(theta));
            const selected = i === index;
            return (
              <View
                key={item.sessionId}
                style={[
                  styles.card,
                  {
                    right: 14 + push,
                    top: centerY() - ITEM_H / 2 + (i - (list.length - 1) / 2) * ITEM_H,
                    backgroundColor: selected ? t.bg.elevatedAnswer : t.bg.surface,
                    borderColor: selected ? t.text.primary : t.border.default,
                    opacity: selected ? 1 : 0.85,
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
              </View>
            );
          })}
        </View>
      ) : null}
    </>
  );
}

/** 转盘圆心固定在屏幕右侧外侧，纵向大致在下半屏。 */
function centerY(): number {
  return 380;
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
    right: 0,
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
    width: 208,
    minHeight: ITEM_H - 8,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 1,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardCode: { ...TYPE.mono, fontFamily: MONO },
  cardDot: { width: 6, height: 6, borderRadius: 3 },
  cardTitle: { ...TYPE.caption, fontWeight: '600' },
  cardMeta: { ...TYPE.mono, fontFamily: MONO },
});
