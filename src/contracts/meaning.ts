import {
  isVerificationSourceId,
  type VerificationSourceId,
} from "@/contracts/verification-source";

export const ANSWER_MODES = [
  "direct_question",
  "concern_explanation",
  "deterministic_fallback",
] as const;
export type AnswerMode = (typeof ANSWER_MODES)[number];

export const MEANING_SECTION_KINDS = [
  "observed",
  "inferred",
  "rationale",
  "limitation",
  "next_step",
] as const;
export type MeaningSectionKind = (typeof MEANING_SECTION_KINDS)[number];

export interface MeaningSection {
  kind: MeaningSectionKind;
  heading: string;
  body: string;
}
export interface AdaptiveMeaning {
  answerMode: AnswerMode;
  directAnswer: string;
  sections: MeaningSection[];
  verificationSourceIds: VerificationSourceId[];
}

const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/u;
const URL_TEXT = /(?:https?:\/\/|www\.)/iu;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Meaning validation failed: ${message}`);
}

function boundedText(value: unknown, field: string, max: number): string {
  assert(typeof value === "string", `${field} must be a string`);
  const text = value.trim();
  assert(text.length > 0 && text.length <= max, `${field} must be 1-${max} characters`);
  assert(!CONTROL_CHARACTER.test(text), `${field} contains a control character`);
  assert(!URL_TEXT.test(text), `${field} must use verification source IDs instead of URLs`);
  return text;
}

export function validateAdaptiveMeaning(value: unknown): asserts value is AdaptiveMeaning {
  assert(typeof value === "object" && value !== null && !Array.isArray(value), "meaning must be an object");
  const object = value as Record<string, unknown>;
  const actualKeys = Object.keys(object).sort();
  const expectedKeys = ["answerMode", "directAnswer", "sections", "verificationSourceIds"].sort();
  assert(
    actualKeys.length === expectedKeys.length &&
      actualKeys.every((key, index) => key === expectedKeys[index]),
    "meaning has unknown or missing fields"
  );
  assert(
    typeof object.answerMode === "string" &&
      (ANSWER_MODES as readonly string[]).includes(object.answerMode),
    "answerMode is invalid"
  );
  boundedText(object.directAnswer, "directAnswer", 700);
  assert(Array.isArray(object.sections), "sections must be an array");
  assert(object.sections.length >= 1 && object.sections.length <= 5, "sections must contain 1-5 items");
  for (const [index, section] of object.sections.entries()) {
    assert(typeof section === "object" && section !== null && !Array.isArray(section), `sections[${index}] must be an object`);
    const sectionObject = section as Record<string, unknown>;
    const sectionKeys = Object.keys(sectionObject).sort();
    assert(
      sectionKeys.length === 3 && sectionKeys.join("|") === "body|heading|kind",
      `sections[${index}] has unknown or missing fields`
    );
    assert(
      typeof sectionObject.kind === "string" &&
        (MEANING_SECTION_KINDS as readonly string[]).includes(sectionObject.kind),
      `sections[${index}].kind is invalid`
    );
    boundedText(sectionObject.heading, `sections[${index}].heading`, 80);
    boundedText(sectionObject.body, `sections[${index}].body`, 700);
  }
  assert(Array.isArray(object.verificationSourceIds), "verificationSourceIds must be an array");
  assert(object.verificationSourceIds.length <= 3, "verificationSourceIds must contain at most 3 items");
  assert(
    object.verificationSourceIds.every(isVerificationSourceId),
    "verificationSourceIds contains an unregistered source"
  );
  assert(
    new Set(object.verificationSourceIds).size === object.verificationSourceIds.length,
    "verificationSourceIds must be unique"
  );
}
