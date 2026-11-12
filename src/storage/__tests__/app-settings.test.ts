/**
 * app-settings 是字号与界面语言共用的同一个对象。
 * 整对象覆盖曾会让两个设置互相清掉（issue #10 要求先修的前置 bug）。
 */
import { writeAppSettings } from '../app-settings';
import { readJson, writeJson } from '../persisted-state';

jest.mock('../persisted-state', () => ({
  readJson: jest.fn(),
  writeJson: jest.fn(async () => undefined),
}));

const readMock = readJson as jest.Mock;
const writeMock = writeJson as jest.Mock;

describe('writeAppSettings 读-合并-写', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('写语言时保留已有字号', async () => {
    readMock.mockResolvedValue({ fontScale: 'large' });
    await writeAppSettings({ language: 'en' });
    expect(writeMock).toHaveBeenCalledWith('app-settings', {
      fontScale: 'large',
      language: 'en',
    });
  });

  it('写字号时保留已有语言', async () => {
    readMock.mockResolvedValue({ language: 'en' });
    await writeAppSettings({ fontScale: 'xlarge' });
    expect(writeMock).toHaveBeenCalledWith('app-settings', {
      language: 'en',
      fontScale: 'xlarge',
    });
  });

  it('没有旧设置时只写新字段', async () => {
    readMock.mockResolvedValue(null);
    await writeAppSettings({ language: 'zh' });
    expect(writeMock).toHaveBeenCalledWith('app-settings', { language: 'zh' });
  });

  it('旧文件损坏时也不丢新设置', async () => {
    readMock.mockResolvedValue(undefined);
    await writeAppSettings({ language: 'en' });
    expect(writeMock).toHaveBeenCalledWith('app-settings', { language: 'en' });
  });
});
