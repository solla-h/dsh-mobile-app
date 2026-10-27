/**
 * 交付文件（deliverables/presented）与工作区文件下载。
 * 事件形状见 PROTOCOL.md「文件卡片与正文文件引用」。
 */

export interface PresentedFile {
  path: string;
  description?: string;
}

/** 历史里是 data.files，实时帧里是 event.files，两处都要认。 */
export function presentedFilesOf(value: unknown): PresentedFile[] {
  if (!Array.isArray(value)) return [];
  const files: PresentedFile[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const raw = entry as Record<string, unknown>;
    const path = typeof raw.path === 'string' ? raw.path.trim() : '';
    if (!path) continue;
    files.push({
      path,
      description: typeof raw.description === 'string' ? raw.description : undefined,
    });
  }
  return files;
}

/** 只认文件名，路径部分丢掉，避免长路径把卡片撑爆。 */
export function baseName(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const index = normalized.lastIndexOf('/');
  return index >= 0 ? normalized.slice(index + 1) : normalized;
}

/** 正文链接里可能带源码行号片段，它不是文件名的一部分。 */
export function stripLineFragment(path: string): string {
  return path.replace(/#L\d+(?:-L?\d+)?$/, '');
}

/**
 * Markdown 链接目标是本地文件还是网页。
 * 只把相对路径、file:// 和 Windows 盘符当作文件，其余 scheme 一律交给系统。
 */
export function isLocalFileHref(href: string): boolean {
  if (!href) return false;
  const value = href.trim();
  if (!value || value.startsWith('#')) return false;
  if (/^(https?|mailto|tel|sms|dsh-resource):/i.test(value)) return false;
  if (/^file:\/\//i.test(value)) return true;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return false;
  if (/^[a-z]:[\\/]/i.test(value)) return true;
  return true;
}

/** file:// 只取路径部分；Windows 的盘符和 UNC 不能被当成普通 URI。 */
export function hrefToPath(href: string): string {
  const value = stripLineFragment(href.trim());
  let rest = /^file:\/\//i.test(value) ? value.replace(/^file:\/\//i, '') : value;
  if (/^\/[a-z]:[\\/]/i.test(rest)) rest = rest.slice(1);
  // markdown-it 会把中文路径编码成 %E4%B8%89...，必须解一次码再交给网关。
  try {
    return decodeURIComponent(rest);
  } catch {
    return rest;
  }
}

/** 按扩展名给个粗粒度图标文字，纯展示用。 */
export function fileKindLabel(name: string): string {
  const dot = name.lastIndexOf('.');
  const extension = dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
  switch (extension) {
    case 'pdf':
      return 'PDF';
    case 'md':
    case 'txt':
      return 'TXT';
    case 'csv':
      return 'CSV';
    case 'xlsx':
    case 'xls':
      return 'XLS';
    case 'doc':
    case 'docx':
      return 'DOC';
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
      return 'IMG';
    case 'zip':
    case 'gz':
    case 'tar':
      return 'ZIP';
    case 'apk':
      return 'APK';
    case 'ipa':
      return 'IPA';
    case 'json':
      return 'JSON';
    case 'ts':
    case 'tsx':
    case 'js':
    case 'py':
    case 'go':
    case 'rs':
    case 'java':
      return 'CODE';
    default:
      return 'FILE';
  }
}

/** Base64 解码后的字节数，用来推进下载 offset。 */
export function base64DecodedBytes(data: string): number {
  if (!data) return 0;
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  return Math.floor((data.length * 3) / 4) - padding;
}

export function formatFileSize(bytes?: number): string {
  if (typeof bytes !== 'number' || bytes < 0) return '';
  if (bytes >= 1024 * 1024 * 1024) return (bytes / 1024 / 1024 / 1024).toFixed(1) + ' GB';
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  if (bytes >= 1024) return Math.round(bytes / 1024) + ' KB';
  return bytes + ' B';
}
