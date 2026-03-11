import type { TargetLanguageCode, Translator } from 'deepl-node'
import fs from 'fs'
import path from 'path'
import {
  buildOutputFileName,
  buildOutputJson,
  collectAllStringsFromJson,
  collectStringMapFromJson,
  deleteNestedValue,
  diffLines,
  getTextLineMetadata,
  parseJsonString,
  parseTextDocument,
  removeKeepTagsFromString,
  replaceParameterStringsInJSONValueWithKeepTags,
  replaceAll,
  setNestedValue,
  stringifyTextDocument,
  translateTexts,
} from './utils'

interface HTMLlikeParams {
  startTagForNoTranslate?: string
  endTagForNoTranslate?: string
}

export type ModelType = 'quality_optimized' | 'prefer_quality_optimized' | 'latency_optimized'

export interface MainFunctionParams extends HTMLlikeParams {
  translator: Translator
  workspacePath?: string
  inputFileRelativePath?: string
  inputFilePath: string
  outputFileNamePattern: string
  tempFilePath: string
  fileExtensionsThatAllowForIgnoringBlocks: string[]
  targetLanguages: TargetLanguageCode[]
  modelType?: ModelType
  baseFileContent?: string | null
}

async function ensureOutputDirectoryExists(outputFileName: string) {
  const outputFolderPath = path.dirname(outputFileName)

  if (!fs.existsSync(outputFolderPath)) {
    await fs.promises.mkdir(outputFolderPath, { recursive: true })
  }
}

function prepareFullTextForTranslation(
  inputText: string,
  startTagForNoTranslate?: string,
  endTagForNoTranslate?: string,
) {
  if (!startTagForNoTranslate || !endTagForNoTranslate) {
    return inputText
  }

  const textWithNoTranslateStartTagReplaced = replaceAll(inputText, startTagForNoTranslate, '<keep>')
  return replaceAll(textWithNoTranslateStartTagReplaced, endTagForNoTranslate, '</keep>')
}

async function translateWholeTextFile(
  inputText: string,
  targetLang: TargetLanguageCode,
  translator: Translator,
  modelType: ModelType | undefined,
  startTagForNoTranslate?: string,
  endTagForNoTranslate?: string,
) {
  const preparedText = prepareFullTextForTranslation(
    inputText,
    startTagForNoTranslate,
    endTagForNoTranslate,
  )
  const [translatedText = ''] = await translateTexts([preparedText], targetLang, translator, {
    modelType,
    postprocess: removeKeepTagsFromString,
  })

  return translatedText
}

async function buildIncrementalTextOutput(
  currentText: string,
  baseFileContent: string,
  targetFileContent: string,
  targetLang: TargetLanguageCode,
  translator: Translator,
  modelType: ModelType | undefined,
  startTagForNoTranslate?: string,
  endTagForNoTranslate?: string,
) {
  const currentDocument = parseTextDocument(currentText)
  const baseDocument = parseTextDocument(baseFileContent)
  const targetDocument = parseTextDocument(targetFileContent)

  if (targetDocument.lines.length !== baseDocument.lines.length) {
    return translateWholeTextFile(
      currentText,
      targetLang,
      translator,
      modelType,
      startTagForNoTranslate,
      endTagForNoTranslate,
    )
  }

  const operations = diffLines(baseDocument.lines, currentDocument.lines)
  const lineMetadata = getTextLineMetadata(
    currentDocument.lines,
    startTagForNoTranslate,
    endTagForNoTranslate,
  )
  const linesToTranslate: string[] = []
  let currentLineIndex = 0

  for (const operation of operations) {
    if (operation.type === 'equal') {
      currentLineIndex += operation.lines.length
      continue
    }

    if (operation.type === 'insert') {
      for (let lineOffset = 0; lineOffset < operation.lines.length; lineOffset++) {
        const metadata = lineMetadata[currentLineIndex + lineOffset]
        if (metadata.shouldTranslate) {
          linesToTranslate.push(metadata.preparedLine)
        }
      }

      currentLineIndex += operation.lines.length
    }
  }

  const translatedLines = await translateTexts(linesToTranslate, targetLang, translator, {
    modelType,
    postprocess: removeKeepTagsFromString,
  })

  const resultLines: string[] = []
  let translatedLineIndex = 0
  let targetLineIndex = 0
  currentLineIndex = 0

  for (const operation of operations) {
    if (operation.type === 'equal') {
      resultLines.push(...targetDocument.lines.slice(targetLineIndex, targetLineIndex + operation.lines.length))
      targetLineIndex += operation.lines.length
      currentLineIndex += operation.lines.length
      continue
    }

    if (operation.type === 'delete') {
      targetLineIndex += operation.lines.length
      continue
    }

    for (let lineOffset = 0; lineOffset < operation.lines.length; lineOffset++) {
      const metadata = lineMetadata[currentLineIndex + lineOffset]
      if (metadata.shouldTranslate) {
        resultLines.push(translatedLines[translatedLineIndex] ?? metadata.outputLine)
        translatedLineIndex++
      } else {
        resultLines.push(metadata.outputLine)
      }
    }

    currentLineIndex += operation.lines.length
  }

  return stringifyTextDocument({
    lines: resultLines,
    eol: currentDocument.eol,
    endsWithNewline: currentDocument.endsWithNewline,
  })
}

async function buildJsonOutput(
  inputJson: Record<string, any>,
  baseJson: Record<string, any> | null,
  outputFileName: string,
  targetLang: TargetLanguageCode,
  translator: Translator,
  modelType: ModelType | undefined,
) {
  const { keys: currentKeys, values: currentValues } = collectAllStringsFromJson(inputJson)
  const currentValueMap = collectStringMapFromJson(inputJson)
  const targetFileExists = fs.existsSync(outputFileName)

  const requiresFullTranslation = !baseJson || !targetFileExists
  if (requiresFullTranslation) {
    const translatedValues = await translateTexts(currentValues, targetLang, translator, {
      modelType,
      preprocess: (value) => replaceParameterStringsInJSONValueWithKeepTags(value),
      postprocess: removeKeepTagsFromString,
    })

    return JSON.stringify(buildOutputJson(translatedValues, currentKeys), null, 2)
  }

  const targetJsonString = await fs.promises.readFile(outputFileName, 'utf8').catch(() => '')
  const targetJson = parseJsonString<Record<string, any>>(targetJsonString)

  if (targetJson === null) {
    const translatedValues = await translateTexts(currentValues, targetLang, translator, {
      modelType,
      preprocess: (value) => replaceParameterStringsInJSONValueWithKeepTags(value),
      postprocess: removeKeepTagsFromString,
    })

    return JSON.stringify(buildOutputJson(translatedValues, currentKeys), null, 2)
  }

  const baseValueMap = collectStringMapFromJson(baseJson)
  const keysToTranslate = currentKeys.filter((key) => currentValueMap.get(key) !== baseValueMap.get(key))
  const keysToDelete = [...baseValueMap.keys()].filter((key) => !currentValueMap.has(key))

  if (keysToTranslate.length === 0 && keysToDelete.length === 0) {
    return targetJsonString
  }

  for (const key of keysToDelete) {
    deleteNestedValue(targetJson, key)
  }

  const translatedValues = await translateTexts(
    keysToTranslate.map((key) => currentValueMap.get(key) ?? ''),
    targetLang,
    translator,
    {
      modelType,
      preprocess: (value) => replaceParameterStringsInJSONValueWithKeepTags(value),
      postprocess: removeKeepTagsFromString,
    },
  )

  keysToTranslate.forEach((key, index) => {
    setNestedValue(targetJson, key, translatedValues[index] ?? currentValueMap.get(key) ?? '')
  })

  return JSON.stringify(targetJson, null, 2)
}

export async function main(params: MainFunctionParams) {
  const {
    translator,
    workspacePath: _workspacePath,
    inputFileRelativePath: _inputFileRelativePath,
    inputFilePath,
    outputFileNamePattern,
    startTagForNoTranslate,
    endTagForNoTranslate,
    tempFilePath,
    fileExtensionsThatAllowForIgnoringBlocks,
    targetLanguages,
    modelType,
    baseFileContent,
  } = params
  const fileExtension = path.extname(inputFilePath)
  const isFileHtmlLike = fileExtensionsThatAllowForIgnoringBlocks.includes(fileExtension)

  if (isFileHtmlLike) {
    const inputText = await fs.promises.readFile(inputFilePath, 'utf8').catch((err) => {
      console.info('Error reading file', err)
      return ''
    })

    const preparedText = prepareFullTextForTranslation(
      inputText,
      startTagForNoTranslate,
      endTagForNoTranslate,
    )
    fs.writeFileSync(tempFilePath, preparedText)

    const writePromises = targetLanguages.map(async (targetLang: TargetLanguageCode) => {
      const outputFileName = buildOutputFileName(targetLang, outputFileNamePattern)
      await ensureOutputDirectoryExists(outputFileName)

      const outputText =
        baseFileContent && fs.existsSync(outputFileName)
          ? await buildIncrementalTextOutput(
              inputText,
              baseFileContent,
              await fs.promises.readFile(outputFileName, 'utf8'),
              targetLang,
              translator,
              modelType,
              startTagForNoTranslate,
              endTagForNoTranslate,
            )
          : await translateWholeTextFile(
              inputText,
              targetLang,
              translator,
              modelType,
              startTagForNoTranslate,
              endTagForNoTranslate,
            )

      await fs.promises.writeFile(outputFileName, outputText)
      console.info(`Translated ${targetLang}`)
    })

    await Promise.all(writePromises)
  } else if (fileExtension === '.json') {
    const jsonString = await fs.promises.readFile(inputFilePath, 'utf8').catch((err) => {
      console.info('Error reading file', err)
      return ''
    })

    const inputJson = parseJsonString<Record<string, any>>(jsonString)
    const baseJson = baseFileContent ? parseJsonString<Record<string, any>>(baseFileContent) : null

    if (inputJson === null) {
      return
    }

    const writePromises = targetLanguages.map(async (targetLang: TargetLanguageCode) => {
      const outputFileName = buildOutputFileName(targetLang, outputFileNamePattern)
      await ensureOutputDirectoryExists(outputFileName)

      const resultJsonString = await buildJsonOutput(
        inputJson,
        baseJson,
        outputFileName,
        targetLang,
        translator,
        modelType,
      )

      await fs.promises.writeFile(outputFileName, resultJsonString)
      console.info(`Translated ${targetLang}`)
    })

    await Promise.all(writePromises)
  }
}
