import { afterEach, beforeEach, describe, expect, test, vi, type MockInstance } from 'vitest'
import type { MainFunctionParams } from '../src/main'
import { main } from '../src/main'
import fs from 'fs'

vi.mock('deepl-node', () => ({
  TargetLanguageCode: '',
}))

// Mock fs module at the top level
vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    promises: {
      readFile: vi.fn(),
      writeFile: vi.fn(),
      mkdir: vi.fn(),
    },
  },
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  promises: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
  },
}))

describe('main - HTMLlike files', () => {
  const mockTranslator = {
    translateText: vi.fn().mockResolvedValue({
      text: 'translated text',
    }),
  } as any

  let mockTranslatorSpy: MockInstance

  const fakeInputFileFolderPath = 'test'
  const fakeInputFilename = 'inputFilePath.md'
  const fakeOutputFileNamePattern = `${fakeInputFileFolderPath}/{language}.md`
  const fakeTempFilePath = 'to_translate.txt'
  const fakeReadFileResult = 'Your mocked data here'

  beforeEach(() => {
    mockTranslatorSpy = vi.spyOn(mockTranslator, 'translateText')

    // Mock fs methods
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue('readFile sync result')
    vi.mocked(fs.writeFileSync).mockReturnValue()

    // Mock fs.promises methods
    vi.mocked(fs.promises.readFile).mockResolvedValue(fakeReadFileResult)
    vi.mocked(fs.promises.writeFile).mockResolvedValue(undefined)
    vi.mocked(fs.promises.mkdir).mockResolvedValue(undefined as any)
  })
  afterEach(() => {
    vi.clearAllMocks()
  })
  test('should run without errors', async () => {
    const testParams: MainFunctionParams = {
      translator: mockTranslator,
      inputFilePath: `${fakeInputFileFolderPath}/${fakeInputFilename}`,
      outputFileNamePattern: fakeOutputFileNamePattern,
      tempFilePath: fakeTempFilePath,
      fileExtensionsThatAllowForIgnoringBlocks: ['.html', '.xml', '.md'],
      targetLanguages: ['de'],
    }
    await expect(main(testParams)).resolves.not.toThrow()
    expect(mockTranslatorSpy).toHaveBeenCalled()
  })
})

describe('main - JSON files', () => {
  const mockTranslator = {
    translateText: vi
      .fn()
      .mockResolvedValue([
        { text: 'translated text' },
        { text: 'another translated text' },
        { text: 'third translated text' },
      ]),
  } as any

  let mockTranslatorSpy: MockInstance

  const fakeInputFileFolderPath = 'test'
  const fakeInputFilename = 'inputFilePath.json'
  const fakeOutputFileNamePattern = `${fakeInputFileFolderPath}/{language}.json`
  const fakeTempFilePath = 'to_translate.txt'
  const testJSON = {
    welcome: 'Welcome, {{name}}!',
    language: 'Language',
    description: "This is a wonderful world isn't it?",
  }
  const testJSONstring = JSON.stringify(testJSON)

  beforeEach(() => {
    mockTranslatorSpy = vi.spyOn(mockTranslator, 'translateText')

    // Mock fs methods
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue(testJSONstring)
    vi.mocked(fs.writeFileSync).mockReturnValue()

    // Mock fs.promises methods with valid JSON
    vi.mocked(fs.promises.readFile).mockResolvedValue(testJSONstring)
    vi.mocked(fs.promises.writeFile).mockResolvedValue(undefined)
    vi.mocked(fs.promises.mkdir).mockResolvedValue(undefined as any)
  })
  afterEach(() => {
    vi.clearAllMocks()
  })
  test('should run without errors', async () => {
    const testParams: MainFunctionParams = {
      translator: mockTranslator,
      inputFilePath: `${fakeInputFileFolderPath}/${fakeInputFilename}`,
      outputFileNamePattern: fakeOutputFileNamePattern,
      tempFilePath: fakeTempFilePath,
      fileExtensionsThatAllowForIgnoringBlocks: ['.html', '.xml', '.md'],
      targetLanguages: ['de'],
    }
    await expect(main(testParams)).resolves.not.toThrow()
    expect(mockTranslatorSpy).toHaveBeenCalled()
  })
})
