export function normalizeEvalPlace(value: string): string {
  return value
    .toLocaleLowerCase("en-US")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/^(?:near|around)\s+/u, "");
}

export function asksUserToChooseHazard(text: string): boolean {
  const normalized = text
    .toLocaleLowerCase("en-US")
    .replace(/\s+/gu, " ")
    .trim();
  const hazardTerms = [
    /fire|smoke/u,
    /flood|rain/u,
    /wind|storm/u,
    /heat/u,
    /drought/u,
    /air[ _-]?quality/u,
    /earth|volcano/u,
  ];
  const namedHazardChoices = hazardTerms.filter((pattern) => pattern.test(normalized)).length;
  return /(?:which|what|choose|select|specify|do you mean).{0,80}(?:hazard|environmental condition)|(?:hazard|environmental condition).{0,80}(?:choose|select|pick|interested|focus)/u.test(normalized) ||
    (/(?:which|choose|pick).{0,80}environmental concern/u.test(normalized) && namedHazardChoices >= 2);
}

export function preservesNoObservationBoundary(text: string): boolean {
  const normalized = text
    .toLocaleLowerCase("en-US")
    .replaceAll("’", "'")
    .replace(/\s+/gu, " ")
    .trim();
  const statesNoObservation = /(?:no [^.]{0,60}(?:observations?|data)(?: (?:were )?(?:returned|found))?|no (?:returned )?(?:sources|reports)|did not return (?:an )?(?:official )?observation|couldn't find any[^.]{0,80}observations?|absence of data|lack of (?:observations?|data)|no evidence (?:was )?returned)/u.test(normalized);
  const rejectsSafetyInference = /(?:(?:doesn't|does not) (?:mean|guarantee|prove)[^.]{0,80}(?:safe|safety|no [^.]{0,30}(?:danger|risk|hazard))|(?:isn't|is not) proof[^.]{0,80}(?:safe|safety|no [^.]{0,30}(?:danger|risk|hazard))|not that[^.]{0,80}(?:safe|safety|no [^.]{0,30}(?:danger|risk|hazard)))/u.test(normalized);
  const statesInsufficientBasis = /(?:insufficient (?:evidence|confidence)|(?:evidence|confidence)[^.;]{0,20}insufficient|insufficient[^.;]{0,40}to (?:assess|determine|establish|conclude|infer)|(?:cannot|can't|unable to) (?:assess|determine|establish|conclude|infer))/u.test(normalized);
  return statesNoObservation && (rejectsSafetyInference || statesInsufficientBasis);
}

const CHAIN_LANGUAGE: Record<string, RegExp> = {
  fire_smoke: /\b(?:fire|wildfire|smoke)\b/iu,
  flood_storm: /\b(?:flood|heavy rain|rainfall|precipitation)\b/iu,
  wind_storm: /\b(?:wind|gust|hail|tornado)\b/iu,
  extreme_heat: /\b(?:extreme heat|heat|temperature)\b/iu,
  drought_land: /\b(?:drought|dryness|soil moisture|land)\b/iu,
  air_quality: /\b(?:air quality|particulate|pm2\.?5)\b/iu,
  earth_volcanoes: /\b(?:earthquake|volcano|volcanic)\b/iu,
};

const CHAIN_STATUS_LANGUAGE = /\b(?:observation|observed|evidence|source|data|available|returned|found|recorded|unsupported|insufficient|unknown|failed|failure)\b/iu;
const INTERNAL_RESULT_LANGUAGE = /\b(?:fire_smoke|flood_storm|wind_storm|extreme_heat|drought_land|air_quality|earth_volcanoes|related_context|no_observation|unsupported_coverage|source_failure|related_environmental_evidence_bundle|must_report_every_chain|required_chain_reporting|included_chains|agent_response_contract)\b/iu;

export interface MultiChainSummaryScore {
  reportsEveryChain: boolean;
  usesPlainEnglish: boolean;
  leadsWithOverallSummary: boolean;
  includesEvidenceDetails: boolean;
}

export interface EvidenceDetailRequirements {
  requiredTime: string;
  sourceTermGroups: string[][];
  requireLimitation: boolean;
}

function hasChainStatus(text: string, chain: string): boolean {
  const chainPattern = CHAIN_LANGUAGE[chain];
  if (!chainPattern) return false;
  const chainMatch = chainPattern.exec(text);
  if (!chainMatch) return false;
  const start = Math.max(0, chainMatch.index - 180);
  const end = Math.min(text.length, chainMatch.index + chainMatch[0].length + 180);
  return CHAIN_STATUS_LANGUAGE.test(text.slice(start, end));
}

export function scoreMultiChainPlainEnglishSummary(
  text: string,
  requiredChains: string[],
  evidenceRequirements?: EvidenceDetailRequirements
): MultiChainSummaryScore {
  const normalized = text
    .replaceAll("’", "'")
    .replace(/\s+/gu, " ")
    .trim();
  const reportsEveryChain = requiredChains.length > 1 &&
    requiredChains.every((chain) => hasChainStatus(normalized, chain));
  const usesPlainEnglish = normalized.length > 0 && !INTERNAL_RESULT_LANGUAGE.test(normalized);
  const summaryPrefix = normalized.slice(0, Math.min(600, normalized.length));
  const overallCue = /\b(?:overall|summary|in short|bottom line|taken together|combined result)\b/iu.exec(summaryPrefix);
  const hasOverallCue = overallCue !== null && overallCue.index <= 160;
  const leadsWithOverallSummary = hasOverallCue &&
    requiredChains.every((chain) => CHAIN_LANGUAGE[chain]?.test(summaryPrefix) === true);
  const normalizedLower = normalized.toLocaleLowerCase("en-US");
  const includesRequiredTime = !evidenceRequirements ||
    normalizedLower.includes(evidenceRequirements.requiredTime.toLocaleLowerCase("en-US"));
  const includesRequiredSources = !evidenceRequirements ||
    evidenceRequirements.sourceTermGroups.every((group) => group.some((term) =>
      normalizedLower.includes(term.toLocaleLowerCase("en-US"))
    ));
  const includesLimitation = !evidenceRequirements?.requireLimitation ||
    /\b(?:limitation|does not|doesn't|cannot|can't|not establish|not confirm|unknown|insufficient)\b/iu.test(normalized);
  const includesEvidenceDetails = includesRequiredTime && includesRequiredSources && includesLimitation;
  return {
    reportsEveryChain,
    usesPlainEnglish,
    leadsWithOverallSummary,
    includesEvidenceDetails,
  };
}
