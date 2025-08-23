import { describe, expect, test, vi } from "vitest";
import {
  removeKeepTagsFromString,
  replaceAll,
  replaceParameterStringsInJSONValueWithKeepTags,
  collectAllStringsFromJson,
  buildOutputFileName,
  buildOutputJson,
  translateStrings,
  groupItemsByLang,
  type TranslatedTextResult,
} from '../src/utils'
import * as fs from 'fs'
import * as path from 'path'

describe('replaceAll', () => {
  test('should replace all occurrences of a substring in a string', () => {
    const str = 'hello world'
    const search = 'l'
    const replacement = 'x'
    const expected = 'hexxo worxd'
    const result = replaceAll(str, search, replacement)
    expect(result).toEqual(expected)
  })

  test('should return the original string if the search string is not found', () => {
    const str = 'hello world'
    const search = 'z'
    const replacement = 'x'
    const expected = 'hello world'
    const result = replaceAll(str, search, replacement)
    expect(result).toEqual(expected)
  })
})

describe('removeKeepTagsFromString', () => {
  test('should remove all <keep> and </keep> tags from a string', () => {
    const str = 'hello <keep>world</keep>'
    const expected = 'hello world'
    const result = removeKeepTagsFromString(str)
    expect(result).toEqual(expected)
  })

  test('should return the original string if it does not contain <keep> tags', () => {
    const str = 'hello world'
    const expected = 'hello world'
    const result = removeKeepTagsFromString(str)
    expect(result).toEqual(expected)
  })
})

describe('buildOutputFileName', () => {
  test('should replace {language} with the target language', () => {
    const outputFileNamePattern = 'output_{language}.json'
    const targetLang = 'es'
    const expected = 'output_es.json'
    const result = buildOutputFileName(targetLang, outputFileNamePattern)

    expect(result).toEqual(expected)
  })

  test('should replace {language} with target language when multiple occurrences are present', () => {
    const outputFileNamePattern = 'output_{language}_{language}.json'
    const targetLang = 'es'
    const expected = 'output_es_es.json'
    const result = buildOutputFileName(targetLang, outputFileNamePattern)

    expect(result).toEqual(expected)
  })
})

describe('replaceParameterStringsInJSONValueWithKeepTags', () => {
  test('Should properly wrap {} and {{}} strings with keep tags', () => {
    const input = 'Hello {World} and {{Universe}}'
    const expectedOutput = 'Hello <keep>{World}</keep> and <keep>{{Universe}}</keep>'

    expect(replaceParameterStringsInJSONValueWithKeepTags(input)).toEqual(expectedOutput)
  })

  test('Should handle empty {} and {{}}', () => {
    const input = '{} and {{}}'
    const expectedOutput = '<keep>{}</keep> and <keep>{{}}</keep>'

    expect(replaceParameterStringsInJSONValueWithKeepTags(input)).toEqual(expectedOutput)
  })

  test('Should not modify strings without {} or {{}}', () => {
    const input = 'Hello World!'
    expect(replaceParameterStringsInJSONValueWithKeepTags(input)).toEqual(input)
  })

  test('Should handle strings with multiple {} and {{}}', () => {
    const input = '{Hello} {World} and {{Universe}}'
    const expectedOutput = '<keep>{Hello}</keep> <keep>{World}</keep> and <keep>{{Universe}}</keep>'

    expect(replaceParameterStringsInJSONValueWithKeepTags(input)).toEqual(expectedOutput)
  })
})

describe('collectAllStringsFromJson', () => {
  test('should handle simple flat object', () => {
    const input = {
      name: 'John',
      greeting: 'Hello',
      age: 30, // Should be ignored
      active: true, // Should be ignored
    }

    const result = collectAllStringsFromJson(input)

    expect(result.keys).toEqual(['name', 'greeting'])
    expect(result.values).toEqual(['John', 'Hello'])
    expect(result.keys.length).toBe(result.values.length)
  })

  test('should handle the user example correctly', () => {
    const input = {
      foo: 'some text',
      bar: { baz: 'some other text' },
    }

    const result = collectAllStringsFromJson(input)

    expect(result.keys).toEqual(['foo', 'bar.baz'])
    expect(result.values).toEqual(['some text', 'some other text'])
  })

  test('should handle deeply nested objects', () => {
    const input = {
      level1: {
        level2: {
          level3: {
            level4: {
              message: 'deep message',
            },
            another: 'another message',
          },
          surface: 'surface message',
        },
      },
      root: 'root message',
    }

    const result = collectAllStringsFromJson(input)

    // The iterative approach may produce keys in a different order than the recursive approach
    // So we check that all expected keys and values are present, regardless of order
    expect(result.keys).toHaveLength(4)
    expect(result.keys).toContain('level1.level2.level3.level4.message')
    expect(result.keys).toContain('level1.level2.level3.another')
    expect(result.keys).toContain('level1.level2.surface')
    expect(result.keys).toContain('root')

    expect(result.values).toHaveLength(4)
    expect(result.values).toContain('deep message')
    expect(result.values).toContain('another message')
    expect(result.values).toContain('surface message')
    expect(result.values).toContain('root message')
  })

  test('should ignore non-string values', () => {
    const input = {
      stringValue: 'keep this',
      numberValue: 42,
      booleanValue: true,
      nullValue: null,
      undefinedValue: undefined,
      arrayValue: ['ignore', 'this', 'array'],
      dateValue: new Date(),
      nested: {
        anotherString: 'keep this too',
        anotherNumber: 3.14,
        anotherArray: [1, 2, 3],
      },
    }

    const result = collectAllStringsFromJson(input)

    expect(result.keys).toEqual(['stringValue', 'nested.anotherString'])
    expect(result.values).toEqual(['keep this', 'keep this too'])
  })

  test('should handle empty objects', () => {
    const input = {}

    const result = collectAllStringsFromJson(input)

    expect(result.keys).toEqual([])
    expect(result.values).toEqual([])
  })

  test('should handle objects with only nested empty objects', () => {
    const input = {
      level1: {
        level2: {
          level3: {},
        },
      },
    }

    const result = collectAllStringsFromJson(input)

    expect(result.keys).toEqual([])
    expect(result.values).toEqual([])
  })

  test('should handle objects with mixed empty and non-empty nested objects', () => {
    const input = {
      empty: {},
      notEmpty: {
        message: 'found it',
      },
      anotherEmpty: {
        nested: {},
      },
    }

    const result = collectAllStringsFromJson(input)

    expect(result.keys).toEqual(['notEmpty.message'])
    expect(result.values).toEqual(['found it'])
  })

  test('should handle strings with special characters and whitespace', () => {
    const input = {
      special: 'Special chars: @#$%^&*()',
      whitespace: '   spaces around   ',
      multiline: 'line1\nline2\nline3',
      unicode: 'Unicode: 你好 🌍',
      empty: '',
      nested: {
        quotes: 'She said "Hello"',
        singleQuotes: "It's working",
      },
    }

    const result = collectAllStringsFromJson(input)

    expect(result.keys).toEqual([
      'special',
      'whitespace',
      'multiline',
      'unicode',
      'empty',
      'nested.quotes',
      'nested.singleQuotes',
    ])
    expect(result.values).toEqual([
      'Special chars: @#$%^&*()',
      '   spaces around   ',
      'line1\nline2\nline3',
      'Unicode: 你好 🌍',
      '',
      'She said "Hello"',
      "It's working",
    ])
  })

  test('should handle arrays correctly (ignore them)', () => {
    const input = {
      stringValue: 'keep this',
      arrayOfStrings: ['ignore', 'all', 'of', 'these'],
      nested: {
        anotherString: 'keep this too',
        arrayOfObjects: [{ ignore: 'this object' }, { also: 'ignore this' }],
        mixedArray: [1, 'ignore', true, { nested: 'ignore' }],
      },
    }

    const result = collectAllStringsFromJson(input)

    expect(result.keys).toEqual(['stringValue', 'nested.anotherString'])
    expect(result.values).toEqual(['keep this', 'keep this too'])
  })

  test('should maintain correct index correspondence between keys and values', () => {
    const input = {
      first: 'value1',
      second: {
        nested: 'value2',
        deeper: {
          deep: 'value3',
        },
      },
      third: 'value4',
    }

    const result = collectAllStringsFromJson(input)

    // Verify each key corresponds to its value at the same index
    for (let i = 0; i < result.keys.length; i++) {
      const keyPath = result.keys[i]
      const expectedValue = result.values[i]

      // Navigate to the value using the key path
      let actualValue = input
      const pathParts = keyPath.split('.')
      for (const part of pathParts) {
        actualValue = actualValue[part]
      }

      expect(actualValue).toBe(expectedValue)
    }
  })

  test('should handle complex real-world JSON structure', () => {
    // Load the fixture file
    const fixturePath = path.join(__dirname, 'fixtures', 'nestedJSON1.json')
    const fixtureContent = fs.readFileSync(fixturePath, 'utf8')
    const input = JSON.parse(fixtureContent)

    const result = collectAllStringsFromJson(input)

    // Should find many strings (exact count may vary with fixture changes)
    expect(result.keys.length).toBeGreaterThan(50)
    expect(result.values.length).toBe(result.keys.length)

    // Verify some expected keys exist
    expect(result.keys).toContain('pages.login.title')
    expect(result.keys).toContain('pages.login.fields.email')
    expect(result.keys).toContain('buttons.create')
    expect(result.keys).toContain('notifications.error')

    // Verify some expected values exist
    expect(result.values).toContain('Sign in to your account')
    expect(result.values).toContain('Email')
    expect(result.values).toContain('Create')
    expect(result.values).toContain('Error (status code: {{statusCode}})')

    // Verify all collected strings are actually strings
    result.values.forEach((value) => {
      expect(typeof value).toBe('string')
    })

    // Verify all keys follow dot notation pattern (including escaped dots)
    result.keys.forEach((key) => {
      expect(key).toMatch(/^[a-zA-Z_][a-zA-Z0-9_\\.-]*(\.[a-zA-Z_][a-zA-Z0-9_\\.-]*)*$/)
    })
  })

  test('should handle objects with numeric and special character keys', () => {
    const input = {
      'normal-key': 'normal value',
      '123': 'numeric key',
      'key with spaces': 'spaced key',
      nested: {
        '456': 'nested numeric',
        'special@key': 'special char key',
      },
    }

    const result = collectAllStringsFromJson(input)

    expect(result.keys).toContain('normal-key')
    expect(result.keys).toContain('123')
    expect(result.keys).toContain('key with spaces')
    expect(result.keys).toContain('nested.456')
    expect(result.keys).toContain('nested.special@key')

    expect(result.values).toContain('normal value')
    expect(result.values).toContain('numeric key')
    expect(result.values).toContain('spaced key')
    expect(result.values).toContain('nested numeric')
    expect(result.values).toContain('special char key')
  })

  test('should handle very deeply nested structure (stress test)', () => {
    // Create a deeply nested structure programmatically
    let deeplyNested: Record<string, any> = {}
    let current: Record<string, any> = deeplyNested
    const depth = 20

    for (let i = 0; i < depth; i++) {
      current[`level${i}`] = {}
      current = current[`level${i}`]
    }
    current.finalMessage = 'found at the end'

    const result = collectAllStringsFromJson(deeplyNested)

    const expectedKey = Array.from({ length: depth }, (_, i) => `level${i}`).join('.') + '.finalMessage'
    expect(result.keys).toContain(expectedKey)
    expect(result.values).toContain('found at the end')
  })

  test('should handle extremely deep nesting without stack overflow (iterative approach)', () => {
    // Create an extremely deeply nested structure to test iterative approach
    let extremelyDeep: Record<string, any> = {}
    let current: Record<string, any> = extremelyDeep
    const depth = 1000 // Much deeper than would be safe with recursion

    for (let i = 0; i < depth; i++) {
      current[`deep${i}`] = {}
      current = current[`deep${i}`]
    }
    current.treasureAtTheEnd = 'success!'
    current.anotherString = 'also found'

    const result = collectAllStringsFromJson(extremelyDeep)

    const expectedKey1 = Array.from({ length: depth }, (_, i) => `deep${i}`).join('.') + '.treasureAtTheEnd'
    const expectedKey2 = Array.from({ length: depth }, (_, i) => `deep${i}`).join('.') + '.anotherString'

    expect(result.keys).toContain(expectedKey1)
    expect(result.keys).toContain(expectedKey2)
    expect(result.values).toContain('success!')
    expect(result.values).toContain('also found')

    // Verify we found exactly 2 strings
    expect(result.keys.length).toBe(2)
    expect(result.values.length).toBe(2)
  })

  test('should handle keys that contain dots', () => {
    const input = {
      'user.name': 'John Doe',
      'api.key': 'secret123',
      'config.env.prod': 'production value',
      user: {
        age: '30',
        'profile.picture': 'avatar.jpg',
      },
      nested: {
        'dot.key': 'nested dot value',
        regular: 'regular nested value',
      },
    }

    const result = collectAllStringsFromJson(input)

    // Keys with literal dots should be escaped
    expect(result.keys).toContain('user\\.name')
    expect(result.keys).toContain('api\\.key')
    expect(result.keys).toContain('config\\.env\\.prod')
    expect(result.keys).toContain('user.profile\\.picture')
    expect(result.keys).toContain('nested.dot\\.key')

    // Regular nested keys should use normal dot notation
    expect(result.keys).toContain('user.age')
    expect(result.keys).toContain('nested.regular')

    // Verify corresponding values
    expect(result.values).toContain('John Doe')
    expect(result.values).toContain('secret123')
    expect(result.values).toContain('production value')
    expect(result.values).toContain('avatar.jpg')
    expect(result.values).toContain('nested dot value')
    expect(result.values).toContain('30')
    expect(result.values).toContain('regular nested value')

    // Verify index correspondence for keys with escaped dots
    const userNameIndex = result.keys.indexOf('user\\.name')
    expect(result.values[userNameIndex]).toBe('John Doe')

    const apiKeyIndex = result.keys.indexOf('api\\.key')
    expect(result.values[apiKeyIndex]).toBe('secret123')

    const nestedDotKeyIndex = result.keys.indexOf('nested.dot\\.key')
    expect(result.values[nestedDotKeyIndex]).toBe('nested dot value')
  })

  test('should handle size-based batching for translateStrings', () => {
    // Mock translator for testing
    const mockTranslator = {
      translateText: vi.fn().mockResolvedValue([{ text: 'translated' }]),
    } as any

    // Create strings of varying sizes to test batching
    const shortStrings = Array(10).fill('short')
    const mediumStrings = Array(5).fill('medium length string')
    const longString = 'x'.repeat(100000) // ~100 KiB string
    const veryLongString = 'x'.repeat(120000) // ~120 KiB string (just under the limit)

    const allStrings = [...shortStrings, ...mediumStrings, longString, veryLongString]

    const result = translateStrings(allStrings, 'es', mockTranslator)

    // Should create multiple batches due to size constraints
    expect(result.length).toBeGreaterThan(1)

    // Verify that the very long string gets its own batch
    expect(mockTranslator.translateText).toHaveBeenCalled()

    // Check that no single batch exceeds the text size limit (128 KiB - overhead)
    const maxTextSizeBytes = 128 * 1024 - 2048 // 128 KiB - 2KB overhead
    const calls = mockTranslator.translateText.mock.calls
    calls.forEach((call: any) => {
      const batch = call[0] // First argument is the batch array
      const batchSizeBytes = new TextEncoder().encode(batch.join('')).length
      expect(batchSizeBytes).toBeLessThanOrEqual(maxTextSizeBytes)
    })

    // Verify that the very long string is in its own batch
    const veryLongStringBatch = calls.find((call: any) => call[0].some((str: string) => str.length === 120000))
    expect(veryLongStringBatch).toBeDefined()
    expect(veryLongStringBatch[0]).toHaveLength(1) // Should be alone in its batch
  })

  test('should handle rate limiting with exponential backoff', async () => {
    let callCount = 0
    const mockTranslator = {
      translateText: vi.fn().mockImplementation(async () => {
        callCount++
        if (callCount === 1) {
          const error = new Error('Too many requests, DeepL servers are currently experiencing high load') as any
          error.status = 429
          throw error
        }
        return [{ text: 'translated' }]
      }),
    } as any

    const result = translateStrings(['test string'], 'es', mockTranslator)

    expect(result).toHaveLength(1)
    expect(Array.isArray(result)).toBe(true)

    // Track timing to verify exponential backoff
    const startTime = Date.now()
    const translationResult = await result[0]
    const totalTime = Date.now() - startTime

    expect(translationResult).toEqual({ lang: 'es', text: ['translated'] })
    expect(mockTranslator.translateText).toHaveBeenCalledTimes(2)

    // Verify that the delay was approximately 1000ms (base delay)
    // Allow some tolerance for test execution overhead
    expect(totalTime).toBeGreaterThanOrEqual(900) // At least 900ms
    expect(totalTime).toBeLessThanOrEqual(1500) // No more than 1500ms
  }, 10000) // Increase timeout to 10 seconds

  test('should handle non-rate-limit errors immediately', async () => {
    const mockTranslator = {
      translateText: vi.fn().mockRejectedValue(new Error('Authentication failed')),
    } as any

    const result = translateStrings(['test string'], 'es', mockTranslator)

    expect(result).toHaveLength(1)

    await expect(result[0]).rejects.toThrow('Authentication failed')

    expect(mockTranslator.translateText).toHaveBeenCalledTimes(1)
  })

  test('should handle multiple rate limit retries with increasing delays', async () => {
    let callCount = 0
    const mockTranslator = {
      translateText: vi.fn().mockImplementation(async () => {
        callCount++
        if (callCount <= 3) {
          // First 3 calls fail with rate limit error
          const error = new Error('Too many requests, DeepL servers are currently experiencing high load') as any
          error.status = 429
          throw error
        }
        // 4th call succeeds
        return [{ text: 'translated' }]
      }),
    } as any

    const result = translateStrings(['test string'], 'es', mockTranslator)

    expect(result).toHaveLength(1)

    // Track timing to verify exponential backoff progression
    const startTime = Date.now()
    const translationResult = await result[0]
    const totalTime = Date.now() - startTime

    expect(translationResult).toEqual({ lang: 'es', text: ['translated'] })
    expect(mockTranslator.translateText).toHaveBeenCalledTimes(4)

    // Verify that the total delay was approximately:
    // 1st retry: 1000ms (base delay)
    // 2nd retry: 2000ms (base * 2^1)
    // 3rd retry: 4000ms (base * 2^2)
    // Total: ~7000ms minimum
    expect(totalTime).toBeGreaterThanOrEqual(6500) // At least 6.5 seconds
    expect(totalTime).toBeLessThanOrEqual(9000) // No more than 9 seconds
  }, 10000) // Increase timeout to 10 seconds
})

describe('buildOutputJson', () => {
  test('should handle simple flat object reconstruction', () => {
    const translatedTexts = ['Hello', 'World']
    const jsonKeys = ['greeting', 'message']

    const result = buildOutputJson(translatedTexts, jsonKeys)

    expect(result).toEqual({
      greeting: 'Hello',
      message: 'World',
    })
  })

  test('should handle nested object reconstruction', () => {
    const translatedTexts = ['Hello', 'World']
    const jsonKeys = ['greeting', 'user.name']

    const result = buildOutputJson(translatedTexts, jsonKeys)

    expect(result).toEqual({
      greeting: 'Hello',
      user: {
        name: 'World',
      },
    })
  })

  test('should handle deeply nested object reconstruction', () => {
    const translatedTexts = ['deep message', 'another message', 'surface message', 'root message']
    const jsonKeys = [
      'level1.level2.level3.level4.message',
      'level1.level2.level3.another',
      'level1.level2.surface',
      'root',
    ]

    const result = buildOutputJson(translatedTexts, jsonKeys)

    expect(result).toEqual({
      level1: {
        level2: {
          level3: {
            level4: {
              message: 'deep message',
            },
            another: 'another message',
          },
          surface: 'surface message',
        },
      },
      root: 'root message',
    })
  })

  test('should handle literal dots in keys (escaped dots)', () => {
    const translatedTexts = [
      'John Doe',
      'secret123',
      'production value',
      '30',
      'avatar.jpg',
      'nested dot value',
      'regular nested value',
    ]
    const jsonKeys = [
      'user\\.name',
      'api\\.key',
      'config\\.env\\.prod',
      'user.age',
      'user.profile\\.picture',
      'nested.dot\\.key',
      'nested.regular',
    ]

    const result = buildOutputJson(translatedTexts, jsonKeys)

    expect(result).toEqual({
      'user.name': 'John Doe',
      'api.key': 'secret123',
      'config.env.prod': 'production value',
      user: {
        age: '30',
        'profile.picture': 'avatar.jpg',
      },
      nested: {
        'dot.key': 'nested dot value',
        regular: 'regular nested value',
      },
    })
  })

  test('should handle mixed literal dots and nested objects', () => {
    const translatedTexts = ['Hello', 'World', 'Universe']
    const jsonKeys = ['greeting', 'user\\.profile.name', 'user\\.profile.description']

    const result = buildOutputJson(translatedTexts, jsonKeys)

    expect(result).toEqual({
      greeting: 'Hello',
      'user.profile': {
        name: 'World',
        description: 'Universe',
      },
    })
  })

  test('should handle empty arrays', () => {
    const translatedTexts: string[] = []
    const jsonKeys: string[] = []

    const result = buildOutputJson(translatedTexts, jsonKeys)

    expect(result).toEqual({})
  })

  test('should handle single key-value pair', () => {
    const translatedTexts = ['Single value']
    const jsonKeys = ['single']

    const result = buildOutputJson(translatedTexts, jsonKeys)

    expect(result).toEqual({
      single: 'Single value',
    })
  })

  test('should handle complex real-world example', () => {
    const translatedTexts = ['Sign in to your account', 'Email', 'Create', 'Error (status code: {{statusCode}})']
    const jsonKeys = ['pages.login.title', 'pages.login.fields.email', 'buttons.create', 'notifications.error']

    const result = buildOutputJson(translatedTexts, jsonKeys)

    expect(result).toEqual({
      pages: {
        login: {
          title: 'Sign in to your account',
          fields: {
            email: 'Email',
          },
        },
      },
      buttons: {
        create: 'Create',
      },
      notifications: {
        error: 'Error (status code: {{statusCode}})',
      },
    })
  })
})

describe('groupItemsByLang', () => {
  test('should group items by language code', () => {
    const input: TranslatedTextResult[] = [
      { lang: 'es', text: ['hola', 'mundo'] },
      { lang: 'fr', text: ['bonjour'] },
      { lang: 'es', text: ['adios'] },
      { lang: 'de', text: ['hallo'] },
      { lang: 'fr', text: ['au revoir'] },
    ]

    const result = groupItemsByLang(input)

    expect(result).toEqual({
      es: ['hola', 'mundo', 'adios'],
      fr: ['bonjour', 'au revoir'],
      de: ['hallo'],
    })
  })

  test('should handle single language with multiple items', () => {
    const input: TranslatedTextResult[] = [
      { lang: 'es', text: ['hola'] },
      { lang: 'es', text: ['mundo'] },
      { lang: 'es', text: ['adios'] },
    ]

    const result = groupItemsByLang(input)

    expect(result).toEqual({
      es: ['hola', 'mundo', 'adios'],
    })
  })

  test('should handle single item per language', () => {
    const input: TranslatedTextResult[] = [
      { lang: 'es', text: ['hola'] },
      { lang: 'fr', text: ['bonjour'] },
      { lang: 'de', text: ['hallo'] },
    ]

    const result = groupItemsByLang(input)

    expect(result).toEqual({
      es: ['hola'],
      fr: ['bonjour'],
      de: ['hallo'],
    })
  })

  test('should handle empty array', () => {
    const input: TranslatedTextResult[] = []

    const result = groupItemsByLang(input)

    expect(result).toEqual({})
  })

  test('should handle single item', () => {
    const input: TranslatedTextResult[] = [{ lang: 'es', text: ['hola'] }]

    const result = groupItemsByLang(input)

    expect(result).toEqual({
      es: ['hola'],
    })
  })

  test('should preserve order of text arrays within each language', () => {
    const input: TranslatedTextResult[] = [
      { lang: 'es', text: ['first', 'second'] },
      { lang: 'es', text: ['third'] },
      { lang: 'es', text: ['fourth', 'fifth'] },
    ]

    const result = groupItemsByLang(input)

    expect(result.es).toEqual(['first', 'second', 'third', 'fourth', 'fifth'])
  })

  test('should handle mixed language codes including variants', () => {
    const input: TranslatedTextResult[] = [
      { lang: 'en-US', text: ['hello'] },
      { lang: 'en-GB', text: ['hello'] },
      { lang: 'pt-BR', text: ['olá'] },
      { lang: 'pt-PT', text: ['olá'] },
      { lang: 'zh', text: ['你好'] },
    ]

    const result = groupItemsByLang(input)

    expect(result).toEqual({
      'en-US': ['hello'],
      'en-GB': ['hello'],
      'pt-BR': ['olá'],
      'pt-PT': ['olá'],
      zh: ['你好'],
    })
  })
})
