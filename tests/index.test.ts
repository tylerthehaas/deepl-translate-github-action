import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest'
import { createTranslatorOptions } from '../src/utils'

describe('index - timeout parameter initialization', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.clearAllMocks()
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
    vi.clearAllMocks()
  })

  test('should return undefined when timeout is not provided', () => {
    delete process.env.timeout

    const result = createTranslatorOptions()

    expect(result).toBeUndefined()
  })

  test('should return minTimeout when valid timeout is provided', () => {
    process.env.timeout = '10000'

    const result = createTranslatorOptions()

    expect(result).toEqual({ minTimeout: 10000 })
  })

  test('should return undefined when timeout is empty string', () => {
    process.env.timeout = ''

    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const result = createTranslatorOptions()

    expect(result).toBeUndefined()
    expect(consoleWarnSpy).not.toHaveBeenCalled()

    consoleWarnSpy.mockRestore()
  })

  test('should return undefined and warn when timeout is invalid (non-numeric)', () => {
    process.env.timeout = 'invalid'

    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const result = createTranslatorOptions()

    expect(result).toBeUndefined()
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      'Invalid timeout value: invalid. Expected a positive number in milliseconds. Ignoring timeout parameter.'
    )

    consoleWarnSpy.mockRestore()
  })

  test('should return undefined and warn when timeout is zero', () => {
    process.env.timeout = '0'

    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const result = createTranslatorOptions()

    expect(result).toBeUndefined()
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      'Invalid timeout value: 0. Expected a positive number in milliseconds. Ignoring timeout parameter.'
    )

    consoleWarnSpy.mockRestore()
  })

  test('should return undefined and warn when timeout is negative', () => {
    process.env.timeout = '-5000'

    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const result = createTranslatorOptions()

    expect(result).toBeUndefined()
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      'Invalid timeout value: -5000. Expected a positive number in milliseconds. Ignoring timeout parameter.'
    )

    consoleWarnSpy.mockRestore()
  })

  test('should return minTimeout when timeout is a valid positive number', () => {
    process.env.timeout = '5000'

    const result = createTranslatorOptions()

    expect(result).toEqual({ minTimeout: 5000 })
  })

  test('should return minTimeout when timeout is a large valid number', () => {
    process.env.timeout = '30000'

    const result = createTranslatorOptions()

    expect(result).toEqual({ minTimeout: 30000 })
  })

  test('should handle timeout with decimal values by parsing as integer', () => {
    process.env.timeout = '5000.99'

    const result = createTranslatorOptions()

    expect(result).toEqual({ minTimeout: 5000 })
  })
})
