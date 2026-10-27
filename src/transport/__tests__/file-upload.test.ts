import { bytesOfChars, chunkChars, decodedBytesOf } from '../file-upload';

const base64Of = (length: number, fill: number): string =>
  btoa(Array.from({ length }, () => String.fromCharCode(fill)).join(''));

/**
 * 分片切分的核心不变量：
 * - 每块长度是 4 的倍数（规范 base64）
 * - offset 用「已经发出去的字节数」累加，末片要扣掉 '=' 填充
 * 这两个错了网关会直接 file-upload-offset / file-upload-invalid-data。
 */
describe('chunkChars', () => {
  it('默认 256 KiB 分片按 4 字符对齐', () => {
    expect(chunkChars(256 * 1024)).toBe(349524);
    expect(chunkChars(256 * 1024) % 4).toBe(0);
  });

  it('小分片至少给 4 个字符', () => {
    expect(chunkChars(1)).toBe(4);
    expect(chunkChars(0)).toBe(4);
  });
});

describe('decodedBytesOf', () => {
  it('按填充算出真实字节数', () => {
    expect(decodedBytesOf('YWJj')).toBe(3);
    expect(decodedBytesOf('YWI=')).toBe(2);
    expect(decodedBytesOf('YQ==')).toBe(1);
    expect(bytesOfChars(4)).toBe(3);
  });
});

describe('切片本身', () => {
  it('每片都能原样 base64 解码再编码回来', () => {
    const payload = base64Of(1024, 7);
    const chars = chunkChars(300);
    let offset = 0;
    let chunks = 0;
    while (offset < payload.length) {
      const slice = payload.slice(offset, offset + chars);
      expect(slice.length % 4).toBe(0);
      expect(btoa(atob(slice))).toBe(slice);
      offset += slice.length;
      chunks += 1;
    }
    expect(chunks).toBeGreaterThan(1);
    expect(offset).toBe(payload.length);
  });

  it('累计字节数和服务端 nextOffset 一致（含末片填充）', () => {
    const payload = base64Of(1000, 1);
    const chars = chunkChars(300);
    let charsOffset = 0;
    let sentBytes = 0;
    while (charsOffset < payload.length) {
      const slice = payload.slice(charsOffset, charsOffset + chars);
      charsOffset += slice.length;
      sentBytes += decodedBytesOf(slice);
      // 服务端返回的 nextOffset 就是这个累计值
      expect(sentBytes).toBe(atob(payload.slice(0, charsOffset)).length);
    }
    expect(sentBytes).toBe(1000);
  });
});
