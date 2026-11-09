import { useEffect, useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import type { ImageAttachmentRef } from '../protocol/types';
import { useThemedStyles } from './theme';
import type { Palette } from '../theme/tokens';

interface Props {
  refs: ImageAttachmentRef[];
  /** attachmentId → Base64 字节 */
  cache: Record<string, string>;
  onNeed?: (attachmentId: string) => void;
}

const GAP = 6;
/** 和 SessionScreen 的 list.paddingHorizontal / bubble.maxWidth / padding 对齐。 */
const LIST_PADDING = 28;
const BUBBLE_RATIO = 0.86;
const BUBBLE_PADDING = 28;
const MAX_SINGLE = 220;
const MAX_CELL = 148;

/** 历史里的图片只有引用，字节要靠 attachment 请求单独取，取到之前先占位。 */
export function MessageImages({ refs, cache, onNeed }: Props) {
  const styles = useThemedStyles(makeStyles);
  const [viewing, setViewing] = useState<string | null>(null);
  const { width: windowWidth } = useWindowDimensions();

  useEffect(() => {
    if (!onNeed) return;
    for (const ref of refs) {
      if (!cache[ref.attachmentId]) onNeed(ref.attachmentId);
    }
  }, [cache, onNeed, refs]);

  if (refs.length === 0) return null;

  // 按气泡的最大可用宽度算列宽。别用 onLayout 量这一行：换行行本身的宽度
  // 取决于子项宽度，会和气泡互相收敛到「一列」，反而排不开。
  const columns = refs.length === 1 ? 1 : refs.length <= 4 ? 2 : 3;
  const content = (windowWidth - LIST_PADDING) * BUBBLE_RATIO - BUBBLE_PADDING;
  const cell = Math.min(
    Math.max((content - GAP * (columns - 1)) / columns, 56),
    refs.length === 1 ? MAX_SINGLE : MAX_CELL,
  );

  return (
    <View style={styles.row}>
      {refs.map((ref) => {
        const data = cache[ref.attachmentId];
        const ratio = ref.width && ref.height ? ref.width / ref.height : 4 / 3;
        const uri = data ? `data:${ref.mediaType};base64,${data}` : null;
        return (
          <Pressable
            key={ref.attachmentId}
            style={[styles.frame, { width: cell, aspectRatio: ratio }]}
            onPress={uri ? () => setViewing(uri) : undefined}
            disabled={!uri}
          >
            {uri ? (
              <Image source={{ uri }} style={styles.image} resizeMode="cover" />
            ) : (
              <Text style={styles.placeholder} numberOfLines={1}>
                图片
              </Text>
            )}
          </Pressable>
        );
      })}
      <ImageViewer uri={viewing} onClose={() => setViewing(null)} />
    </View>
  );
}

/** 全屏看图：点任意位置关闭，够用且不会误触缩放。 */
export function ImageViewer({ uri, onClose }: { uri: string | null; onClose: () => void }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Modal visible={Boolean(uri)} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        {uri ? <Image source={{ uri }} style={styles.viewer} resizeMode="contain" /> : null}
        <Text style={styles.hint}>轻点关闭</Text>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (t: Palette) =>
  StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  frame: {
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: t.bg.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: { width: '100%', height: '100%' },
  placeholder: { color: t.text.muted, fontSize: 12 },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.94)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewer: { width: '100%', height: '80%' },
  hint: { position: 'absolute', bottom: 40, color: t.text.muted, fontSize: 12 },
});
