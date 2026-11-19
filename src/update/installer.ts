import { applicationId } from 'expo-application';
import { Directory, File, Paths } from 'expo-file-system';
import type { DownloadTask } from 'expo-file-system';
import { ActivityAction, startActivityAsync } from 'expo-intent-launcher';

import { isAllowedUpdateUrl, type LatestManifest } from './manifest';

/**
 * APK 下载、校验与安装编排（issue #12，chunk 4）。
 *
 * 职责边界：只做「校验 URL → 下载到应用私有缓存 → 校验 SHA-256 → 拉起系统安装器」。
 * 不碰 app.json / config plugin，不产出用户可见文案；UI 层只消费这里的状态码。
 *
 * 平台：安装链路仅 Android 有效。本文件不引入 react-native，调用方负责平台判断。
 */

const HASH_FETCH_TIMEOUT_MS = 15_000;

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('aborted');
}

/** SHA256SUMS 的单行格式：`<hex>  <filename>` 或 `<hex> *<filename>`。 */
const CHECKSUM_LINE = /^([0-9a-fA-F]{64}) [ *](.+)$/;

/** 合法的 SHA-256 摘要：64 个十六进制字符。 */
const SHA256_HEX = /^[0-9a-f]{64}$/i;

/** 更新包缓存在应用私有目录下的子目录，不写外部存储。 */
const UPDATE_CACHE_DIR = 'dsh-updates';

/** APK 的 MIME 类型：系统安装器只认这个。 */
const APK_MIME_TYPE = 'application/vnd.android.package-archive';

/** 拉起系统安装器的 action。 */
const ACTION_VIEW = 'android.intent.action.VIEW';

/** Intent.FLAG_GRANT_READ_URI_PERMISSION；content:// URI 必须显式授权。 */
const FLAG_GRANT_READ_URI_PERMISSION = 1;

/** 安装拉起结果。expected failure 只回状态，不抛异常。 */
export type InstallStatus = 'launched' | 'needs-unknown-sources' | 'failed';

/** 下载 + 校验失败的三类原因，供 UI 决定重试还是回退手动下载。 */
export type DownloadFailure = 'download' | 'checksum' | 'url';

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

/**
 * 删除缓存文件；文件已不存在时 delete() 会抛错，这里吞掉。
 * 清理失败不改变调用方结论：下次下载会先删同名文件。
 */
function deleteQuietly(file: File): void {
  try {
    if (file.exists) file.delete();
  } catch {
    // 忽略：调用方已经拿到失败状态，不能让清理异常盖掉它。
  }
}

/**
 * 下载 APK 到应用私有缓存目录。
 *
 * - 先过 `isAllowedUpdateUrl`：非 https / 非官方主机在创建任务前就拒绝，不发网络请求。
 * - 进度按 bytesWritten / totalBytes 归一化到 0..1；服务端没给 Content-Length 时不回调。
 * - `signal` 直接交给 DownloadTask，abort 时 downloadAsync() 以 AbortError 拒绝。
 * - 任何失败（含取消）都删除半成品，绝不留一个可被误装的残包。
 */
export async function downloadApk(
  apkUrl: string,
  onProgress: (progress: number) => void,
  signal?: AbortSignal,
): Promise<File> {
  if (!isAllowedUpdateUrl(apkUrl)) throw new Error('invalid-apk-url');

  const fileName = apkFileNameFromUrl(apkUrl);
  if (fileName === null) throw new Error('invalid-apk-url');

  const directory = new Directory(Paths.cache, UPDATE_CACHE_DIR);
  if (!directory.exists) directory.create({ intermediates: true });

  const destination = new File(directory, fileName);
  deleteQuietly(destination);

  let task: DownloadTask | null = null;
  try {
    task = File.createDownloadTask(apkUrl, destination, {
      signal,
      onProgress: ({ bytesWritten, totalBytes }) => {
        if (totalBytes > 0) onProgress(Math.min(1, Math.max(0, bytesWritten / totalBytes)));
      },
    });
    const downloaded = await task.downloadAsync();
    // 没有调用 pause()，null 只可能是平台异常状态；按失败处理。
    if (downloaded === null) throw new Error('download-paused');
    return downloaded;
  } catch (error) {
    deleteQuietly(destination);
    throw error;
  } finally {
    task?.release();
  }
}

/**
 * 拉取 SHA256SUMS 并取出 apkFileName 的摘要。
 * 网络/HTTP 失败抛出供调用方归类；文件名对应的摘要不存在时返回 null。
 */
export async function fetchExpectedHash(
  sha256Url: string,
  apkFileName: string,
  signal?: AbortSignal,
): Promise<string | null> {
  if (!isAllowedUpdateUrl(sha256Url)) return null;

  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, HASH_FETCH_TIMEOUT_MS);

  try {
    throwIfAborted(signal);
    const response = await fetch(sha256Url, { method: 'GET', signal: controller.signal });
    throwIfAborted(signal);
    if (controller.signal.aborted) throw new Error('hash-fetch-timeout');
    if (!response.ok) throw new Error('hash-fetch-failed');
    const text = await response.text();
    throwIfAborted(signal);
    if (controller.signal.aborted) throw new Error('hash-fetch-timeout');
    return parseSha256Sums(text, apkFileName);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

/**
 * 用系统安装器打开已下载的 APK。
 *
 * SDK 58 没有暴露 `canRequestPackageInstalls` 的 JS API（expo-file-system /
 * expo-intent-launcher 均无），因此无法在拉起前查询「安装未知应用」授权。
 * 回退方案：ACTION_VIEW 拉起失败时，打开本应用的 MANAGE_UNKNOWN_APP_SOURCES
 * 设置页并返回 `needs-unknown-sources`；设置页也打不开才返回 `failed`。
 *
 * 设置页调用会等用户返回应用后才 resolve，期间 UI 应展示等待态。
 */
export async function installApk(file: File): Promise<InstallStatus> {
  let contentUri: string;
  try {
    contentUri = file.contentUri;
  } catch {
    // 文件被清理/缓存被系统回收时读取 contentUri 会抛错；安装入口只回状态。
    return 'failed';
  }
  if (typeof contentUri !== 'string' || contentUri.length === 0) return 'failed';

  try {
    await startActivityAsync(ACTION_VIEW, {
      data: contentUri,
      type: APK_MIME_TYPE,
      flags: FLAG_GRANT_READ_URI_PERMISSION,
    });
    return 'launched';
  } catch {
    // 授权缺失、安装器被禁用等都以 launch 失败的形式出现，统一走设置页兜底。
  }

  try {
    await startActivityAsync(
      ActivityAction.MANAGE_UNKNOWN_APP_SOURCES,
      applicationId === null ? undefined : { data: `package:${applicationId}` },
    );
    return 'needs-unknown-sources';
  } catch {
    return 'failed';
  }
}

/**
 * 下载并校验一个清单指向的 APK；不安装。
 *
 * 返回 `{ error: 'url' }` 时没有发过网络请求；`download` 表示下载/网络失败；
 * `checksum` 表示拿不到期望摘要或摘要不匹配（必要时调用方回退手动下载）。
 * 任何失败路径都会删掉缓存里的包。
 */
export async function downloadAndVerify(
  manifest: LatestManifest,
  onProgress: (progress: number) => void,
  signal?: AbortSignal,
): Promise<{ file: File } | { error: DownloadFailure }> {
  if (!isAllowedUpdateUrl(manifest.apkUrl) || !isAllowedUpdateUrl(manifest.sha256Url)) {
    return { error: 'url' };
  }

  const fileName = apkFileNameFromUrl(manifest.apkUrl);
  if (fileName === null) return { error: 'url' };

  let file: File | null = null;
  try {
    throwIfAborted(signal);
    file = await downloadApk(manifest.apkUrl, onProgress, signal);
    throwIfAborted(signal);

    const expectedHash = await fetchExpectedHash(manifest.sha256Url, fileName, signal);
    throwIfAborted(signal);
    if (expectedHash === null) {
      deleteQuietly(file);
      return { error: 'checksum' };
    }

    const matches = await verifySha256(file, expectedHash);
    if (signal?.aborted) {
      deleteQuietly(file);
      return { error: 'download' };
    }
    if (!matches) {
      deleteQuietly(file);
      return { error: 'checksum' };
    }

    return { file };
  } catch {
    if (file !== null) deleteQuietly(file);
    return { error: 'download' };
  }
}
