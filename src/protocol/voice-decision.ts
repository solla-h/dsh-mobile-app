/**
 * 语音审批：把一段语音转写映射成「批准 / 拒绝」。
 *
 * 这一票可能是放行一次写操作，所以只认整句命中：多说了别的、语气是疑问、
 * 句子里带否定，一律按「听不懂」处理，让用户再说一遍，绝不猜。
 */

export type VoiceDecision = 'approve' | 'reject';

/** 整句等于这些词才算肯定，避免「不要继续」被「继续」命中。 */
const APPROVE_WORDS = new Set([
  '可以',
  '行',
  '好',
  '好的',
  '好嘞',
  '同意',
  '批准',
  '允许',
  '确认',
  '继续',
  '执行',
  '放行',
  'ok',
  'okay',
  'yes',
  'yep',
  'yeah',
  'sure',
  'go',
]);

/** 整句等于这些词才算否定。 */
const REJECT_WORDS = new Set([
  '不行',
  '不可以',
  '不要',
  '别',
  '否',
  '拒绝',
  '取消',
  '停',
  '停下',
  '算了',
  'no',
  'nope',
  'reject',
  'deny',
  'cancel',
  'stop',
]);

/** 否定词优先级最高：句子里出现一个就按拒绝处理。 */
const NEGATIONS = ['不', '别', '没', '勿', '禁止'];

/** 疑问语气不是授权：「可以吗」「行吗」都要重新问。 */
const QUESTION_MARKERS = ['吗', '么'];

/** 句尾语气词，剥掉之后才可能命中白名单（「好的呀」= 「好的」）。 */
const TRAILING_PARTICLES = new Set(['吧', '啊', '呀', '呢', '哦', '嘛', '哈']);

/** 用户随口带出来的两端标点，只剥两端，句中的不动（否定词要留着）。 */
const EDGE_PUNCTUATION = new Set([
  ...'!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~',
  ...'，。、；：？！…—～·「」『』（）【】《》〈〉〔〕“”‘’',
]);

function isEdgeChar(char: string): boolean {
  return char !== '' && (EDGE_PUNCTUATION.has(char) || char.trim() === '');
}

/** 全角 ASCII 与全角空格折成半角，否则「ＯＫ」永远匹配不上。 */
function toHalfWidth(text: string): string {
  let out = '';
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (code === 0x3000) out += ' ';
    else if (code >= 0xff01 && code <= 0xff5e) out += String.fromCharCode(code - 0xfee0);
    else out += char;
  }
  return out;
}

function stripTrailingParticles(text: string): string {
  let end = text.length;
  while (end > 0 && TRAILING_PARTICLES.has(text.charAt(end - 1))) end -= 1;
  return text.slice(0, end);
}

/** 两端可能是「好的呀。」这种标点和语气词交替出现，剥干净为止。 */
function trimEdges(text: string): string {
  let current = text;
  for (;;) {
    let start = 0;
    let end = current.length;
    while (start < end && isEdgeChar(current.charAt(start))) start += 1;
    while (end > start && isEdgeChar(current.charAt(end - 1))) end -= 1;
    const next = stripTrailingParticles(current.slice(start, end));
    if (next === current) return current;
    current = next;
  }
}

function normalize(transcript: string): string {
  return trimEdges(toHalfWidth(transcript).trim().toLowerCase());
}

/**
 * 转写文本 → 审批结论。听不懂就返回 null，调用方据此重新收音，
 * 不要拿 null 当默认值去点按钮。
 */
export function matchDecision(transcript: string): VoiceDecision | null {
  if (typeof transcript !== 'string') return null;
  const text = normalize(transcript);
  if (!text) return null;
  // 否定优先于一切：「没有问题」「不要继续」里都有肯定词，但意思是否定。
  if (NEGATIONS.some((word) => text.includes(word))) return 'reject';
  // 疑问不是许可：「可以吗」要重新问一次。
  if (QUESTION_MARKERS.some((mark) => text.includes(mark))) return null;
  // 只认整句命中：「可以但是慢点」这种带了别的话就不算。
  if (APPROVE_WORDS.has(text)) return 'approve';
  if (REJECT_WORDS.has(text)) return 'reject';
  return null;
}
