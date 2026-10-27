import { useEffect, useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import type { ImageAttachmentRef } from '../protocol/types';

interface Props {
  refs: ImageAttachmentRef[];
  /** attachmentId → Base64 字节 */
  cache: Record<string, string>;
  onNeed?: (attachmentId: string) => void;
}

const GAP = 6;
/** 单图别缩得太小，多图按列数摊平。 */
const MAX_SINGLE = 220;
const MAX_CELL = 148;

/** 历史里的图片只有引用，字节要靠 attachment 请求单独取，取到之前先占位。 */
export function MessageImages({ refs, cache, onNeed }: Props) {
  const [viewing, setViewing] = useState<string | null>(null);
  /** 气泡可用宽度：按它算列宽，否则固定 148 在窄气泡里只能排一列。 */
  const [boxWidth, setBoxWidth] = useState(0);

  useEffect(() => {
    if (!onNeed) return;
    for (const ref of refs) {
      if (!cache[ref.attachmentId]) onNeed(ref.attachmentId);
    }
  }, [cache, onNeed, refs]);

  if (refs.length === 0) return null;

  const columns = refs.length === 1 ? 1 : refs.length <= 4 ? 2 : 3;
  const available = boxWidth > 0 ? boxWidth - GAP * (columns - 1) : MAX_CELL * columns;
  const cell = Math.min(
    Math.max(available / columns, 56),
    refs.length === 1 ? MAX_SINGLE : MAX_CELL,
  );

  return (
    <View
      style={styles.row}
      onLayout={(event) => {
        const next = Math.round(event.nativeEvent.layout.width);
        if (next > 0 && next !== boxWidth) setBoxWidth(next);
      }}
    >
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
  return (
    <Modal visible={Boolean(uri)} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        {uri ? <Image source={{ uri }} style={styles.viewer} resizeMode="contain" /> : null}
        <Text style={styles.hint}>轻点关闭</Text>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  frame: {
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#1B1E25',
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: { width: '100%', height: '100%' },
  placeholder: { color: '#5B6070', fontSize: 12 },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.94)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewer: { width: '100%', height: '80%' },
  hint: { position: 'absolute', bottom: 40, color: '#5B6070', fontSize: 12 },
});
