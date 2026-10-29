import { StyleSheet, Text, View } from 'react-native';
import { useThemedStyles } from '../theme';
import type { Palette } from '../../theme/tokens';

/**
 * 定时任务页：只读账本。
 *
 * 数据来自 control 连接的 schedule-catalog，**必须在 control 通道上发**（协议规定）。
 * 新建/修改/立即执行都要 schedule-update / Host 的 schedule_create 工具，
 * 现在只做「看」，不做「改」。
 */
export interface ScheduleRow {
  id: string;
  title: string;
  detail?: string;
  status?: string;
  schedule?: string;
}

function pick(row: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

/** 服务端字段形状没有在协议里写死，这里按已知候选挑选，认不出就只显示 id。 */
export function mapSchedules(items: unknown): ScheduleRow[] {
  if (!Array.isArray(items)) return [];
  const rows: ScheduleRow[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as Record<string, unknown>;
    const id = typeof raw.id === 'string' && raw.id ? raw.id : undefined;
    if (!id) continue;
    rows.push({
      id,
      title: pick(raw, ['title', 'name']) ?? pick(raw, ['prompt']) ?? id,
      detail: pick(raw, ['lastResult', 'summary', 'lastSummary']),
      status: pick(raw, ['status', 'state']),
      schedule: pick(raw, ['cron', 'expression', 'human', 'description']),
    });
  }
  return rows;
}

export function SchedulesView({ rows, catalogReady }: { rows: ScheduleRow[]; catalogReady: boolean }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.root}>
      <Text style={styles.title} maxFontSizeMultiplier={1.3}>
        定时巡航账本
      </Text>
      <Text style={styles.subtitle} maxFontSizeMultiplier={1.3}>
        静默规律运行 · 仅在异常时通知你
      </Text>

      {rows.length === 0 ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyTitle} maxFontSizeMultiplier={1.3}>
            {catalogReady ? '这台网关还没有定时任务' : '正在读取定时任务…'}
          </Text>
          <Text style={styles.emptyHint} maxFontSizeMultiplier={1.3}>
            定时任务由 agent 用 schedule_create 创建，手机端目前只读。
          </Text>
        </View>
      ) : (
        rows.map((row) => (
          <View key={row.id} style={styles.row}>
            <View style={styles.rowHead}>
              <Text style={styles.schedule} numberOfLines={1}>
                {row.schedule ?? row.id}
              </Text>
              {row.status ? <Text style={styles.status}>{row.status}</Text> : null}
            </View>
            <Text style={styles.rowTitle} numberOfLines={2} maxFontSizeMultiplier={1.3}>
              {row.title}
            </Text>
            {row.detail ? (
              <Text style={styles.rowDetail} numberOfLines={2} maxFontSizeMultiplier={1.3}>
                {row.detail}
              </Text>
            ) : null}
          </View>
        ))
      )}
    </View>
  );
}

const makeStyles = (t: Palette) =>
  StyleSheet.create({
    root: { flex: 1, paddingHorizontal: 20 },
    title: { color: t.text.primary, fontSize: 20, fontWeight: '700' },
    subtitle: { color: t.text.muted, fontSize: 12, marginTop: 4, marginBottom: 14 },
    emptyBox: { paddingVertical: 28, gap: 6 },
    emptyTitle: { color: t.text.primary, fontSize: 15, fontWeight: '600' },
    emptyHint: { color: t.text.muted, fontSize: 12, lineHeight: 17 },
    row: {
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.border.subtle,
      gap: 4,
    },
    rowHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    schedule: { color: t.text.muted, fontSize: 11, flex: 1 },
    status: { color: t.text.secondary, fontSize: 10, fontWeight: '700' },
    rowTitle: { color: t.text.primary, fontSize: 14, fontWeight: '600' },
    rowDetail: { color: t.text.secondary, fontSize: 12, lineHeight: 17 },
  });
