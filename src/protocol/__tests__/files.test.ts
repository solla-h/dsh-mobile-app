import {
  base64DecodedBytes,
  baseName,
  formatFileSize,
  hrefToPath,
  isLocalFileHref,
  presentedFilesOf,
  stripLineFragment,
} from '../files';

describe('hrefToPath', () => {
  it('解开 markdown-it 对中文路径的百分号编码', () => {
    // 这条曾经让所有中文文件名都报 file-not-found。
    expect(hrefToPath('./%E4%B8%89%E4%B8%AA%E6%96%87%E4%BB%B6.md')).toBe('./三个文件.md');
  });

  it('去掉 file:// 前缀和行号片段', () => {
    expect(hrefToPath('file:///home/dsh/a.md#L12')).toBe('/home/dsh/a.md');
    expect(hrefToPath('/home/dsh/a.md#L12-L20')).toBe('/home/dsh/a.md');
  });

  it('Windows 盘符不要被当成 URI 的 host', () => {
    expect(hrefToPath('file:///D:/work/a.md')).toBe('D:/work/a.md');
    expect(hrefToPath('D:/work/a.md')).toBe('D:/work/a.md');
  });

  it('解不开的编码原样返回，不要抛异常', () => {
    expect(hrefToPath('%E4%B8')).toBe('%E4%B8');
  });
});

describe('isLocalFileHref', () => {
  it('网页和锚点不算文件', () => {
    expect(isLocalFileHref('https://example.com/a.md')).toBe(false);
    expect(isLocalFileHref('#section')).toBe(false);
    expect(isLocalFileHref('mailto:a@b.c')).toBe(false);
  });

  it('相对路径和 file:// 算文件', () => {
    expect(isLocalFileHref('./docs/a.md')).toBe(true);
    expect(isLocalFileHref('file:///tmp/a.txt')).toBe(true);
  });
});

describe('路径小工具', () => {
  it('baseName 同时认两种分隔符', () => {
    expect(baseName('/home/dsh/a.md')).toBe('a.md');
    expect(baseName('C:\\work\\b.txt')).toBe('b.txt');
  });

  it('stripLineFragment 只切尾部行号', () => {
    expect(stripLineFragment('a.md#L3')).toBe('a.md');
    expect(stripLineFragment('a.md#L3-L9')).toBe('a.md');
    expect(stripLineFragment('a#L3.md')).toBe('a#L3.md');
  });
});

describe('presentedFilesOf', () => {
  it('丢掉没有 path 的条目', () => {
    expect(
      presentedFilesOf([
        { path: ' /tmp/a.md ', description: '说明' },
        { path: '' },
        null,
        'x',
      ]),
    ).toEqual([{ path: '/tmp/a.md', description: '说明' }]);
  });

  it('不是数组就返回空', () => {
    expect(presentedFilesOf(undefined)).toEqual([]);
    expect(presentedFilesOf({ path: 'a' })).toEqual([]);
  });
});

describe('base64DecodedBytes', () => {
  it('按填充计算真实字节数', () => {
    expect(base64DecodedBytes('')).toBe(0);
    expect(base64DecodedBytes('YQ==')).toBe(1);
    expect(base64DecodedBytes('YWI=')).toBe(2);
    expect(base64DecodedBytes('YWJj')).toBe(3);
  });
});

describe('formatFileSize', () => {
  it('按量级选单位', () => {
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(2048)).toBe('2 KB');
    expect(formatFileSize(3 * 1024 * 1024)).toBe('3.0 MB');
  });
});
