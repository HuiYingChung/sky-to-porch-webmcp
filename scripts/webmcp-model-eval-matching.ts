export function exactEvalValueMatch(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    return Array.isArray(actual) &&
      actual.length === expected.length &&
      expected.every((item, index) => exactEvalValueMatch(actual[index], item));
  }

  if (typeof expected === "object" && expected !== null) {
    if (typeof actual !== "object" || actual === null || Array.isArray(actual)) return false;

    const actualRecord = actual as Record<string, unknown>;
    const expectedRecord = expected as Record<string, unknown>;
    const expectedKeys = Object.keys(expectedRecord);
    if (Object.keys(actualRecord).length !== expectedKeys.length) return false;

    return expectedKeys.every((key) =>
      Object.prototype.hasOwnProperty.call(actualRecord, key) &&
      exactEvalValueMatch(actualRecord[key], expectedRecord[key])
    );
  }

  return Object.is(actual, expected);
}

interface EvalCallLike {
  functionName: string;
  arguments: Record<string, unknown>;
}

export function exactEvalCallMatch(actual: EvalCallLike, expected: EvalCallLike): boolean {
  return actual.functionName === expected.functionName &&
    exactEvalValueMatch(actual.arguments, expected.arguments);
}
