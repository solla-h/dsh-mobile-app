import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useThemedStyles } from '../theme';
import type { Palette } from '../../theme/tokens';

/**
 * 「插件」页目前的诚实版本：展示网关在 hello 里自报的能力位。
 *
 * 真正的插件管理走 control 连接的 plugin-management-v1，要单独的配对与授权，
 * 还没接。这里不画假开关——只把「服务器现在支持什么」摆出来。
 */

const LABELS: Record<string, string> = {
  'split-channels': '双通道（control / conversation）',
  'assistant-stream-v1': '助手流式输出',
  'history-format-version': '历史格式版本号',
  'projection-baseline': '投影基线（任务/目标/大纲）',
  'turn-outline-v1': '轮次大纲',
  images: '图片收发',
  'session-create': '新建会话',
  'session-agent-preset': '会话模式切换',
  'agent-team-v1': '智能体团队',
  'subagent-conversations-v1': '子会话',
  commands: '命令与技能目录',
  tasks: '任务列表',
  goals: '目标',
  'schedule-management': '定时任务管理',
  'plugin-management-v1': '插件管理',
  'speech-input-v1': '语音输入',
  'file-upload-v1': '文件上传',
  'session-cancel': '停止当前回合',
  'queue-control': '队列控制',
  'session-archive': '会话归档',
  'session-rename': '会话改名',
  'file-downloads': '文件下载',
  'file-references-v1': '文件引用解析',
};

interface Props {
  capabilities: string[];
  gatewayName?: string;
  protocol?: number;
  deviceName?: string;
  speechReady: boolean;
}

export function CapabilitiesView({
  capabilities,
  gatewayName,
  protocol,
  deviceName,
  speechReady,
}: Props) {
  const styles = useThemedStyles(makeStyles);
  const list = capabilities.filter((id) => id !== 'speech-input-v1');
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <Text style={styles.title} maxFontSizeMultiplier={1.3}>
        服务器能力与桥接
      </Text>
      <Text style={styles.subtitle} maxFontSizeMultiplier={1.3}>
        {gatewayName ?? '网关'} · 协议 v{protocol ?? '?'} · {deviceName ?? '未知设备'}
      </Text>

      <View style={styles.sectionRow}>
        <Text style={styles.sectionTitle} maxFontSizeMultiplier={1.3}>
          远程网关能力
        </Text>
        <Text style={styles.sectionCount}>{list.length} 项</Text>
      </View>

      {list.map((id) => (
        <View key={id} style={styles.row}>
          <View style={styles.dot} />
          <Text style={styles.rowText} numberOfLines={1} maxFontSizeMultiplier={1.3}>
            {LABELS[id] ?? id}
          </Text>
          {LABELS[id] ? null : (
            <Text style={styles.rowId} numberOfLines={1}>
              {id}
            </Text>
          )}
        </View>
      ))}

      <View style={styles.sectionRow}>
        <Text style={styles.sectionTitle} maxFontSizeMultiplier={1.3}>
          本机桥接
        </Text>
      </View>
      <View style={styles.row}>
        <View style={[styles.dot, speechReady ? styles.dotOn : styles.dotOff]} />
        <Text style={styles.rowText} maxFontSizeMultiplier={1.3}>
          语音输入（本地 SenseVoice）
        </Text>
        <Text style={styles.rowId}>{speechReady ? '就绪' : '未就绪'}</Text>
      </View>
      <View style={styles.row}>
        <View style={[styles.dot, styles.dotOff]} />
        <Text style={styles.rowText} maxFontSizeMultiplier={1.3}>
          插件管理
        </Text>
        <Text style={styles.rowId}>待接入</Text>
      </View>

      <Text style={styles.footnote} maxFontSizeMultiplier={1.3}>
        插件安装/启停需要 control 通道的配对授权，当前还没接；这里只列网关自报的能力位。
      </Text>
    </ScrollView>
  );
}

const makeStyles = (t: Palette) =>
  StyleSheet.create({
    scroll: { flex: 1 },
    content: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 24 },
    title: { color: t.text.primary, fontSize: 20, fontWeight: '700' },
    subtitle: { color: t.text.muted, fontSize: 12, marginTop: 4, marginBottom: 14 },
    sectionRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      marginTop: 14,
      marginBottom: 4,
    },
    sectionTitle: { color: t.text.secondary, fontSize: 12, fontWeight: '700', letterSpacing: 0.4 },
    sectionCount: { color: t.text.muted, fontSize: 11, minWidth: 32, textAlign: 'right' },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 9,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.border.subtle,
    },
    dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: t.text.secondary },
    dotOn: { backgroundColor: t.semantic.diffAddText },
    dotOff: { backgroundColor: t.border.default },
    rowText: { flex: 1, color: t.text.primary, fontSize: 13 },
    rowId: { color: t.text.muted, fontSize: 10, maxWidth: 140 },
    footnote: { color: t.text.muted, fontSize: 11, lineHeight: 16, marginTop: 16 },
  });
