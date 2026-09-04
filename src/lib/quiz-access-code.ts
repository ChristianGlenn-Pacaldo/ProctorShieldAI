export const QUIZ_ACCESS_CODE_INPUT_MAX_LENGTH = 64;

export function normalizeQuizAccessCode(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/\s+/g, "")
    .toUpperCase();
}
