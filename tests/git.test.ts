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
    process.env.GITHUB_SERVER_URL = 'https://github.com'
    process.env.GITHUB_REPOSITORY = 'base/repo'
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
      1,
      'git',
      [
        'fetch',
        '--no-tags',
        'https://github.com/base/repo.git',
        '+refs/heads/release/leapfrog:refs/remotes/base/release/leapfrog',
      ],
      { cwd: '/repo', maxBuffer: 10 * 1024 * 1024 },
    )
    expect(execFileAsyncMock).toHaveBeenNthCalledWith(
      2,
      'git',
      ['merge-base', 'HEAD', 'refs/remotes/base/release/leapfrog'],
      { cwd: '/repo', maxBuffer: 10 * 1024 * 1024 },
    )
    expect(execFileAsyncMock).toHaveBeenNthCalledWith(
      3,
      'git',
      ['show', 'abc123:public/locales/translation.en.json'],
      { cwd: '/repo', maxBuffer: 10 * 1024 * 1024 },
    )
  })

  test('falls back to full translation when merge-base lookup fails', async () => {
    execFileAsyncMock
      .mockResolvedValueOnce({ stdout: '', stderr: '' }) // fetch
      .mockRejectedValueOnce(new Error('merge-base failed'))

    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { getBaseFileContent } = await import('../src/git')

    const result = await getBaseFileContent({
      workspacePath: '/repo',
      inputFileRelativePath: 'public/locales/translation.en.json',
      baseRef: 'release/leapfrog',
    })

    expect(result).toBeNull()
    expect(execFileAsyncMock).toHaveBeenCalledTimes(2)
    expect(consoleWarnSpy).toHaveBeenCalled()
    consoleWarnSpy.mockRestore()
  })

  test('falls back to origin when workflow repository metadata is unavailable', async () => {
    delete process.env.GITHUB_SERVER_URL
    delete process.env.GITHUB_REPOSITORY

    execFileAsyncMock
      .mockResolvedValueOnce({ stdout: '', stderr: '' }) // fetch
      .mockResolvedValueOnce({ stdout: 'abc123\n', stderr: '' }) // merge-base
      .mockResolvedValueOnce({ stdout: '{"warning":"Warning"}', stderr: '' }) // show

    const { getBaseFileContent } = await import('../src/git')

    await getBaseFileContent({
      workspacePath: '/repo',
      inputFileRelativePath: 'public/locales/translation.en.json',
      baseRef: 'release/leapfrog',
    })

    expect(execFileAsyncMock).toHaveBeenNthCalledWith(
      1,
      'git',
      [
        'fetch',
        '--no-tags',
        'origin',
        '+refs/heads/release/leapfrog:refs/remotes/origin/release/leapfrog',
      ],
      { cwd: '/repo', maxBuffer: 10 * 1024 * 1024 },
    )
    expect(execFileAsyncMock).toHaveBeenNthCalledWith(
      2,
      'git',
      ['merge-base', 'HEAD', 'refs/remotes/origin/release/leapfrog'],
      { cwd: '/repo', maxBuffer: 10 * 1024 * 1024 },
    )
  })

  test('normalizes Windows path separators before reading the blob', async () => {
    execFileAsyncMock
      .mockResolvedValueOnce({ stdout: '', stderr: '' }) // fetch
      .mockResolvedValueOnce({ stdout: 'abc123\n', stderr: '' }) // merge-base
      .mockResolvedValueOnce({ stdout: '{"warning":"Warning"}', stderr: '' }) // show

    const { getBaseFileContent } = await import('../src/git')

    await getBaseFileContent({
      workspacePath: '/repo',
      inputFileRelativePath: 'public\\locales\\translation.en.json',
      baseRef: 'release/leapfrog',
    })

    expect(execFileAsyncMock).toHaveBeenNthCalledWith(
      3,
      'git',
      ['show', 'abc123:public/locales/translation.en.json'],
      { cwd: '/repo', maxBuffer: 10 * 1024 * 1024 },
    )
  })
})
