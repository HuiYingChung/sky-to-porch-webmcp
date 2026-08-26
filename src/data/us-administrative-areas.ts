export interface UsAdministrativeArea {
  fips: string;
  name: string;
  postalCode: string;
  kind: "state" | "district" | "territory";
}

/**
 * Two-digit Census state/territory codes accepted by the deterministic USDM
 * StateStatistics request contract. Membership is not proof that the USDM
 * service returns a row for every code/date; no-row remains no observation.
 */
export const US_ADMINISTRATIVE_AREAS: readonly UsAdministrativeArea[] = [
  { fips: "01", name: "Alabama", postalCode: "AL", kind: "state" },
  { fips: "02", name: "Alaska", postalCode: "AK", kind: "state" },
  { fips: "04", name: "Arizona", postalCode: "AZ", kind: "state" },
  { fips: "05", name: "Arkansas", postalCode: "AR", kind: "state" },
  { fips: "06", name: "California", postalCode: "CA", kind: "state" },
  { fips: "08", name: "Colorado", postalCode: "CO", kind: "state" },
  { fips: "09", name: "Connecticut", postalCode: "CT", kind: "state" },
  { fips: "10", name: "Delaware", postalCode: "DE", kind: "state" },
  { fips: "11", name: "District of Columbia", postalCode: "DC", kind: "district" },
  { fips: "12", name: "Florida", postalCode: "FL", kind: "state" },
  { fips: "13", name: "Georgia", postalCode: "GA", kind: "state" },
  { fips: "15", name: "Hawaii", postalCode: "HI", kind: "state" },
  { fips: "16", name: "Idaho", postalCode: "ID", kind: "state" },
  { fips: "17", name: "Illinois", postalCode: "IL", kind: "state" },
  { fips: "18", name: "Indiana", postalCode: "IN", kind: "state" },
  { fips: "19", name: "Iowa", postalCode: "IA", kind: "state" },
  { fips: "20", name: "Kansas", postalCode: "KS", kind: "state" },
  { fips: "21", name: "Kentucky", postalCode: "KY", kind: "state" },
  { fips: "22", name: "Louisiana", postalCode: "LA", kind: "state" },
  { fips: "23", name: "Maine", postalCode: "ME", kind: "state" },
  { fips: "24", name: "Maryland", postalCode: "MD", kind: "state" },
  { fips: "25", name: "Massachusetts", postalCode: "MA", kind: "state" },
  { fips: "26", name: "Michigan", postalCode: "MI", kind: "state" },
  { fips: "27", name: "Minnesota", postalCode: "MN", kind: "state" },
  { fips: "28", name: "Mississippi", postalCode: "MS", kind: "state" },
  { fips: "29", name: "Missouri", postalCode: "MO", kind: "state" },
  { fips: "30", name: "Montana", postalCode: "MT", kind: "state" },
  { fips: "31", name: "Nebraska", postalCode: "NE", kind: "state" },
  { fips: "32", name: "Nevada", postalCode: "NV", kind: "state" },
  { fips: "33", name: "New Hampshire", postalCode: "NH", kind: "state" },
  { fips: "34", name: "New Jersey", postalCode: "NJ", kind: "state" },
  { fips: "35", name: "New Mexico", postalCode: "NM", kind: "state" },
  { fips: "36", name: "New York", postalCode: "NY", kind: "state" },
  { fips: "37", name: "North Carolina", postalCode: "NC", kind: "state" },
  { fips: "38", name: "North Dakota", postalCode: "ND", kind: "state" },
  { fips: "39", name: "Ohio", postalCode: "OH", kind: "state" },
  { fips: "40", name: "Oklahoma", postalCode: "OK", kind: "state" },
  { fips: "41", name: "Oregon", postalCode: "OR", kind: "state" },
  { fips: "42", name: "Pennsylvania", postalCode: "PA", kind: "state" },
  { fips: "44", name: "Rhode Island", postalCode: "RI", kind: "state" },
  { fips: "45", name: "South Carolina", postalCode: "SC", kind: "state" },
  { fips: "46", name: "South Dakota", postalCode: "SD", kind: "state" },
  { fips: "47", name: "Tennessee", postalCode: "TN", kind: "state" },
  { fips: "48", name: "Texas", postalCode: "TX", kind: "state" },
  { fips: "49", name: "Utah", postalCode: "UT", kind: "state" },
  { fips: "50", name: "Vermont", postalCode: "VT", kind: "state" },
  { fips: "51", name: "Virginia", postalCode: "VA", kind: "state" },
  { fips: "53", name: "Washington", postalCode: "WA", kind: "state" },
  { fips: "54", name: "West Virginia", postalCode: "WV", kind: "state" },
  { fips: "55", name: "Wisconsin", postalCode: "WI", kind: "state" },
  { fips: "56", name: "Wyoming", postalCode: "WY", kind: "state" },
  { fips: "60", name: "American Samoa", postalCode: "AS", kind: "territory" },
  { fips: "66", name: "Guam", postalCode: "GU", kind: "territory" },
  { fips: "69", name: "Northern Mariana Islands", postalCode: "MP", kind: "territory" },
  { fips: "72", name: "Puerto Rico", postalCode: "PR", kind: "territory" },
  { fips: "78", name: "U.S. Virgin Islands", postalCode: "VI", kind: "territory" },
] as const;

export function getUsAdministrativeArea(fips: string): UsAdministrativeArea | undefined {
  return US_ADMINISTRATIVE_AREAS.find((area) => area.fips === fips);
}

export function validateUsAdministrativeArea(value: unknown): UsAdministrativeArea {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("US administrative area must be an object");
  }
  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate).sort();
  if (keys.join(",") !== "fips,kind,name,postalCode") {
    throw new Error("US administrative area must have exact contract keys");
  }
  const registered = typeof candidate.fips === "string"
    ? getUsAdministrativeArea(candidate.fips)
    : undefined;
  if (
    !registered ||
    candidate.name !== registered.name ||
    candidate.postalCode !== registered.postalCode ||
    candidate.kind !== registered.kind
  ) {
    throw new Error("US administrative area is not in the allowlist");
  }
  return registered;
}
