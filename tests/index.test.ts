import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest'
import { Translator } from 'deepl-node'

// Mock deepl-node before any imports
vi.mock('deepl-node', () => ({
  Translator: vi.fn(),
}))

// Mock main to prevent it from running
vi.mock('../src/main', () => ({
  main: vi.fn(),
}))

// Mock utils to spy on createTranslatorOptions
vi.mock('../src/utils', async () => {
  const actual = await vi.importActual('../src/utils')
  return {
    ...actual,
    createTranslatorOptions: vi.fn(),
  }
})

describe('index - timeout parameter initialization', () => {
  const originalEnv = process.env
  let mockTranslatorConstructor: ReturnType<typeof vi.fn>
  let mockCreateTranslatorOptions: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.clearAllMocks()
    process.env = { ...originalEnv }

    // Get fresh mocks
    const { Translator } = await import('deepl-node')
    mockTranslatorConstructor = vi.mocked(Translator)
    mockTranslatorConstructor.mockClear()

    const utils = await import('../src/utils')
    mockCreateTranslatorOptions = vi.mocked(utils.createTranslatorOptions)
    mockCreateTranslatorOptions.mockClear()
  })

  afterEach(() => {
    process.env = originalEnv
    vi.clearAllMocks()
  })

  test('should call createTranslatorOptions with timeout from environment and pass result to Translator', async () => {
    process.env.deepl_api_key = 'test-api-key'
    process.env.timeout = '10000'
    process.env.GITHUB_WORKSPACE = '/workspace'
    process.env.input_file_path = 'test.md'
    process.env.output_file_name_pattern = 'output.md'

    // Mock the return value
    mockCreateTranslatorOptions.mockReturnValue({ minTimeout: 10000 })

    // Mock Translator constructor
    mockTranslatorConstructor.mockImplementation(() => ({
      getTargetLanguages: vi.fn().mockResolvedValue([]),
    }))

    // Reset modules after setting env vars to ensure fresh import
    vi.resetModules()
    
    // Re-import mocks after reset
    const { Translator } = await import('deepl-node')
    mockTranslatorConstructor = vi.mocked(Translator)
    const utils = await import('../src/utils')
    mockCreateTranslatorOptions = vi.mocked(utils.createTranslatorOptions)
    mockCreateTranslatorOptions.mockReturnValue({ minTimeout: 10000 })
    mockTranslatorConstructor.mockImplementation(() => ({
      getTargetLanguages: vi.fn().mockResolvedValue([]),
    }))

    // Import index to trigger initialization
    await import('../src/index')

    // Wait a bit for the module to initialize
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(mockCreateTranslatorOptions).toHaveBeenCalledWith('10000')
    expect(mockTranslatorConstructor).toHaveBeenCalledWith('test-api-key', { minTimeout: 10000 })
  })

  test('should call createTranslatorOptions with undefined when timeout is not set', async () => {
    process.env.deepl_api_key = 'test-api-key'
    delete process.env.timeout
    process.env.GITHUB_WORKSPACE = '/workspace'
    process.env.input_file_path = 'test.md'
    process.env.output_file_name_pattern = 'output.md'

    // Reset modules after setting env vars to ensure fresh import
    vi.resetModules()
    
    // Re-import mocks after reset
    const { Translator } = await import('deepl-node')
    mockTranslatorConstructor = vi.mocked(Translator)
    const utils = await import('../src/utils')
    mockCreateTranslatorOptions = vi.mocked(utils.createTranslatorOptions)
    mockCreateTranslatorOptions.mockReturnValue(undefined)
    mockTranslatorConstructor.mockImplementation(() => ({
      getTargetLanguages: vi.fn().mockResolvedValue([]),
    }))

    // Import index to trigger initialization
    await import('../src/index')

    // Wait a bit for the module to initialize
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(mockCreateTranslatorOptions).toHaveBeenCalledWith(undefined)
    expect(mockTranslatorConstructor).toHaveBeenCalledWith('test-api-key', undefined)
  })
})
