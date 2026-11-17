import type { File } from 'expo-file-system';

/**
 * APK 下载后的完整性校验（issue #12，chunk 4 第一步）。
 *
 * 职责边界：只做「解析校验和 → 按 URL 推导文件名 → 比对下载文件摘要」，
 * 不发起下载、不拉起安装 Intent、不碰 app.json / config plugin。
 * 除 `File.digest()` 外不引入任何运行时依赖：解析函数在 Node 里可直接单测。
 */

/** SHA256SUMS 的单行格式：`<hex>  <filename>` 或 `<hex> *<filename>`。 */
const CHECKSUM_LINE = /^([0-9a-fA-F]{64}) [ *](.+)$/;

/** 合法的 SHA-256 摘要：64 个十六进制字符。 */
const SHA256_HEX = /^[0-9a-f]{64}$/i;

/**
 * 从 SHA256SUMS 内容里取 fileName 对应的摘要。
 *
 * - 支持 GNU coreutils 的文本模式（两个空格）与二进制模式（`*`）。
 * - 返回文件里写的原始大小写；找不到、空文件名或该行格式不合法时返回 null。
 * - 其它行（包括不相关的坏行）不影响目标行的匹配。
 */
export function parseSha256Sums(text: string, fileName: string): string | null {
  if (typeof text !== 'string' || typeof fileName !== 'string' || fileName.length === 0) {
    return null;
  }

  for (const rawLine of text.split('\n')) {
    // 兼容 CRLF：只去掉行尾回车，文件名里的空格必须原样保留。
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    const match = CHECKSUM_LINE.exec(line);
    if (match === null) continue;

    const hash = match[1];
    const name = match[2];
    if (hash === undefined || name === undefined) continue;
    if (name === fileName) return hash;
  }

  return null;
}

/**
 * 取 APK 下载地址的最后一段路径作为文件名；只接受 https。
 * 空路径、结尾斜杠、非法 URL 或非 https 一律返回 null。
 */
export function apkFileNameFromUrl(apkUrl: string): string | null {
  if (typeof apkUrl !== 'string' || apkUrl.length === 0) return null;

  let parsed: URL;
  try {
    parsed = new URL(apkUrl);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:') return null;

  const segments = parsed.pathname.split('/');
  const last = segments[segments.length - 1];
  return last === undefined || last.length === 0 ? null : last;
}

/**
 * 计算文件 SHA-256 并与期望值比对（大小写不敏感）。
 *
 * 期望值不是 64 位十六进制时直接 false，不去碰文件；
 * 摘要读取失败（文件被删、被截断）也返回 false，让上游走「删除 + 手动下载」，
 * 而不是把异常抛进 UI。
 */
export async function verifySha256(file: File, expectedHash: string): Promise<boolean> {
  if (!SHA256_HEX.test(expectedHash)) return false;

  let actual: string;
  try {
    actual = await file.digest('SHA-256');
  } catch {
    return false;
  }

  return actual.toLowerCase() === expectedHash.toLowerCase();
}
