/**
 * 图片 MIME 以字节为准。
 *
 * expo-image-picker 在 quality < 1 时会重新压缩（Android 上基本统一压成 JPEG），
 * 但 asset.mimeType 仍然是原文件的类型。服务端按字节嗅探，声明和内容对不上就回
 * session/attachment-invalid。所以这里解出开头几个字节，用魔数覆盖声明的类型。
 */
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** 解出 base64 开头最多 count 个字节；遇到填充或非法字符就停。 */
export function headBytes(base64: string, count = 12): number[] {
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of base64) {
    const value = B64.indexOf(ch);
    if (value < 0) break;
    buffer = ((buffer << 6) | value) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
      if (out.length >= count) break;
    }
  }
  return out;
}

/** 认不出来返回 null，交给调用方决定。 */
export function sniffImageType(base64: string): string | null {
  const b = headBytes(base64, 12);
  if (b.length < 4) return null;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif';
  if (
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    return 'image/webp';
  }
  if (b[0] === 0x42 && b[1] === 0x4d) return 'image/bmp';
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
    const brand = String.fromCharCode(b[8], b[9], b[10], b[11]);
    if (['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(brand)) return 'image/heic';
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
  }
  return null;
}

/** 字节认不出来就退回调用方声明的类型，再不行按 jpeg。 */
export function imageMediaType(base64: string, declared?: string): string {
  return sniffImageType(base64) ?? declared ?? 'image/jpeg';
}
