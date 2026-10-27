import { useEffect } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import type { ImageAttachmentRef } from '../protocol/types';

interface Props {
  refs: ImageAttachmentRef[];
  /** attachmentId → Base64 字节 */
  cache: Record<string, string>;
  onNeed?: (attachmentId: string) => void;
}

/** 历史里的图片只有引用，字节要靠 attachment 请求单独取，取到之前先占位。 */
export function MessageImages({ refs, cache, onNeed }: Props) {
  useEffect(() => {
    if (!onNeed) return;
    for (const ref of refs) {
      if (!cache[ref.attachmentId]) onNeed(ref.attachmentId);
    }
  }, [cache, onNeed, refs]);

  if (refs.length === 0) return null;

  return (
    <View style={styles.row}>
      {refs.map((ref) => {
        const data = cache[ref.attachmentId];
        const ratio = ref.width && ref.height ? ref.width / ref.height : 4 / 3;
        return (
          <View key={ref.attachmentId} style={[styles.frame, { aspectRatio: ratio }]}>
            {data ? (
              <Image
                source={{ uri: `data:${ref.mediaType};base64,${data}` }}
                style={styles.image}
                resizeMode="cover"
              />
            ) : (
              <Text style={styles.placeholder} numberOfLines={1}>
                图片
              </Text>
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  frame: {
    width: 148,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#1B1E25',
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: { width: '100%', height: '100%' },
  placeholder: { color: '#5B6070', fontSize: 12 },
});
