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

function translateStrings(
  sourceStrings: string[],
  targetLanguage: TargetLanguageCode,
  translator: Translator,
): Promise<TextResult[]>[] {
  const textsToBeTranslated = sourceStrings.map(replaceParameterStringsInJSONValueWithKeepTags)
  const maxRequestSizeBytes = 128 * 1024 // 128 KiB total request limit
  const estimatedOverheadBytes = 2048 // Estimate ~2KB for headers, JSON structure, etc.
  const maxTextSizeBytes = maxRequestSizeBytes - estimatedOverheadBytes
  const promises: Promise<TextResult[]>[] = []

  let currentBatch: string[] = []
  let currentBatchSize = 0

  for (const text of textsToBeTranslated) {
    const textSizeBytes = new TextEncoder().encode(text).length

    if (currentBatchSize + textSizeBytes > maxTextSizeBytes) {
      if (currentBatch.length > 0) {
        const promise = translator.translateText(currentBatch, null, targetLanguage, {
          preserveFormatting: true,
          tagHandling: 'xml',
          ignoreTags: ['keep'],
        }) as Promise<TextResult[]>
        promises.push(promise)
      }

      currentBatch = [text]
      currentBatchSize = textSizeBytes
    } else {
      currentBatch.push(text)
      currentBatchSize += textSizeBytes
    }
  }

  // Don't forget the last batch
  if (currentBatch.length > 0) {
    const promise = translator.translateText(currentBatch, null, targetLanguage, {
      preserveFormatting: true,
      tagHandling: 'xml',
      ignoreTags: ['keep'],
    }) as Promise<TextResult[]>
    promises.push(promise)
  }

  return promises
}

function buildOutputFileName(targetLang: string, outputFileNamePattern: string) {
  return outputFileNamePattern.replace(/\{language\}/g, targetLang)
}

/**
 * Reconstructs a JSON object from translated texts and dot-notation keys
 * Handles both nested object notation (e.g., 'foo.bar') and literal dots in keys (e.g., 'user\\.name')
 * @param translatedTexts - Array of translated string values
 * @param jsonKeys - Array of dot-notation keys (same length as translatedTexts)
 * @returns Reconstructed JSON object
 * @example
 * // Input: translatedTexts: ['Hello', 'World'], jsonKeys: ['greeting', 'user.name']
 * // Output: { greeting: 'Hello', user: { name: 'World' } }
 * // Input: translatedTexts: ['John'], jsonKeys: ['user\\.name']
 * // Output: { 'user.name': 'John' }
 */
function buildOutputJson(translatedTexts: string[], jsonKeys: string[]): Record<string, any> {
  const result: Record<string, any> = {}

  for (let i = 0; i < jsonKeys.length; i++) {
    const key = jsonKeys[i]
    const value = translatedTexts[i]

    // Split the key by dots, but handle escaped dots
    // We need to split by dots that are NOT preceded by a backslash
    const keyParts = key.split(/(?<!\\)\./)

    let currentLevel = result
    for (let j = 0; j < keyParts.length; j++) {
      const part = keyParts[j]
      const isLastPart = j === keyParts.length - 1

      if (isLastPart) {
        // This is the final part, assign the value
        // Unescape any literal dots in the final key
        const finalKey = part.replace(/\\./g, '.')
        currentLevel[finalKey] = value
      } else {
        // This is a nested level, create object if it doesn't exist
        // Unescape any literal dots in the intermediate key
        const unescapedPart = part.replace(/\\./g, '.')
        if (!currentLevel[unescapedPart]) {
          currentLevel[unescapedPart] = {}
        }
        currentLevel = currentLevel[unescapedPart]
      }
    }
  }

  return result
}

export {
  replaceAll,
  removeKeepTagsFromString,
  replaceParameterStringsInJSONValueWithKeepTags,
  translateStrings,
  buildOutputFileName,
  buildOutputJson,
  TranslatedJSONResults,
  collectAllStringsFromJson,
  CollectedStrings,
}
