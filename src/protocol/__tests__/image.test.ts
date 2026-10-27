import { headBytes, imageMediaType, sniffImageType } from '../image';

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** 不依赖 Buffer 的最小 base64 编码，够测试用。 */
function encode(bytes: number[]): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1] ?? 0;
    const b2 = bytes[i + 2] ?? 0;
    out += B64[b0 >> 2];
    out += B64[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? B64[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < bytes.length ? B64[b2 & 63] : '=';
  }
  return out;
}

/** 造一段以给定字节开头的 base64（后面补零，够嗅探用）。 */
function b64Of(bytes: number[], pad = 8): string {
  return encode([...bytes, ...Array.from({ length: pad }, () => 0)]);
}

describe('headBytes', () => {
  it('解出开头字节', () => {
    expect(headBytes(b64Of([0x89, 0x50, 0x4e, 0x47]))).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
  });

  it('遇到填充就停', () => {
    expect(headBytes('QQ==', 4)).toEqual([0x41]);
  });
});

describe('sniffImageType', () => {
  it('识别 png / jpeg / gif', () => {
    expect(sniffImageType(b64Of([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
    expect(sniffImageType(b64Of([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffImageType(b64Of([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBe('image/gif');
  });

  it('识别 webp（RIFF....WEBP）', () => {
    const bytes = [0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50];
    expect(sniffImageType(b64Of(bytes))).toBe('image/webp');
  });

  it('识别 heic', () => {
    const bytes = [0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63];
    expect(sniffImageType(b64Of(bytes))).toBe('image/heic');
  });

  it('认不出来返回 null', () => {
    expect(sniffImageType(b64Of([0x00, 0x01, 0x02, 0x03]))).toBeNull();
  });
});

describe('imageMediaType', () => {
  it('字节优先于声明的类型', () => {
    // 选择器说是 png，实际压成了 jpeg
    expect(imageMediaType(b64Of([0xff, 0xd8, 0xff, 0xe0]), 'image/png')).toBe('image/jpeg');
  });

  it('认不出来时退回声明值，再不行按 jpeg', () => {
    expect(imageMediaType(b64Of([0x00, 0x01, 0x02, 0x03]), 'image/heic')).toBe('image/heic');
    expect(imageMediaType(b64Of([0x00, 0x01, 0x02, 0x03]))).toBe('image/jpeg');
  });
});
