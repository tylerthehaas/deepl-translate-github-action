import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

interface BaseFileContentParams {
  workspacePath: string
  inputFileRelativePath: string
  baseRef?: string
}

function isMissingPathError(stderr: string) {
  return (
    stderr.includes('exists on disk, but not in') ||
    stderr.includes('pathspec') ||
    stderr.includes('fatal: path') ||
    stderr.includes('does not exist')
  )
}

export async function getBaseFileContent({
  workspacePath,
  inputFileRelativePath,
  baseRef,
}: BaseFileContentParams): Promise<string | null> {
  if (!baseRef) {
    return null
  }

  try {
    await execFileAsync(
      'git',
      [
        'fetch',
        '--no-tags',
        '--depth=1',
        'origin',
        `+refs/heads/${baseRef}:refs/remotes/origin/${baseRef}`,
      ],
      { cwd: workspacePath, maxBuffer: 10 * 1024 * 1024 },
    )
  } catch (error) {
    console.warn(`Failed to fetch base branch origin/${baseRef}, falling back to local refs if available.`, error)
  }

  try {
    const { stdout } = await execFileAsync(
      'git',
      ['show', `origin/${baseRef}:${inputFileRelativePath}`],
      { cwd: workspacePath, maxBuffer: 10 * 1024 * 1024 },
    )

    return stdout
  } catch (error) {
    const stderr = error instanceof Error && 'stderr' in error ? String(error.stderr) : ''

    if (isMissingPathError(stderr)) {
      return null
    }

    console.warn(
      `Failed to read ${inputFileRelativePath} from origin/${baseRef}, falling back to full translation.`,
      error,
    )
    return null
  }
}
