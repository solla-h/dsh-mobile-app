import type { File } from 'expo-file-system';

import { apkFileNameFromUrl, parseSha256Sums, verifySha256 } from '../installer';

const HASH = 'a'.repeat(64);
const UPPER_HASH = 'A'.repeat(64);
const APK_NAME = 'dsh-mobile-v0.2.0.apk';

/** 只实现 verifySha256 用到的 digest；真实 File 的其余成员与本模块无关。 */
function fakeFile(digest: (algorithm: string) => Promise<string>): File {
  return { digest } as unknown as File;
}

describe('parseSha256Sums', () => {
  test('文本模式：两个空格分隔', () => {
    const text = `deadbeef\n${HASH}  ${APK_NAME}\n`;
    expect(parseSha256Sums(text, APK_NAME)).toBe(HASH);
  });

  test('二进制模式：星号分隔', () => {
    const text = `${HASH} *${APK_NAME}\n`;
    expect(parseSha256Sums(text, APK_NAME)).toBe(HASH);
  });

  test('返回文件里写的原始大小写', () => {
    expect(parseSha256Sums(`${UPPER_HASH}  ${APK_NAME}\n`, APK_NAME)).toBe(UPPER_HASH);
  });

  test('兼容 CRLF 行尾', () => {
    const text = `${HASH}  other.apk\r\n${HASH}  ${APK_NAME}\r\n`;
    expect(parseSha256Sums(text, APK_NAME)).toBe(HASH);
  });

  test('文件名带空格时按整行匹配', () => {
    const text = `${HASH}  dsh mobile v1.apk\n`;
    expect(parseSha256Sums(text, 'dsh mobile v1.apk')).toBe(HASH);
  });

  test('文件名缺失时返回 null', () => {
    expect(parseSha256Sums(`${HASH}  other.apk\n`, APK_NAME)).toBeNull();
  });

  test('目标行的摘要长度不对时返回 null', () => {
    const shortHash = 'a'.repeat(63);
    expect(parseSha256Sums(`${shortHash}  ${APK_NAME}\n`, APK_NAME)).toBeNull();
    expect(parseSha256Sums(`${HASH}b  ${APK_NAME}\n`, APK_NAME)).toBeNull();
  });

  test('目标行的摘要含非十六进制字符时返回 null', () => {
    const badHash = `${'g'.repeat(63)}a`;
    expect(parseSha256Sums(`${badHash}  ${APK_NAME}\n`, APK_NAME)).toBeNull();
  });

  test('缺少分隔符或只有一个空格时返回 null', () => {
    expect(parseSha256Sums(`${HASH}${APK_NAME}\n`, APK_NAME)).toBeNull();
    expect(parseSha256Sums(`${HASH} ${APK_NAME}\n`, APK_NAME)).toBeNull();
  });

  test('跳过不相关的坏行，仍能命中有效行', () => {
    const text = `not a checksum line\n${HASH}  ${APK_NAME}\n`;
    expect(parseSha256Sums(text, APK_NAME)).toBe(HASH);
  });

  test('文件名只做整段比较，不匹配前缀相同的文件', () => {
    expect(parseSha256Sums(`${HASH}  other-${APK_NAME}\n`, APK_NAME)).toBeNull();
  });

  test('空内容或空文件名返回 null', () => {
    expect(parseSha256Sums('', APK_NAME)).toBeNull();
    expect(parseSha256Sums(`${HASH}  ${APK_NAME}\n`, '')).toBeNull();
  });
});

describe('apkFileNameFromUrl', () => {
  test('取 https URL 的最后一段路径', () => {
    expect(
      apkFileNameFromUrl(`https://github.com/owner/repo/releases/download/v0.2.0/${APK_NAME}`),
    ).toBe(APK_NAME);
  });

  test('忽略查询串与片段', () => {
    expect(apkFileNameFromUrl(`https://github.com/owner/repo/${APK_NAME}?download=1#sha`)).toBe(
      APK_NAME,
    );
  });

  test('结尾斜杠、根路径与空路径返回 null', () => {
    expect(apkFileNameFromUrl('https://github.com/owner/repo/')).toBeNull();
    expect(apkFileNameFromUrl('https://github.com')).toBeNull();
    expect(apkFileNameFromUrl('https://github.com/')).toBeNull();
  });

  test('非 https 或非法 URL 返回 null', () => {
    expect(apkFileNameFromUrl('http://github.com/owner/repo/app.apk')).toBeNull();
    expect(apkFileNameFromUrl('ftp://github.com/owner/repo/app.apk')).toBeNull();
    expect(apkFileNameFromUrl('file:///tmp/app.apk')).toBeNull();
    expect(apkFileNameFromUrl('not a url')).toBeNull();
    expect(apkFileNameFromUrl('')).toBeNull();
  });
});

describe('verifySha256', () => {
  test('摘要一致（大小写不敏感）', async () => {
    const digest = jest.fn(async () => HASH);
    await expect(verifySha256(fakeFile(digest), HASH)).resolves.toBe(true);
    await expect(verifySha256(fakeFile(digest), UPPER_HASH)).resolves.toBe(true);
    expect(digest).toHaveBeenCalledWith('SHA-256');
  });

  test('摘要不一致返回 false', async () => {
    const file = fakeFile(async () => 'b'.repeat(64));
    await expect(verifySha256(file, HASH)).resolves.toBe(false);
  });

  test('期望值不是 64 位十六进制时不读文件', async () => {
    const digest = jest.fn(async () => HASH);
    await expect(verifySha256(fakeFile(digest), 'a'.repeat(63))).resolves.toBe(false);
    await expect(verifySha256(fakeFile(digest), '')).resolves.toBe(false);
    expect(digest).not.toHaveBeenCalled();
  });

  test('读取摘要失败时返回 false，不抛异常', async () => {
    const file = fakeFile(async () => {
      throw new Error('missing file');
    });
    await expect(verifySha256(file, HASH)).resolves.toBe(false);
  });
});
