import type { TargetLanguageCode, Translator, TextResult } from "deepl-node";
import type { ModelType } from "./main";

const maxTextsPerBatch = 50

export interface TranslatedTextResult {
  lang: TargetLanguageCode
  text: string[]
}

interface CollectedStrings {
  keys: string[]
  values: string[]
}

interface TranslateTextsOptions {
  modelType?: ModelType
  preprocess?: (value: string) => string
  postprocess?: (value: string) => string
}

export interface TextDocument {
  lines: string[]
  eol: '\n' | '\r\n'
  endsWithNewline: boolean
}

export interface TextLineMetadata {
  preparedLine: string
  shouldTranslate: boolean
  outputLine: string
}

export interface LineDiffOperation {
  type: 'equal' | 'insert' | 'delete'
  lines: string[]
}

type PossibleRecursive<T> = {
  [K in keyof T]: T[K] extends object ? PossibleRecursive<T[K]> : T[K]
}

type TranslatedJSONResults = Record<TargetLanguageCode, PossibleRecursive<Record<string, string>>>

function replaceAll(str: string, search: string, replacement: string): string {
  let index = str.indexOf(search)
  while (index !== -1) {
    str = str.replace(search, replacement)
    index = str.indexOf(search)
  }
  return str
}

function replaceParameterStringsInJSONValueWithKeepTags(value: string): string {
  const termRegex = /({{.*?}}|{.*?})/g
  return value.replace(termRegex, (match) => `<keep>${match}</keep>`)
}

function removeKeepTagsFromString(str: string): string {
  if (!str.includes('<keep>')) return str

  const textWithNoTranslateStartTagReplaced = replaceAll(str, '<keep>', '')
  const textWithNoTranslateEndTagReplaced = replaceAll(textWithNoTranslateStartTagReplaced, '</keep>', '')
  return textWithNoTranslateEndTagReplaced
}

/**
 * Collects all string values from a JSON object along with their dot-notation keys.
 */
function collectAllStringsFromJson(json: Record<string, any>, prefix: string = ''): CollectedStrings {
  const keys: string[] = []
  const values: string[] = []

  interface StackItem {
    obj: Record<string, any>
    currentPrefix: string
    keysToProcess?: string[]
    currentKeyIndex?: number
  }

  const stack: StackItem[] = [
    {
      obj: json,
      currentPrefix: prefix,
      keysToProcess: Object.keys(json),
      currentKeyIndex: 0,
    },
  ]

  while (stack.length > 0) {
    const current = stack[stack.length - 1]
    const { obj, currentPrefix, keysToProcess = [], currentKeyIndex = 0 } = current

    if (currentKeyIndex >= keysToProcess.length) {
      stack.pop()
      continue
    }

    const key = keysToProcess[currentKeyIndex]
    current.currentKeyIndex = currentKeyIndex + 1

    if (!Object.prototype.hasOwnProperty.call(obj, key)) continue

    const value = obj[key]
    const escapedKey = key.replace(/\./g, '\\.')
    const newKey = currentPrefix ? `${currentPrefix}.${escapedKey}` : escapedKey

    if (typeof value === 'string') {
      keys.push(newKey)
      values.push(value)
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      stack.push({
        obj: value,
        currentPrefix: newKey,
        keysToProcess: Object.keys(value),
        currentKeyIndex: 0,
      })
    }
  }

  return { keys, values }
}

function collectStringMapFromJson(json: Record<string, any>) {
  const { keys, values } = collectAllStringsFromJson(json)
  return new Map(keys.map((key, index) => [key, values[index]]))
}

async function translateWithExponentialBackoffRetry(
  batch: string[],
  targetLanguage: TargetLanguageCode,
  translator: Translator,
  modelType?: ModelType,
  maxRetries: number = 5,
  baseDelay: number = 1000,
): Promise<TextResult[]> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const translateOptions: {
        preserveFormatting: boolean
        tagHandling: 'xml'
        ignoreTags: string[]
        modelType?: ModelType
      } = {
        preserveFormatting: true,
        tagHandling: 'xml',
        ignoreTags: ['keep'],
      }

      if (modelType) {
        translateOptions.modelType = modelType
      }

      const result = await translator.translateText(batch, null, targetLanguage, translateOptions)
      return Array.isArray(result) ? result : [result]
    } catch (error: any) {
      if (error.message?.includes('Too many requests') || error.status === 429) {
        if (attempt === maxRetries) {
          throw error
        }

        const delay = baseDelay * Math.pow(2, attempt)
        console.log(`Rate limited (429) on attempt ${attempt + 1}, retrying in ${delay}ms...`)

        await new Promise((resolve) => setTimeout(resolve, delay))
        continue
      }

      throw error
    }
  }

  throw new Error('Unexpected error in translateWithRetry')
}

async function translateTexts(
  sourceStrings: string[],
  targetLanguage: TargetLanguageCode,
  translator: Translator,
  options: TranslateTextsOptions = {},
): Promise<string[]> {
  if (sourceStrings.length === 0) {
    return []
  }

  const preprocess = options.preprocess ?? replaceParameterStringsInJSONValueWithKeepTags
  const postprocess = options.postprocess ?? ((value: string) => value)
  const textsToBeTranslated = sourceStrings.map(preprocess)
  const maxRequestSizeBytes = 128 * 1024
  const estimatedOverheadBytes = 2048
  const maxTextSizeBytes = maxRequestSizeBytes - estimatedOverheadBytes
  const translatedTexts: string[] = []

  let currentBatch: string[] = []
  let currentBatchSize = 0

  const flushBatch = async () => {
    if (currentBatch.length === 0) {
      return
    }

    const result = await translateWithExponentialBackoffRetry(
      currentBatch,
      targetLanguage,
      translator,
      options.modelType,
    )

    translatedTexts.push(...result.map((item) => postprocess(item.text)))
    currentBatch = []
    currentBatchSize = 0
  }

  for (const text of textsToBeTranslated) {
    const textSizeBytes = new TextEncoder().encode(text).length

    if (textSizeBytes > maxTextSizeBytes) {
      throw new Error(
        `Text length ${text.length} exceeds maxTextSizeBytes ${maxTextSizeBytes} (encoded size: ${textSizeBytes} bytes)`,
      )
    }

    if (
      currentBatch.length > 0
      && (currentBatchSize + textSizeBytes > maxTextSizeBytes || currentBatch.length >= maxTextsPerBatch)
    ) {
      await flushBatch()
    }

    currentBatch.push(text)
    currentBatchSize += textSizeBytes
  }

  await flushBatch()
  return translatedTexts
}

function groupItemsByLang(arr: TranslatedTextResult[]): Record<TargetLanguageCode, string[]> {
  return arr.reduce((acc: Record<TargetLanguageCode, string[]>, currentItem: TranslatedTextResult) => {
    if (acc[currentItem.lang]) {
      acc[currentItem.lang] = acc[currentItem.lang].concat(currentItem.text)
    } else {
      acc[currentItem.lang] = currentItem.text
    }
    return acc
  }, {} as Record<TargetLanguageCode, string[]>)
}

function translateStrings(
  sourceStrings: string[],
  targetLanguage: TargetLanguageCode,
  translator: Translator,
  modelType?: ModelType,
): Promise<TranslatedTextResult>[] {
  const textsToBeTranslated = sourceStrings.map(replaceParameterStringsInJSONValueWithKeepTags)
  const maxRequestSizeBytes = 128 * 1024
  const estimatedOverheadBytes = 2048
  const maxTextSizeBytes = maxRequestSizeBytes - estimatedOverheadBytes
  const promises: Promise<TranslatedTextResult>[] = []

  let currentBatch: string[] = []
  let currentBatchSize = 0

  const createBatchPromise = (batch: string[]) =>
    translateWithExponentialBackoffRetry(batch, targetLanguage, translator, modelType).then((result) => ({
      lang: targetLanguage,
      text: result.map((item) => item.text),
    }))

  const flushBatch = () => {
    if (currentBatch.length === 0) {
      return
    }

    promises.push(createBatchPromise(currentBatch))
    currentBatch = []
    currentBatchSize = 0
  }

  for (const text of textsToBeTranslated) {
    const textSizeBytes = new TextEncoder().encode(text).length

    if (textSizeBytes > maxTextSizeBytes) {
      throw new Error(
        `Text length ${text.length} exceeds maxTextSizeBytes ${maxTextSizeBytes} (encoded size: ${textSizeBytes} bytes)`,
      )
    }

    if (
      currentBatch.length > 0
      && (currentBatchSize + textSizeBytes > maxTextSizeBytes || currentBatch.length >= maxTextsPerBatch)
    ) {
      flushBatch()
    }

    currentBatch.push(text)
    currentBatchSize += textSizeBytes
  }

  flushBatch()

  return promises
}

function buildOutputFileName(targetLang: string, outputFileNamePattern: string) {
  return outputFileNamePattern.replace(/\{language\}/g, targetLang)
}

function splitJsonKeyPath(key: string) {
  return key.split(/(?<!\\)\./).map((part) => part.replace(/\\\./g, '.'))
}

function setNestedValue(target: Record<string, any>, jsonKey: string, value: string) {
  const keyParts = splitJsonKeyPath(jsonKey)
  let currentLevel = target

  for (let index = 0; index < keyParts.length; index++) {
    const part = keyParts[index]
    const isLastPart = index === keyParts.length - 1

    if (isLastPart) {
      currentLevel[part] = removeKeepTagsFromString(value)
      return
    }

    if (!currentLevel[part] || typeof currentLevel[part] !== 'object' || Array.isArray(currentLevel[part])) {
      currentLevel[part] = {}
    }

    currentLevel = currentLevel[part]
  }
}

function deleteNestedValue(target: Record<string, any>, jsonKey: string) {
  const keyParts = splitJsonKeyPath(jsonKey)

  const remove = (currentLevel: Record<string, any>, depth: number): boolean => {
    const part = keyParts[depth]

    if (!Object.prototype.hasOwnProperty.call(currentLevel, part)) {
      return false
    }

    if (depth === keyParts.length - 1) {
      delete currentLevel[part]
      return Object.keys(currentLevel).length === 0
    }

    const nextLevel = currentLevel[part]
    if (!nextLevel || typeof nextLevel !== 'object' || Array.isArray(nextLevel)) {
      return false
    }

    const shouldDeleteCurrent = remove(nextLevel, depth + 1)
    if (shouldDeleteCurrent) {
      delete currentLevel[part]
    }

    return Object.keys(currentLevel).length === 0
  }

  remove(target, 0)
}

function buildOutputJson(translatedTexts: string[], jsonKeys: string[]): Record<string, any> {
  const result: Record<string, any> = {}

  for (let i = 0; i < jsonKeys.length; i++) {
    setNestedValue(result, jsonKeys[i], translatedTexts[i])
  }

  return result
}

function parseJsonString<T>(jsonString: string): T | null {
  try {
    return JSON.parse(jsonString) as T
  } catch {
    return null
  }
}

function pushLineDiffOperation(operations: LineDiffOperation[], type: LineDiffOperation['type'], line: string) {
  const previousOperation = operations[operations.length - 1]
  if (previousOperation && previousOperation.type === type) {
    previousOperation.lines.push(line)
    return
  }

  operations.push({ type, lines: [line] })
}

function diffLines(baseLines: string[], currentLines: string[]): LineDiffOperation[] {
  const rows = baseLines.length + 1
  const cols = currentLines.length + 1
  const lcs: number[][] = Array.from({ length: rows }, () => Array<number>(cols).fill(0))

  for (let baseIndex = baseLines.length - 1; baseIndex >= 0; baseIndex--) {
    for (let currentIndex = currentLines.length - 1; currentIndex >= 0; currentIndex--) {
      if (baseLines[baseIndex] === currentLines[currentIndex]) {
        lcs[baseIndex][currentIndex] = lcs[baseIndex + 1][currentIndex + 1] + 1
      } else {
        lcs[baseIndex][currentIndex] = Math.max(lcs[baseIndex + 1][currentIndex], lcs[baseIndex][currentIndex + 1])
      }
    }
  }

  const operations: LineDiffOperation[] = []
  let baseIndex = 0
  let currentIndex = 0

  while (baseIndex < baseLines.length && currentIndex < currentLines.length) {
    if (baseLines[baseIndex] === currentLines[currentIndex]) {
      pushLineDiffOperation(operations, 'equal', currentLines[currentIndex])
      baseIndex++
      currentIndex++
    } else if (lcs[baseIndex + 1][currentIndex] >= lcs[baseIndex][currentIndex + 1]) {
      pushLineDiffOperation(operations, 'delete', baseLines[baseIndex])
      baseIndex++
    } else {
      pushLineDiffOperation(operations, 'insert', currentLines[currentIndex])
      currentIndex++
    }
  }

  while (baseIndex < baseLines.length) {
    pushLineDiffOperation(operations, 'delete', baseLines[baseIndex])
    baseIndex++
  }

  while (currentIndex < currentLines.length) {
    pushLineDiffOperation(operations, 'insert', currentLines[currentIndex])
    currentIndex++
  }

  return operations
}

function parseTextDocument(text: string): TextDocument {
  const eol: '\n' | '\r\n' = text.includes('\r\n') ? '\r\n' : '\n'
  const normalizedText = text.replace(/\r\n/g, '\n')
  const endsWithNewline = normalizedText.endsWith('\n')
  const lines = normalizedText.split('\n')

  if (endsWithNewline) {
    lines.pop()
  }

  return { lines, eol, endsWithNewline }
}

function stringifyTextDocument(document: TextDocument) {
  const body = document.lines.join(document.eol)
  return document.endsWithNewline ? `${body}${document.eol}` : body
}

function getTextLineMetadata(
  lines: string[],
  startTag?: string,
  endTag?: string,
): TextLineMetadata[] {
  let insideNoTranslateBlock = false
  const hasNoTranslateTags = Boolean(startTag && endTag)

  return lines.map((line) => {
    const hasStartTag = Boolean(hasNoTranslateTags && startTag && line.includes(startTag))
    const hasEndTag = Boolean(hasNoTranslateTags && endTag && line.includes(endTag))
    const opensMultiLineBlock = hasStartTag && !hasEndTag
    const closesMultiLineBlock = hasEndTag && insideNoTranslateBlock

    if (insideNoTranslateBlock && !hasEndTag) {
      return {
        preparedLine: line,
        shouldTranslate: false,
        outputLine: line,
      }
    }

    if (opensMultiLineBlock) {
      insideNoTranslateBlock = true
      return {
        preparedLine: line,
        shouldTranslate: false,
        outputLine: line,
      }
    }

    if (closesMultiLineBlock) {
      insideNoTranslateBlock = false
      return {
        preparedLine: line,
        shouldTranslate: false,
        outputLine: line,
      }
    }

    let preparedLine = line
    if (startTag && hasStartTag) {
      preparedLine = replaceAll(preparedLine, startTag, '<keep>')
    }
    if (endTag && hasEndTag) {
      preparedLine = replaceAll(preparedLine, endTag, '</keep>')
    }

    if (hasEndTag) {
      insideNoTranslateBlock = false
    }

    return {
      preparedLine,
      shouldTranslate: true,
      outputLine: line,
    }
  })
}

function createTranslatorOptions(timeoutValue: string | undefined): { minTimeout?: number } | undefined {
  if (!timeoutValue) {
    return undefined
  }

  const parsedTimeoutValue = parseInt(timeoutValue, 10)
  const isValidTimeout = !isNaN(parsedTimeoutValue) && parsedTimeoutValue > 0

  if (isValidTimeout) {
    return { minTimeout: parsedTimeoutValue }
  }

  console.warn(
    `Invalid timeout value: ${timeoutValue}. Expected a positive number in milliseconds. Ignoring timeout parameter.`
  )
  return undefined
}

export {
  replaceAll,
  removeKeepTagsFromString,
  replaceParameterStringsInJSONValueWithKeepTags,
  groupItemsByLang,
  translateTexts,
  translateStrings,
  buildOutputFileName,
  buildOutputJson,
  TranslatedJSONResults,
  collectAllStringsFromJson,
  collectStringMapFromJson,
  deleteNestedValue,
  parseJsonString,
  setNestedValue,
  CollectedStrings,
  createTranslatorOptions,
  diffLines,
  getTextLineMetadata,
  parseTextDocument,
  stringifyTextDocument,
}
