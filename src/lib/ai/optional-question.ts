/**
 * Shared trust boundary for the optional Plain English question.
 *
 * JavaScript string length is measured in UTF-16 code units, which is the
 * explicit product limit for this field. The normalized question is never a
 * tool-selection or validation input; it is untrusted context for the
 * evidence explanation only.
 */

export const MAX_OPTIONAL_QUESTION_UTF16_UNITS = 800;

const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/u;

export function normalizeOptionalQuestion(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error("invalid_optional_question");

  const normalized = value.trim();
  if (normalized.length > MAX_OPTIONAL_QUESTION_UTF16_UNITS) {
    throw new Error("optional_question_too_long");
  }
  if (CONTROL_CHARACTER.test(normalized)) {
    throw new Error("optional_question_control_character");
  }

  return normalized.length === 0 ? undefined : normalized;
}
