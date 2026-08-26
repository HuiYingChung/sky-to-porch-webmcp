export interface Wp12SmokeRequestRecord {
  role: string;
  host: string;
  path: string;
  method: string;
}

export interface Wp12SmokeFailureContext {
  date: string;
  area: { west: number; south: number; east: number; north: number };
  maximumRequests: number;
  requests: Wp12SmokeRequestRecord[];
}

export interface Wp12SmokeExceptionReport extends Wp12SmokeFailureContext {
  gate: "WP-12 Earth & Volcanoes three-source product path";
  realizedRequests: number;
  resultKind: "source_failure";
  sourceOutcomes: null;
  sourceFailureDiagnostics: [];
  observationCounts: null;
  payloadHashes: [];
  rejectionReason: "The product path failed closed before a validated evidence result was available.";
  noPrediction: true;
  rawPayloadRetained: false;
  retries: 0;
  fallbacks: 0;
  failureStage: "product_path";
  failureClass: "unexpected_exception";
}

export type Wp12GuardedQueryResult<T> =
  | { kind: "success"; result: T }
  | { kind: "failure"; report: Wp12SmokeExceptionReport };

function buildExceptionReport(
  context: Wp12SmokeFailureContext
): Wp12SmokeExceptionReport {
  return {
    gate: "WP-12 Earth & Volcanoes three-source product path",
    date: context.date,
    area: context.area,
    maximumRequests: context.maximumRequests,
    realizedRequests: context.requests.length,
    requests: context.requests,
    resultKind: "source_failure",
    sourceOutcomes: null,
    sourceFailureDiagnostics: [],
    observationCounts: null,
    payloadHashes: [],
    rejectionReason:
      "The product path failed closed before a validated evidence result was available.",
    noPrediction: true,
    rawPayloadRetained: false,
    retries: 0,
    fallbacks: 0,
    failureStage: "product_path",
    failureClass: "unexpected_exception",
  };
}

export async function runWp12GuardedQuery<T>(
  query: () => Promise<T>,
  context: Wp12SmokeFailureContext
): Promise<Wp12GuardedQueryResult<T>> {
  try {
    return { kind: "success", result: await query() };
  } catch {
    return { kind: "failure", report: buildExceptionReport(context) };
  }
}
