export const PARAPHRASE_UTTERANCE_STYLES = [
  "question",
  "imperative",
  "conversational",
] as const;

export type ParaphraseUtteranceStyle = typeof PARAPHRASE_UTTERANCE_STYLES[number];

export interface ParaphraseEvalCall {
  functionName: string;
  arguments: Record<string, unknown>;
}

export interface ParaphraseEvalCase {
  id: string;
  paraphraseFamily?: string;
  utteranceStyle?: ParaphraseUtteranceStyle;
  expectedCall: ParaphraseEvalCall[];
}

export interface ParaphraseRunOutcome {
  case_id: string;
  run: number;
  exact_match: boolean;
}

export interface ParaphraseCaseRuns {
  case_id: string;
  utterance_style: ParaphraseUtteranceStyle;
  runs: number[];
}

export interface ParaphraseFamilySummary {
  family: string;
  expected_tool: string;
  match_basis: "exact_call";
  expected_cases: Array<{
    case_id: string;
    utterance_style: ParaphraseUtteranceStyle;
  }>;
  expected_case_count: number;
  expected_styles: ParaphraseUtteranceStyle[];
  expected_runs: number;
  executed_runs: number;
  passes: number;
  total: number;
  complete: boolean;
  all_passed: boolean;
  failed_cases: ParaphraseCaseRuns[];
  missing_cases: ParaphraseCaseRuns[];
}

export interface ParaphraseSummary {
  match_basis: "exact_call";
  expected_cases: number;
  expected_runs: number;
  executed_runs: number;
  passes: number;
  total: number;
  complete: boolean;
  all_passed: boolean;
  failed_cases: Array<ParaphraseCaseRuns & { family: string }>;
  missing_cases: Array<ParaphraseCaseRuns & { family: string }>;
  families: ParaphraseFamilySummary[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function caseLabel(item: Record<string, unknown>, index: number): string {
  return typeof item.id === "string" && item.id.trim().length > 0
    ? item.id
    : `dataset item ${index}`;
}

export function assertValidParaphraseMetadata(
  value: unknown
): asserts value is ParaphraseEvalCase[] {
  if (!Array.isArray(value)) {
    throw new Error("WebMCP selection dataset must be an array");
  }

  const stylesByFamily = new Map<string, Set<ParaphraseUtteranceStyle>>();
  const toolsByFamily = new Map<string, Set<string>>();
  for (const [index, candidate] of value.entries()) {
    if (!isRecord(candidate)) {
      throw new Error(`WebMCP selection dataset item ${index} must be an object`);
    }
    const label = caseLabel(candidate, index);
    if (typeof candidate.id !== "string" || candidate.id.trim().length === 0) {
      throw new Error(`${label} must have a non-empty string id`);
    }
    if (!Array.isArray(candidate.expectedCall)) {
      throw new Error(`${label} must have an expectedCall array`);
    }
    for (const call of candidate.expectedCall) {
      if (
        !isRecord(call) ||
        typeof call.functionName !== "string" ||
        call.functionName.trim().length === 0 ||
        !isRecord(call.arguments)
      ) {
        throw new Error(`${label} has an invalid expected tool call`);
      }
    }

    const family = candidate.paraphraseFamily;
    const style = candidate.utteranceStyle;
    const hasFamily = family !== undefined;
    const hasStyle = style !== undefined;
    if (hasFamily !== hasStyle) {
      throw new Error(
        `${label} must provide paraphraseFamily and utteranceStyle together`
      );
    }
    if (!hasFamily) continue;
    if (typeof family !== "string" || family.trim().length === 0 || family !== family.trim()) {
      throw new Error(`${label} paraphraseFamily must be a non-empty trimmed string`);
    }
    if (!PARAPHRASE_UTTERANCE_STYLES.includes(style as ParaphraseUtteranceStyle)) {
      throw new Error(`${label} has invalid utteranceStyle: ${String(style)}`);
    }
    if (candidate.expectedCall.length !== 1) {
      throw new Error(`${label} paraphrase cases must expect exactly one tool call`);
    }
    const typedStyle = style as ParaphraseUtteranceStyle;
    stylesByFamily.set(family, new Set([
      ...(stylesByFamily.get(family) ?? []),
      typedStyle,
    ]));
    const expectedTool = (candidate.expectedCall[0] as Record<string, unknown>).functionName;
    toolsByFamily.set(family, new Set([
      ...(toolsByFamily.get(family) ?? []),
      expectedTool as string,
    ]));
  }

  for (const [family, styles] of stylesByFamily) {
    const missingStyles = PARAPHRASE_UTTERANCE_STYLES.filter((style) => !styles.has(style));
    if (missingStyles.length > 0) {
      throw new Error(
        `${family} paraphrase family is missing styles: ${missingStyles.join(", ")}`
      );
    }
    if (toolsByFamily.get(family)?.size !== 1) {
      throw new Error(`${family} paraphrase family must target exactly one tool`);
    }
  }
}

function expectedRunNumbers(runs: number): number[] {
  return Array.from({ length: runs }, (_, index) => index + 1);
}

export function summarizeParaphraseFamilies(
  dataset: ParaphraseEvalCase[],
  outcomes: ParaphraseRunOutcome[],
  runs: number
): ParaphraseSummary {
  assertValidParaphraseMetadata(dataset);
  if (!Number.isInteger(runs) || runs < 1) {
    throw new Error("Paraphrase summary runs must be a positive integer");
  }

  const familyCases = new Map<string, Array<{
    case_id: string;
    utterance_style: ParaphraseUtteranceStyle;
    expected_tool: string;
  }>>();
  const familyByCaseId = new Map<string, string>();
  for (const item of dataset) {
    if (!item.paraphraseFamily || !item.utteranceStyle) continue;
    const entry = {
      case_id: item.id,
      utterance_style: item.utteranceStyle,
      expected_tool: item.expectedCall[0].functionName,
    };
    familyCases.set(item.paraphraseFamily, [
      ...(familyCases.get(item.paraphraseFamily) ?? []),
      entry,
    ]);
    familyByCaseId.set(item.id, item.paraphraseFamily);
  }

  const expectedRuns = expectedRunNumbers(runs);
  const families = [...familyCases.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([family, cases]): ParaphraseFamilySummary => {
      const expectedTools = new Set(cases.map((item) => item.expected_tool));
      if (expectedTools.size !== 1) {
        throw new Error(`${family} paraphrase family must target exactly one tool`);
      }
      const caseIds = new Set(cases.map((item) => item.case_id));
      const familyOutcomes = outcomes.filter((item) => caseIds.has(item.case_id));
      const outcomesByCaseAndRun = new Map<string, ParaphraseRunOutcome[]>();
      for (const outcome of familyOutcomes) {
        const key = `${outcome.case_id}\u0000${outcome.run}`;
        outcomesByCaseAndRun.set(key, [
          ...(outcomesByCaseAndRun.get(key) ?? []),
          outcome,
        ]);
      }

      const failedCases: ParaphraseCaseRuns[] = [];
      const missingCases: ParaphraseCaseRuns[] = [];
      for (const item of cases) {
        const failedRuns: number[] = [];
        const missingRuns: number[] = [];
        for (const run of expectedRuns) {
          const matches = outcomesByCaseAndRun.get(`${item.case_id}\u0000${run}`) ?? [];
          if (matches.length === 0) missingRuns.push(run);
          if (matches.some((outcome) => !outcome.exact_match)) failedRuns.push(run);
        }
        if (failedRuns.length > 0) {
          failedCases.push({
            case_id: item.case_id,
            utterance_style: item.utterance_style,
            runs: failedRuns,
          });
        }
        if (missingRuns.length > 0) {
          missingCases.push({
            case_id: item.case_id,
            utterance_style: item.utterance_style,
            runs: missingRuns,
          });
        }
      }

      const expectedRunCount = cases.length * runs;
      const complete = missingCases.length === 0 &&
        familyOutcomes.length === expectedRunCount &&
        [...outcomesByCaseAndRun.values()].every((items) => items.length === 1);
      const passes = familyOutcomes.filter((item) => item.exact_match).length;
      return {
        family,
        expected_tool: [...expectedTools][0],
        match_basis: "exact_call",
        expected_cases: cases.map((item) => ({
          case_id: item.case_id,
          utterance_style: item.utterance_style,
        })),
        expected_case_count: cases.length,
        expected_styles: PARAPHRASE_UTTERANCE_STYLES.filter((style) =>
          cases.some((item) => item.utterance_style === style)
        ),
        expected_runs: expectedRunCount,
        executed_runs: familyOutcomes.length,
        passes,
        total: expectedRunCount,
        complete,
        all_passed: complete && passes === expectedRunCount,
        failed_cases: failedCases,
        missing_cases: missingCases,
      };
    });

  const familyOutcomeCount = outcomes.filter((item) => familyByCaseId.has(item.case_id)).length;
  const expectedCaseCount = families.reduce(
    (total, family) => total + family.expected_case_count,
    0
  );
  const expectedRunCount = expectedCaseCount * runs;
  const passes = families.reduce((total, family) => total + family.passes, 0);
  const complete = families.length > 0 && families.every((family) => family.complete);
  return {
    match_basis: "exact_call",
    expected_cases: expectedCaseCount,
    expected_runs: expectedRunCount,
    executed_runs: familyOutcomeCount,
    passes,
    total: expectedRunCount,
    complete,
    all_passed: complete && families.every((family) => family.all_passed),
    failed_cases: families.flatMap((family) => family.failed_cases.map((failure) => ({
      family: family.family,
      ...failure,
    }))),
    missing_cases: families.flatMap((family) => family.missing_cases.map((missing) => ({
      family: family.family,
      ...missing,
    }))),
    families,
  };
}
