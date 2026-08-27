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
