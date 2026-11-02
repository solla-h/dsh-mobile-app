import { describeTool, dirOf, isShellTool, toolCommand } from '../tool-format';

describe('shell tool detection', () => {
  it('recognizes unix and windows shell tools', () => {
    expect(isShellTool('bash')).toBe(true);
    expect(isShellTool('pwsh')).toBe(true);
    expect(isShellTool('PowerShell')).toBe(true);
    expect(isShellTool('edit')).toBe(false);
    expect(isShellTool(undefined)).toBe(false);
  });

  it('reads the command from bash and pwsh args', () => {
    expect(toolCommand('bash', JSON.stringify({ command: 'npm test' }))).toBe('npm test');
    expect(toolCommand('pwsh', JSON.stringify({ command: 'Remove-Item -Recurse -Force .' }))).toBe(
      'Remove-Item -Recurse -Force .',
    );
    expect(toolCommand('edit', JSON.stringify({ file_path: 'a.ts' }))).toBeUndefined();
  });

  it('shows the pwsh command in the collapsed summary', () => {
    expect(describeTool('pwsh', JSON.stringify({ command: 'Get-ChildItem' }))).toBe(
      'Get-ChildItem',
    );
  });

  it('derives the trusted directory for POSIX and Windows paths', () => {
    expect(dirOf('/repo/src/a.ts')).toBe('/repo/src');
    expect(dirOf('D:\\repo\\src\\a.ts')).toBe('D:/repo/src');
    expect(dirOf('a.ts')).toBeUndefined();
    expect(dirOf(undefined)).toBeUndefined();
  });
});
