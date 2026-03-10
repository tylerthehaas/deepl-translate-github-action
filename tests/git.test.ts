import { beforeEach, describe, expect, test, vi } from 'vitest'

const execFileAsyncMock = vi.fn()

vi.mock('child_process', () => ({
  execFile: vi.fn(),
}))

vi.mock('util', () => ({
  promisify: vi.fn(() => execFileAsyncMock),
}))

describe('getBaseFileContent', () => {
  beforeEach(() => {
    execFileAsyncMock.mockReset()
  })

  test('uses the merge-base commit when diffing against a configured branch', async () => {
    execFileAsyncMock
      .mockResolvedValueOnce({ stdout: '', stderr: '' }) // fetch
      .mockResolvedValueOnce({ stdout: 'abc123\n', stderr: '' }) // merge-base
      .mockResolvedValueOnce({ stdout: '{"warning":"Warning"}', stderr: '' }) // show

    const { getBaseFileContent } = await import('../src/git')

    const result = await getBaseFileContent({
      workspacePath: '/repo',
      inputFileRelativePath: 'public/locales/translation.en.json',
      baseRef: 'release/leapfrog',
    })

    expect(result).toBe('{"warning":"Warning"}')
    expect(execFileAsyncMock).toHaveBeenNthCalledWith(
      2,
      'git',
      ['merge-base', 'HEAD', 'origin/release/leapfrog'],
      { cwd: '/repo', maxBuffer: 10 * 1024 * 1024 },
    )
    expect(execFileAsyncMock).toHaveBeenNthCalledWith(
      3,
      'git',
      ['show', 'abc123:public/locales/translation.en.json'],
      { cwd: '/repo', maxBuffer: 10 * 1024 * 1024 },
    )
  })

  test('falls back to the branch tip when merge-base lookup fails', async () => {
    execFileAsyncMock
      .mockResolvedValueOnce({ stdout: '', stderr: '' }) // fetch
      .mockRejectedValueOnce(new Error('merge-base failed'))
      .mockResolvedValueOnce({ stdout: '{"warning":"Warning"}', stderr: '' }) // show

    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { getBaseFileContent } = await import('../src/git')

    const result = await getBaseFileContent({
      workspacePath: '/repo',
      inputFileRelativePath: 'public/locales/translation.en.json',
      baseRef: 'release/leapfrog',
    })

    expect(result).toBe('{"warning":"Warning"}')
    expect(execFileAsyncMock).toHaveBeenNthCalledWith(
      3,
      'git',
      ['show', 'origin/release/leapfrog:public/locales/translation.en.json'],
      { cwd: '/repo', maxBuffer: 10 * 1024 * 1024 },
    )
    expect(consoleWarnSpy).toHaveBeenCalled()
    consoleWarnSpy.mockRestore()
  })
})
