/**
 * 应用内更新清单（manifest）相关的纯函数实现。
 *
 * 设计约定：
 * - 本文件不引入 react-native / 网络 / 存储 API，可在 Node 环境中直接单测。
 * - 版本号格式校验复用 scripts/check-compat.mjs 的正则，保证与兼容性检查一致。
 * - 运行时只能可靠获知 hello.protocol；gateway / dsh / voice 无法可靠获取，
 *  因此它们只能产生弱警告，唯一的硬阻止条件是协议版本落后。
 */

/** 版本号字符串格式，与 scripts/check-compat.mjs 保持一致。 */
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** 版本号分段解析正则（核心版本 + 可选预发布标识）。 */
const VERSION_PARTS_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

/** Android versionCode 的安全整数上限（Google Play 限制）。 */
const MAX_VERSION_CODE = 2100000000;

/** 允许作为更新资源来源的官方主机名。 */
const ALLOWED_UPDATE_HOSTS: ReadonlySet<string> = new Set([
 'github.com',
 'raw.githubusercontent.com',
 'objects.githubusercontent.com',
]);

/** 清单中声明的最低要求版本。 */
export interface UpdateRequired {
 /** 最低要求的网关版本。 */
 gateway?: string;
 /** 最低要求的 DSH 版本。 */
 dsh?: string;
 /** 最低要求的语音模块版本。 */
 voice?: string;
 /** 最低要求的协议版本。 */
 protocol?: number;
}

/** 远端最新版本清单。 */
export interface LatestManifest {
 /** 语义化版本号。 */
 version: string;
 /** Android versionCode。 */
 versionCode: number;
 /** 发布标签，例如 v0.12.0-rdv.3。 */
 tag: string;
 /** APK 下载地址（必须来自官方主机）。 */
 apkUrl: string;
 /** APK 校验和文件地址（必须来自官方主机）。 */
 sha256Url: string;
 /** 多语言发布说明。 */
 releaseNotes?: { 'zh-CN'?: string; en?: string };
 /** 最低要求版本（弱约束）。 */
 required?: UpdateRequired;
}

/** 本机已安装信息。 */
export interface InstalledInfo {
 /** 本机 versionCode。 */
 versionCode: number;
 /** 运行时 hello.protocol；未知时为 undefined。 */
 protocol?: number;
 /** 本机网关版本；运行时通常无法获取。 */
 gateway?: string;
 /** 本机 DSH 版本；运行时通常无法获取。 */
 dsh?: string;
 /** 本机语音模块版本；运行时通常无法获取。 */
 voice?: string;
}

/** 更新评估结果。 */
export type UpdateEvaluation =
 | { kind: 'up-to-date' }
 | {
   kind: 'update-available';
   manifest: LatestManifest;
   /** true only when required.protocol > installed.protocol (both known). */
   hostBlocked: boolean;
   /** Machine-readable codes, e.g. 'protocol'. Empty when not blocked. */
   blockedReasons: string[];
   /** Machine-readable codes, e.g. 'gateway-outdated', 'gateway-unknown', 'protocol-unknown'. */
   weakWarnings: string[];
  }
 | { kind: 'invalid'; reason: string };

/** 版本号的解析结果。 */
interface ParsedVersion {
 major: number;
 minor: number;
 patch: number;
 /** 预发布标识列表；无预发布时为 null。 */
 prerelease: string[] | null;
}

/**
 * 判断值是否为普通对象（排除 null、数组与类实例）。
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
 if (typeof value !== 'object' || value === null) return false;
 const prototype: unknown = Object.getPrototypeOf(value);
 return prototype === Object.prototype || prototype === null;
}

/**
 * 判断值是否为符合约定格式的版本号字符串。
 */
function isVersionString(value: unknown): value is string {
 return typeof value === 'string' && VERSION_PATTERN.test(value);
}

/**
 * 判断 versionCode 是否为 1..2100000000 之间的安全整数。
 */
function isVersionCode(value: unknown): value is number {
 return (
  typeof value === 'number' &&
  Number.isSafeInteger(value) &&
  value >= 1 &&
  value <= MAX_VERSION_CODE
 );
}

/**
 * 校验并归一化 releaseNotes；输入非法时返回 null。
 */
function parseReleaseNotes(raw: unknown): { 'zh-CN'?: string; en?: string } | null {
 if (!isPlainObject(raw)) return null;
 for (const value of Object.values(raw)) {
  if (typeof value !== 'string') return null;
 }
 const notes: { 'zh-CN'?: string; en?: string } = {};
 const zh = raw['zh-CN'];
 if (typeof zh === 'string') notes['zh-CN'] = zh;
 const en = raw.en;
 if (typeof en === 'string') notes.en = en;
 return notes;
}

/**
 * 校验并归一化 required 字段；输入非法时返回 null。
 */
function parseRequired(raw: unknown): UpdateRequired | null {
 if (!isPlainObject(raw)) return null;

 const required: UpdateRequired = {};
 const versionKeys = ['gateway', 'dsh', 'voice'] as const;
 for (const key of versionKeys) {
  const value = raw[key];
  if (value === undefined) continue;
  if (!isVersionString(value)) return null;
  required[key] = value;
 }

 const protocol = raw.protocol;
 if (protocol !== undefined) {
  if (
   typeof protocol !== 'number' ||
   !Number.isSafeInteger(protocol) ||
   protocol < 1
  ) {
   return null;
  }
  required.protocol = protocol;
 }

 return required;
}

/**
 * 严格解析远端最新版本清单；任何不合法都返回 null。
 * 未知的额外字段会被忽略，输入对象不会被修改。
 */
export function parseLatestManifest(raw: unknown): LatestManifest | null {
 if (!isPlainObject(raw)) return null;

 const version = raw.version;
 if (!isVersionString(version)) return null;

 const versionCode = raw.versionCode;
 if (!isVersionCode(versionCode)) return null;

 const tag = raw.tag;
 if (typeof tag !== 'string' || tag.length === 0 || /\s/.test(tag)) return null;

 const apkUrl = raw.apkUrl;
 if (typeof apkUrl !== 'string' || !isAllowedUpdateUrl(apkUrl)) return null;

 const sha256Url = raw.sha256Url;
 if (typeof sha256Url !== 'string' || !isAllowedUpdateUrl(sha256Url)) return null;

 const manifest: LatestManifest = {
  version,
  versionCode,
  tag,
  apkUrl,
  sha256Url,
 };

 if (raw.releaseNotes !== undefined) {
  const releaseNotes = parseReleaseNotes(raw.releaseNotes);
  if (releaseNotes === null) return null;
  manifest.releaseNotes = releaseNotes;
 }

 if (raw.required !== undefined) {
  const required = parseRequired(raw.required);
  if (required === null) return null;
  manifest.required = required;
 }

 return manifest;
}

/**
 * 比较两个 versionCode：a 小于 b 返回 -1，相等返回 0，a 大于 b 返回 1。
 */
export function compareVersionCode(a: number, b: number): number {
 if (a < b) return -1;
 if (a > b) return 1;
 return 0;
}

/**
 * 解析版本号字符串；格式不合法时返回 null。
 */
function parseVersionParts(version: string): ParsedVersion | null {
 const match = VERSION_PARTS_PATTERN.exec(version);
 if (match === null) return null;

 const majorGroup = match[1];
 const minorGroup = match[2];
 const patchGroup = match[3];
 if (majorGroup === undefined || minorGroup === undefined || patchGroup === undefined) {
  return null;
 }

 const prereleaseGroup: string | undefined = match[4];
 return {
  major: Number(majorGroup),
  minor: Number(minorGroup),
  patch: Number(patchGroup),
  prerelease: prereleaseGroup === undefined ? null : prereleaseGroup.split('.'),
 };
}

/**
 * 比较两个预发布标识符（semver 规则）：数字标识小于字母数字标识。
 */
function comparePrereleaseIdentifier(a: string, b: string): number {
 const aIsNumeric = /^\d+$/.test(a);
 const bIsNumeric = /^\d+$/.test(b);

 if (aIsNumeric && bIsNumeric) {
  const aDigits = a.replace(/^0+(?=\d)/, '');
  const bDigits = b.replace(/^0+(?=\d)/, '');
  if (aDigits.length !== bDigits.length) {
   return aDigits.length < bDigits.length ? -1 : 1;
  }
  if (aDigits === bDigits) return 0;
  return aDigits < bDigits ? -1 : 1;
 }
 if (aIsNumeric) return -1;
 if (bIsNumeric) return 1;
 if (a === b) return 0;
 return a < b ? -1 : 1;
}

/**
 * 按 semver 优先级比较两个版本号：
 * 核心数字按数值比较；无预发布版本大于同核心的预发布版本；
 * 预发布标识逐个比较，数字标识按数值且小于字母数字标识，较短的前缀更小。
 * 任一侧格式非法时返回 null。
 */
export function compareVersions(a: string, b: string): number | null {
 if (!VERSION_PATTERN.test(a) || !VERSION_PATTERN.test(b)) return null;

 const left = parseVersionParts(a);
 const right = parseVersionParts(b);
 if (left === null || right === null) return null;

 if (left.major !== right.major) return left.major < right.major ? -1 : 1;
 if (left.minor !== right.minor) return left.minor < right.minor ? -1 : 1;
 if (left.patch !== right.patch) return left.patch < right.patch ? -1 : 1;

 if (left.prerelease === null && right.prerelease === null) return 0;
 if (left.prerelease === null) return 1;
 if (right.prerelease === null) return -1;

 const leftIds = left.prerelease;
 const rightIds = right.prerelease;
 const maxLength = Math.max(leftIds.length, rightIds.length);
 for (let index = 0; index < maxLength; index += 1) {
  const leftId = leftIds[index];
  const rightId = rightIds[index];
  if (leftId === undefined) return -1;
  if (rightId === undefined) return 1;
  const comparison = comparePrereleaseIdentifier(leftId, rightId);
  if (comparison !== 0) return comparison;
 }

 return 0;
}

/**
 * 判断 URL 是否来自允许的官方更新主机（https、无凭证、无空白字符）。
 */
export function isAllowedUpdateUrl(url: string): boolean {
 if (typeof url !== 'string' || url.length === 0) return false;
 if (/\s/.test(url)) return false;

 let parsed: URL;
 try {
  parsed = new URL(url);
 } catch {
  return false;
 }

 if (parsed.protocol !== 'https:') return false;
 if (parsed.username !== '' || parsed.password !== '') return false;

 return ALLOWED_UPDATE_HOSTS.has(parsed.hostname.toLowerCase());
}

/**
 * 评估是否需要更新，并给出硬阻止原因与弱警告码。
 * 只输出机器可读的 code，用户可见文案由 UI 层通过 tr() 组装。
 */
export function evaluateUpdate(
 installed: InstalledInfo,
 latest: LatestManifest | null,
): UpdateEvaluation {
 if (latest === null) {
  return { kind: 'invalid', reason: 'invalid-manifest' };
 }

 // 远端 versionCode 不大于本机时视为已是最新，绝不提示降级。
 if (latest.versionCode <= installed.versionCode) {
  return { kind: 'up-to-date' };
 }

 const required = latest.required;
 const requiredProtocol = required?.protocol;
 const installedProtocol = installed.protocol;

 const hostBlocked =
  typeof requiredProtocol === 'number' &&
  typeof installedProtocol === 'number' &&
  requiredProtocol > installedProtocol;

 const blockedReasons: string[] = hostBlocked ? ['protocol'] : [];
 const weakWarnings: string[] = [];

 const componentKeys = ['gateway', 'dsh', 'voice'] as const;
 for (const key of componentKeys) {
  const requiredVersion = required?.[key];
  if (requiredVersion === undefined) continue;

  const installedVersion = installed[key];
  if (installedVersion === undefined) {
   weakWarnings.push(`${key}-unknown`);
   continue;
  }

  const comparison = compareVersions(installedVersion, requiredVersion);
  if (comparison === null) {
   weakWarnings.push(`${key}-unknown`);
  } else if (comparison < 0) {
   weakWarnings.push(`${key}-outdated`);
  }
 }

 if (typeof requiredProtocol === 'number' && typeof installedProtocol !== 'number') {
  weakWarnings.push('protocol-unknown');
 }

 return {
  kind: 'update-available',
  manifest: latest,
  hostBlocked,
  blockedReasons,
  weakWarnings,
 };
}
