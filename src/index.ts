import type { TargetLanguageCode } from "deepl-node";
import { Translator } from 'deepl-node';
import path from "path";
import { main, type ModelType } from "./main";
import { createTranslatorOptions } from "./utils";

const authKey = process.env.deepl_api_key as string;
const translatorOptions = createTranslatorOptions(process.env.timeout);

const translator = new Translator(authKey, translatorOptions);
const inputFilePath = path.join(
	process.env.GITHUB_WORKSPACE as string,
	process.env.input_file_path as string,
);
const outputFileNamePattern = path.join(
	process.env.GITHUB_WORKSPACE as string,
	process.env.output_file_name_pattern as string,
)
const startTagForNoTranslate = process.env.no_translate_start_tag as string;
const endTagForNoTranslate = process.env.no_translate_end_tag as string;

const tempFilePath = path.join(
	process.env.GITHUB_WORKSPACE as string,
	"to_translate.txt",
);
const fileExtensionsThatAllowForIgnoringBlocks = [".html", ".xml", ".md", ".txt"];

(async () => {
	let targetLanguages =
		process.env.target_languages === "all"
			? (await translator.getTargetLanguages()).map((lang) => lang.code) as TargetLanguageCode[]
				: process.env.target_languages !== undefined
					? (process.env.target_languages?.split(",") as TargetLanguageCode[])
					: [];

	const excludedLanguages = process.env.excluded_languages?.split(",") as TargetLanguageCode[] || [];
	
	targetLanguages = targetLanguages.filter(lang => !excludedLanguages.includes(lang));

	const modelTypeEnv = process.env.model_type;
	let modelType: ModelType | undefined;
	if (modelTypeEnv) {
		const validModelTypes: ModelType[] = ['quality_optimized', 'prefer_quality_optimized', 'latency_optimized'];
		if (validModelTypes.includes(modelTypeEnv as ModelType)) {
			modelType = modelTypeEnv as ModelType;
		} else {
			console.warn(`Invalid model_type value: ${modelTypeEnv}. Valid values are: ${validModelTypes.join(', ')}. Ignoring model_type parameter.`);
		}
	}

	await main({
		translator,
		inputFilePath,
		outputFileNamePattern,
		startTagForNoTranslate,
		endTagForNoTranslate,
		tempFilePath,
		fileExtensionsThatAllowForIgnoringBlocks,
		targetLanguages,
		modelType,
	});
})();
