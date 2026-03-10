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

function getWorkflowRepositoryUrl(): string | null {
  const serverUrl = process.env.GITHUB_SERVER_URL?.replace(/\/$/, '')
  const repository = process.env.GITHUB_REPOSITORY

  if (!serverUrl || !repository) {
    return null
  }

  return `${serverUrl}/${repository}.git`
}

export async function getBaseFileContent({
  workspacePath,
  inputFileRelativePath,
  baseRef,
}: BaseFileContentParams): Promise<string | null> {
  if (!baseRef) {
    return null
  }

  const baseRepoUrl = getWorkflowRepositoryUrl()
  const baseBranchRef = baseRepoUrl
    ? `refs/remotes/base/${baseRef}`
    : `refs/remotes/origin/${baseRef}`
  const fetchSource = baseRepoUrl ?? 'origin'

  try {
    await execFileAsync(
      'git',
      [
        'fetch',
        '--no-tags',
        fetchSource,
        `+refs/heads/${baseRef}:${baseBranchRef}`,
      ],
      { cwd: workspacePath, maxBuffer: 10 * 1024 * 1024 },
    )
  } catch (error) {
    console.warn(`Failed to fetch base branch ${baseBranchRef}, falling back to local refs if available.`, error)
  }

  let baseCommitRef = baseBranchRef

  try {
    const { stdout } = await execFileAsync(
      'git',
      ['merge-base', 'HEAD', baseBranchRef],
      { cwd: workspacePath, maxBuffer: 10 * 1024 * 1024 },
    )

    const mergeBaseSha = stdout.trim()
    if (mergeBaseSha) {
      baseCommitRef = mergeBaseSha
    }
  } catch (error) {
    console.warn(
      `Failed to determine merge-base with ${baseBranchRef}, falling back to the branch tip for diffing.`,
      error,
    )
  }

  try {
    const { stdout } = await execFileAsync(
      'git',
      ['show', `${baseCommitRef}:${inputFileRelativePath}`],
      { cwd: workspacePath, maxBuffer: 10 * 1024 * 1024 },
    )

    return stdout
  } catch (error) {
    const stderr = error instanceof Error && 'stderr' in error ? String(error.stderr) : ''

    if (isMissingPathError(stderr)) {
      return null
    }

    console.warn(
      `Failed to read ${inputFileRelativePath} from ${baseCommitRef}, falling back to full translation.`,
      error,
    )
    return null
  }
}
