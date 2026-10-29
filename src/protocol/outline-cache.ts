/**
 * 回合大纲（turnOutline）：每个会话最近若干轮的 prompt / response 摘要。
 * 首页拿它在列表里显示「最后一句回复」，不必为了预览去拉整段历史。
 *
 * 服务端有两条相关帧：
 * - projection-baseline：整份快照，必须整体替换（快照里缺席的会话就是已经被删了）；
 * - turn-outline-updated：单会话增量，turnOutline: null 表示失效（把这个会话删掉），
 *   [] 则是「有会话但大纲为空」，要留着。
 */

export interface TurnOutlineEntry {
  turn: number;
  seq: number;
  prompt: string;
  response: string;
}

/** sessionId → 该会话的大纲（按服务端给的顺序，不重排）。 */
export type OutlineMap = Record<string, TurnOutlineEntry[]>;

// 服务端下发前已经截断过；这里只是兜底，别让一条坏 entry 把列表撑爆。
const MAX_PROMPT = 50;
const MAX_RESPONSE = 120;

const text = (value: unknown, limit: number): string =>
  typeof value === 'string' ? value.slice(0, limit) : '';

const isNum = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/**
 * 解析一条 turnOutline 数组。
 * 返回 undefined 表示字段本身不合法（不是数组）；[] 是合法的空大纲，别当成不合法。
 */
function parseEntries(value: unknown): TurnOutlineEntry[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const entries: TurnOutlineEntry[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as Record<string, unknown>;
    // turn / seq 是定位用的，缺了这条 entry 就没意义，直接丢。
    if (!isNum(raw.turn) || !isNum(raw.seq)) continue;
    // 文本字段坏了不至于丢整轮，退化成空串，UI 自己会跳过。
    entries.push({
      turn: raw.turn,
      seq: raw.seq,
      prompt: text(raw.prompt, MAX_PROMPT),
      response: text(raw.response, MAX_RESPONSE),
    });
  }
  return entries;
}

function sameEntries(a: TurnOutlineEntry[], b: TurnOutlineEntry[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i];
    const right = b[i];
    if (!left || !right) return false;
    if (left.turn !== right.turn || left.seq !== right.seq) return false;
    if (left.prompt !== right.prompt || left.response !== right.response) return false;
  }
  return true;
}

function sameMap(a: OutlineMap, b: OutlineMap): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => {
    const other = b[key];
    // 右边缺这个 key 就是有变化（快照里删掉了会话）。
    return other !== undefined && sameEntries(a[key], other);
  });
}

/** 快照帧：整体替换，快照里没有的会话一律清掉。 */
function applyBaseline(map: OutlineMap, frame: Record<string, unknown>): OutlineMap | null {
  const projections = frame.projections;
  if (!projections || typeof projections !== 'object' || Array.isArray(projections)) return null;
  const next: OutlineMap = {};
  for (const [sessionId, value] of Object.entries(projections as Record<string, unknown>)) {
    if (!sessionId || !value || typeof value !== 'object') continue;
    const values = (value as Record<string, unknown>).values;
    if (!values || typeof values !== 'object') continue;
    const entries = parseEntries((values as Record<string, unknown>).turnOutline);
    // null / 缺字段 = 这个会话没有大纲；不写进 next 就等于删掉。
    if (entries) next[sessionId] = entries;
  }
  return sameMap(map, next) ? null : next;
}

/** 增量帧：null 失效删除，数组则覆盖这个会话。 */
function applyUpdated(map: OutlineMap, frame: Record<string, unknown>): OutlineMap | null {
  const sessionId = frame.sessionId;
  if (typeof sessionId !== 'string' || !sessionId) return null;
  if (!Object.prototype.hasOwnProperty.call(frame, 'turnOutline')) return null;

  const outline = frame.turnOutline;
  if (outline === null) {
    if (!Object.prototype.hasOwnProperty.call(map, sessionId)) return null;
    const next = { ...map };
    delete next[sessionId];
    return next;
  }

  const entries = parseEntries(outline);
  if (!entries) return null;
  const existing = map[sessionId];
  if (existing && sameEntries(existing, entries)) return null;
  return { ...map, [sessionId]: entries };
}

/**
 * 归约一帧大纲。返回 null 表示这一帧没有改变任何状态，
 * 调用方可以据此跳过 setState（流式回复时这类帧来得非常密）。
 */
export function applyOutlineFrame(map: OutlineMap, frame: unknown): OutlineMap | null {
  if (!frame || typeof frame !== 'object') return null;
  const raw = frame as Record<string, unknown>;
  switch (raw.kind) {
    case 'projection-baseline':
      return applyBaseline(map, raw);
    case 'turn-outline-updated':
      return applyUpdated(map, raw);
    default:
      return null;
  }
}

/**
 * 列表里那一行预览：最后一条非空的 response。
 * 正在跑的那一轮 response 还是空串，所以要从后往前找，而不是直接取最后一条。
 */
export function lastResponse(map: OutlineMap, sessionId: string): string | undefined {
  const entries = map[sessionId];
  if (!entries || entries.length === 0) return undefined;
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (!entry) continue;
    const line = entry.response.trim();
    if (line) return line;
  }
  return undefined;
}

export function entryCount(map: OutlineMap): number {
  return Object.values(map).reduce((sum, entries) => sum + entries.length, 0);
}
