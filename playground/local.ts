import * as deepl from "deepl-node";
import path from "path";
import { main } from "../src/main";

const authKey = process.env.deepl_api_key as string;
const translator = new deepl.Translator(authKey);
const playgroundPath = "playground"
const inputFilePath = path.join(playgroundPath, "nested.json");
const outputFileNamePattern = path.join(playgroundPath, "locales/{language}/nested.json");
const startTagForNoTranslate = "<!-- keep -->";
const endTagForNoTranslate = "<!-- /keep -->";

const tempFilePath = path.join(playgroundPath, "to_translate.txt");
const fileExtensionsThatAllowForIgnoringBlocks = [".html", ".xml", ".md", ".txt"];

// All supported DeepL target languages as of April 2025
const targetLanguages: deepl.TargetLanguageCode[] = [
  "ar",   // Arabic
  "bg",   // Bulgarian
  "cs",   // Czech
  "da",   // Danish
  "de",   // German
  "el",   // Greek
  "en-GB", // English (British)
  "en-US", // English (American)
  "es",   // Spanish
  "et",   // Estonian
  "fi",   // Finnish
  "fr",   // French
  "hu",   // Hungarian
  "id",   // Indonesian
  "it",   // Italian
  "ja",   // Japanese
  "ko",   // Korean
  "lt",   // Lithuanian
  "lv",   // Latvian
  "nb",   // Norwegian Bokmål
  "nl",   // Dutch
  "pl",   // Polish
  "pt-BR", // Portuguese (Brazilian)
  "pt-PT", // Portuguese (all Portuguese variants excluding Brazilian Portuguese)
  "ro",   // Romanian
  "ru",   // Russian
  "sk",   // Slovak
  "sl",   // Slovenian
  "sv",   // Swedish
  "tr",   // Turkish
  "uk",   // Ukrainian
  "zh"    // Chinese (unspecified variant for backward compatibility)
];

(async () => {
	await main({
		translator,
		inputFilePath,
		outputFileNamePattern,
		startTagForNoTranslate,
		endTagForNoTranslate,
		tempFilePath,
		fileExtensionsThatAllowForIgnoringBlocks,
		targetLanguages,
	});
})();
