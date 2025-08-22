import type { TargetLanguageCode, TextResult, Translator } from 'deepl-node'
import fs from 'fs'
import path from 'path'
import {
  buildOutputFileName,
  collectAllStringsFromJson,
  removeKeepTagsFromString,
  replaceAll,
  translateStrings,
} from './utils'

interface HTMLlikeParams {
  startTagForNoTranslate?: string
  endTagForNoTranslate?: string
}

export interface MainFunctionParams extends HTMLlikeParams {
  translator: Translator
  inputFilePath: string
  outputFileNamePattern: string
  tempFilePath: string
  fileExtensionsThatAllowForIgnoringBlocks: string[]
  targetLanguages: TargetLanguageCode[]
}

export async function main(params: MainFunctionParams) {
  const {
    translator,
    inputFilePath,
    outputFileNamePattern,
    startTagForNoTranslate,
    endTagForNoTranslate,
    tempFilePath,
    fileExtensionsThatAllowForIgnoringBlocks,
    targetLanguages,
  } = params
  const fileExtension = path.extname(inputFilePath)
  const isFileHtmlLike = fileExtensionsThatAllowForIgnoringBlocks.includes(fileExtension)

  if (isFileHtmlLike) {
    const inputText = fs.readFileSync(inputFilePath, 'utf8')
    let textWithNoTranslateTagsReplaced = inputText
    if (startTagForNoTranslate && endTagForNoTranslate) {
      const textWithNoTranslateStartTagReplaced = replaceAll(inputText, startTagForNoTranslate, '<keep>')
      const textWithNoTranslateEndTagReplaced = replaceAll(
        textWithNoTranslateStartTagReplaced,
        endTagForNoTranslate,
        '</keep>',
      )

      textWithNoTranslateTagsReplaced = textWithNoTranslateEndTagReplaced
    }

    let textToBeWrittenToTempFile = textWithNoTranslateTagsReplaced

    console.debug('textToBeWrittenToTempFile: ', textToBeWrittenToTempFile)

    fs.writeFileSync(tempFilePath, textToBeWrittenToTempFile)

    const tempFileExists = fs.existsSync(tempFilePath)
    console.debug('tempFileExists: ', tempFileExists)
    const translateFilePath = tempFileExists ? tempFilePath : inputFilePath

    try {
      const text = await fs.promises.readFile(translateFilePath, 'utf8')

      console.info(`Translating the input file into ${targetLanguages.length} languages...`)

      // Process all target languages in parallel
      const translatePromises = targetLanguages.map(async (targetLang: TargetLanguageCode) => {
        const textResult = await translator.translateText(text, null, targetLang, {
          preserveFormatting: true,
          tagHandling: 'xml',
          ignoreTags: ['keep'],
        })

        const translatedText = textResult.text

        if (translatedText === undefined) {
          console.error(`got undefined translatedText, skipping for ${targetLang}`)
          return
        }

        const resultText = removeKeepTagsFromString(translatedText)
        const outputFileName = buildOutputFileName(targetLang, outputFileNamePattern)
        const outputFolderPath = path.dirname(outputFileName)

        // Ensure output directory exists
        if (!fs.existsSync(outputFolderPath)) {
          await fs.promises.mkdir(outputFolderPath, { recursive: true })
        }

        // Write the translated file
        await fs.promises.writeFile(outputFileName, resultText)
        console.info(`Translated ${targetLang}`)
      })

      // Wait for all translations to complete
      await Promise.all(translatePromises)
    } catch (err) {
      console.info('Error reading file', err)
    }
  } else if (fileExtension === '.json') {
    const jsonString = await fs.promises.readFile(inputFilePath, 'utf8').catch((err) => {
      console.info('Error reading file', err)
      return ''
    })

    let inputJson = null
    try {
      inputJson = JSON.parse(jsonString)
    } catch (parseError) {
      console.info('Error parsing JSON string', parseError)
    }

    if (inputJson === null) {
      return
    }

    const { keys: jsonKeys, values: inputJsonStrings } = collectAllStringsFromJson(inputJson)

    const translatePromises = targetLanguages.map(
      (targetLang: TargetLanguageCode): Promise<TextResult[]> =>
        translateStrings(inputJsonStrings, targetLang, translator),
    )

    const translatedResults = await Promise.all(translatePromises)

    // Process all target languages in parallel
    // const writePromises = targetLanguages.map(async (targetLang: TargetLanguageCode) => {
    //   const outputFileName = buildOutputFileName(targetLang, outputFileNamePattern)
    //   const resultJson = JSON.stringify(translatedResults[targetLang])
    //   const outputFolderPath = path.dirname(outputFileName)

    //   // Ensure output directory exists
    //   if (!fs.existsSync(outputFolderPath)) {
    //     await fs.promises.mkdir(outputFolderPath, { recursive: true })
    //   }

    //   // Write the translated file
    //   await fs.promises.writeFile(outputFileName, resultJson)
    //   console.info(`Translated ${targetLang}`)
    // })

    // Wait for all files to be written
    // await Promise.all(writePromises)
  }
}
