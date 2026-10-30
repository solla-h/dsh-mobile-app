import { FlatList, StyleSheet, Text, View } from 'react-native';

import type { ChatMessage } from '../../protocol/chat';
import { MONO, useTheme, useThemedStyles } from '../theme';
import type { Palette } from '../../theme/tokens';

/**
 * 轨迹视图：整轮的时间线，一条不折叠。
 *
 * 与对话视图互补——对话流里正文优先（思考/工具收成胶囊），
 * 这里把每个思考块、每次工具调用按发生顺序完整摊开，便于审计和回查。
 * 内容用等宽小字直排，不做 Markdown/折叠，保持「账本」的朴素感。
 */

interface Props {
  messages: ChatMessage[];
}

function timeOf(message: ChatMessage): number {
  return message.time;
}

function labelOf(message: ChatMessage): { who: string; tone: keyof Palette['text'] } {
  if (message.kind === 'user') return { who: '你', tone: 'primary' };
  if (message.kind === 'assistant') {
    return message.text.trim()
      ? { who: '回答', tone: 'primary' }
      : { who: '思考', tone: 'secondary' };
  }
  if (message.kind === 'tool') return { who: message.name || '工具', tone: 'secondary' };
  if (message.kind === 'files') return { who: '交付文件', tone: 'secondary' };
  if (message.kind === 'notice') return { who: '通知', tone: 'muted' };
  return { who: '排队', tone: 'muted' };
}

export function TrajectoryView({ messages }: Props) {
  const styles = useThemedStyles(makeStyles);
  const t = useTheme();

  const renderItem = ({ item }: { item: ChatMessage }) => {
    const { who, tone } = labelOf(item);
    const time = new Date(timeOf(item)).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    let body: string | null = null;
    if (item.kind === 'user' || item.kind === 'queued') body = item.text || null;
    else if (item.kind === 'assistant') body = item.text.trim() || item.reasoning || null;
    else if (item.kind === 'tool') {
      const args = item.args ? '参数: ' + item.args : '';
      const output =
        item.output !== undefined ? '输出: ' + item.output.slice(0, 400) : '（运行中）';
      body = [args, output].filter(Boolean).join('\n') || null;
    } else if (item.kind === 'files') {
      body = item.files.map((file) => file.path).join('\n') || null;
    } else if (item.kind === 'notice') {
      body = item.text;
    }

    return (
      <View style={styles.row}>
        <View style={styles.head}>
          <Text style={[styles.who, { color: t.text[tone] }]} numberOfLines={1}>
            {who}
          </Text>
          <Text style={styles.time}>{time}</Text>
        </View>
        {body ? (
          <Text style={[styles.body, { color: t.text.secondary }]}>{body}</Text>
        ) : null}
        {item.kind === 'assistant' && item.reasoning && item.text.trim() ? (
          <View style={[styles.reasonBox, { borderColor: t.border.subtle }]}>
            <Text style={[styles.reasonTag, { color: t.text.muted }]}>思考</Text>
            <Text style={[styles.body, { color: t.text.muted }]}>{item.reasoning}</Text>
          </View>
        ) : null}
        {item.kind === 'tool' && item.isError ? (
          <Text style={styles.toolError}>⚠ 这一步失败了</Text>
        ) : null}
      </View>
    );
  };

  return (
    <FlatList
      data={messages}
      keyExtractor={(item) => item.id}
      renderItem={renderItem}
      contentContainerStyle={styles.list}
      initialNumToRender={24}
      maxToRenderPerBatch={24}
    />
  );
}

const makeStyles = (t: Palette) =>
  StyleSheet.create({
    list: { paddingHorizontal: 12, paddingBottom: 12, gap: 8 },
    row: {
      borderLeftWidth: 2,
      borderLeftColor: t.border.subtle,
      paddingLeft: 10,
      paddingVertical: 4,
      gap: 3,
    },
    head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    who: { fontSize: 12, fontWeight: '700' },
    time: {
      color: t.text.muted,
      fontSize: 10,
      fontFamily: MONO,
      fontVariant: ['tabular-nums'],
    },
    body: {
      fontSize: 11.5,
      lineHeight: 16,
      fontFamily: MONO,
      flexWrap: 'wrap',
    },
    reasonBox: {
      borderLeftWidth: StyleSheet.hairlineWidth,
      borderLeftColor: t.border.default,
      paddingLeft: 8,
      marginTop: 2,
      gap: 2,
    },
    reasonTag: { fontSize: 10, fontWeight: '700' },
    toolError: { color: t.semantic.dangerText, fontSize: 11 },
  });
