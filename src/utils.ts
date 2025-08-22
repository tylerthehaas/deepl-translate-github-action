import type { TargetLanguageCode, Translator, TextResult } from "deepl-node";

function replaceAll(str: string, search: string, replacement: string): string {
	let index = str.indexOf(search);
	while (index != -1) {
		str = str.replace(search, replacement);
		index = str.indexOf(search);
	}
	return str;
}

function replaceParameterStringsInJSONValueWithKeepTags(value: string): string {
	const termRegex = /({{.*?}}|{.*?})/g;
	return value.replace(termRegex, (match) => `<keep>${match}</keep>`);
}

function removeKeepTagsFromString(str: string): string {
	if (!str.includes("<keep>")) return str;

	const textWithNoTranslateStartTagReplaced = replaceAll(str, "<keep>", "");
	const textWithNoTranslateEndTagReplaced = replaceAll(
		textWithNoTranslateStartTagReplaced,
		"</keep>",
		"",
	);
	return textWithNoTranslateEndTagReplaced;
}

type PossibleRecursive<T> = {
	[K in keyof T]: T[K] extends object ? PossibleRecursive<T[K]> : T[K];
};

type TranslatedJSONResults = Record<
	TargetLanguageCode,
	PossibleRecursive<Record<string, string>>
>;

interface CollectedStrings {
  keys: string[]
  values: string[]
}

/**
 * Collects all string values from a JSON object along with their dot-notation keys
 * Literal dots in key names are escaped with backslashes to distinguish from nested notation
 * @param json - The JSON object to extract strings from
 * @param prefix - Internal parameter for building dot notation (don't pass this)
 * @returns Object with keys and values arrays where indexes correspond
 * @example
 * // Input: { "user.name": "John", user: { age: "30" } }
 * // Output: { keys: ["user\\.name", "user.age"], values: ["John", "30"] }
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

    if (!obj.hasOwnProperty(key)) continue

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

export const applyRecursive = async (
  inputJson: Record<string, any>,
  path: string[] = [],
  operation: Function,
  operationArgs: any[],
) => {
  const keys = Object.keys(inputJson)

  for (const key of keys) {
    const newPath = [...path, key]

    if (typeof inputJson[key] === 'object') {
      await applyRecursive(inputJson[key], newPath, operation, operationArgs)
    } else {
      await operation(inputJson[key], newPath, ...operationArgs)
    }
  }
}

const translateRecursive = async (
  inputJson: Record<string, any>,
  targetLanguages: TargetLanguageCode[],
  translator: Translator,
  translatedResults: TranslatedJSONResults,
) => {
  const translate = async (
    value: string,
    path: string[],
    targetLanguages: TargetLanguageCode[],
    translator: Translator,
    translatedResults: TranslatedJSONResults,
  ) => {
    const textToBeTranslated = replaceParameterStringsInJSONValueWithKeepTags(value)

    for (const targetLanguage of targetLanguages) {
      const textResult = (await translator.translateText(textToBeTranslated, null, targetLanguage, {
        preserveFormatting: true,
        tagHandling: 'xml',
        ignoreTags: ['keep'],
      })) as TextResult

      if (!translatedResults[targetLanguage]) {
        translatedResults[targetLanguage] = {}
      }

      const translatedText = textResult.text
      const resultText = removeKeepTagsFromString(translatedText)

      // Assign the translated text to its original position in object
      let currentKey: Record<string, any> = translatedResults[targetLanguage]
      for (let i = 0; i < path.length; i++) {
        if (i === path.length - 1) {
          currentKey[path[i]] = resultText
        } else {
          if (!currentKey[path[i]]) {
            currentKey[path[i]] = {}
          }
          currentKey = currentKey[path[i]]
        }
      }
    }
  }

  await applyRecursive(inputJson, [], translate, [targetLanguages, translator, translatedResults])

  return translatedResults
}

function buildOutputFileName(targetLang: string, outputFileNamePattern: string) {
  return outputFileNamePattern.replace(/\{language\}/g, targetLang)
}

export {
  replaceAll,
  removeKeepTagsFromString,
  replaceParameterStringsInJSONValueWithKeepTags,
  translateRecursive,
  buildOutputFileName,
  TranslatedJSONResults,
  collectAllStringsFromJson,
  CollectedStrings,
}
