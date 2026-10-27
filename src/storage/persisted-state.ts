import { Directory, File, Paths } from 'expo-file-system';

/**
 * 小份应用状态（草稿、发件箱）落盘。
 * 用文件而不是 SecureStore：这些不是机密，而且 SecureStore 单值有大小上限。
 */
const STATE_DIR = 'dsh-state';

function fileFor(name: string): File {
  const directory = new Directory(Paths.document, STATE_DIR);
  if (!directory.exists) directory.create({ intermediates: true });
  return new File(directory, name + '.json');
}

export async function readJson<T>(name: string): Promise<T | null> {
  try {
    const file = fileFor(name);
    if (!file.exists) return null;
    const raw = await file.text();
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function writeJson(name: string, value: unknown): Promise<void> {
  try {
    const file = fileFor(name);
    if (file.exists) file.delete();
    await file.write(JSON.stringify(value));
  } catch {
    // 落盘失败不该影响交互，下次改动会再试一次
  }
}

export async function removeJson(name: string): Promise<void> {
  try {
    const file = fileFor(name);
    if (file.exists) file.delete();
  } catch {
    // 同上
  }
}
