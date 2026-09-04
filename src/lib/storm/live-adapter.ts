import { createHash } from "crypto";
import type { BoundingBox } from "@/contracts/common";
import type { EvidenceObject, Limitation, Observation } from "@/contracts/evidence";
import { validateEvidenceObject } from "@/contracts/evidence";
import { CUSTOM_AREA_PLACE_ID } from "@/lib/location/query-area";
import { validateQueryArea } from "@/lib/location/query-area";
import { queryGhcnhWindEvidence } from "@/lib/heat/ground-live-adapter";
import { queryNwsLocalStormReports } from "./nws-lsr-live-adapter";
import { queryNceiStormEvents } from "./ncei-storm-events-live-adapter";
import { queryNhcHurdat2 } from "./nhc-hurdat-live-adapter";
import type { StormLiveQueryInput, StormQueryResult } from "./types";

const WIND_EARLIEST_DATE = "1901-01-01";
const BERYL_DATE = "2024-07-08";
const BERYL_REPORT_URL =
  "https://www.weather.gov/media/hgx/TropicalEventSummary/PSHHGX_2024AL02_Beryl_Summary.pdf";
const BERYL_REPORTING_BOX: BoundingBox = {
  west: -96.8,
  south: 28.4,
  east: -94.3,
  north: 30.8,
};

const STATION_LIMITATION: Limitation = {
  limitationId: "lim-wind-station-not-property",
  source: "noaa_ncei_global_hourly",
  description:
    "The selected in-area station is an outdoor point observation. It does not establish roof-level wind, wind at an address, property damage, or causation.",
  required: true,
};

const EVENT_LIMITATION: Limitation = {
  limitationId: "lim-wind-event-regional",
  source: "nws_tropical_cyclone_report",
  description:
    "The official event report establishes regional storm context only. It does not prove that the selected property experienced the reported winds or suffered damage.",
  required: true,
};

const LOCAL_STORM_REPORT_LIMITATION: Limitation = {
  limitationId: "lim-wind-nws-lsr-preliminary",
  source: "nws_local_storm_reports",
  description:
    "NWS Local Storm Reports are preliminary event reports and may be corrected or replaced. An in-area report establishes reported regional event context, not wind at an address, property damage, or causation.",
  required: true,
};

const LOCAL_STORM_REPORT_FAILURE_LIMITATION: Limitation = {
  limitationId: "lim-wind-nws-lsr-source-failure",
  source: "nws_local_storm_reports",
  description:
    "The recent NWS Local Storm Report request failed or was only partially completed. Other returned evidence does not replace the missing event-report check, and the failure is not evidence that no storm occurred.",
  required: true,
};

const NCEI_STORM_EVENTS_LIMITATION: Limitation = {
  limitationId: "lim-wind-ncei-storm-events-regional",
  source: "noaa_ncei_storm_events",
  description:
    "NOAA NCEI Storm Events records are delayed historical reports. An event coordinate inside the selected area establishes documented regional event context, not wind at an address, damage, or causation.",
  required: true,
};

const NCEI_STORM_EVENTS_FAILURE_LIMITATION: Limitation = {
  limitationId: "lim-wind-ncei-storm-events-failure",
  source: "noaa_ncei_storm_events",
  description:
    "The NCEI annual Storm Events publication was unavailable or invalid. Other evidence does not replace that historical-event check, and the failure is not evidence that no storm occurred.",
  required: true,
};

const HURDAT2_LIMITATION: Limitation = {
  limitationId: "lim-wind-hurdat2-center-track",
  source: "nhc_hurdat2",
  description:
    "NHC HURDAT2 is a post-analysis tropical-cyclone best track. A six-hour storm-center point inside the selected area is not the wind footprint and does not establish wind or damage at a property.",
  required: true,
};

const HURDAT2_FAILURE_LIMITATION: Limitation = {
  limitationId: "lim-wind-hurdat2-failure",
  source: "nhc_hurdat2",
  description:
    "The HURDAT2 check failed. Other evidence does not replace the missing tropical-cyclone best-track check, and the failure is not evidence that no storm occurred.",
  required: true,
};

const CLAIM_LIMITATION: Limitation = {
  limitationId: "lim-wind-no-claim-decision",
  source: "Sky to Porch",
  description:
    "This evidence does not determine engineering causation, policy coverage, liability, repair scope, or an insurance-claim outcome.",
  required: true,
};

const NO_DATA_LIMITATION: Limitation = {
  limitationId: "lim-wind-no-data-not-no-danger",
  source: "Sky to Porch",
  description:
    "Missing, unavailable, or incomplete wind evidence is not evidence that damaging wind did not occur.",
  required: true,
};

const STATION_DATE_NO_OBSERVATION_LIMITATION: Limitation = {
  limitationId: "lim-wind-station-date-no-observation",
  source: "noaa_ncei_global_hourly",
  description:
    "NOAA's historical hourly station records contained no usable wind readings inside the selected area for the requested date. The records may not be published yet or may have gaps; this does not prove that no storm occurred.",
  required: true,
};

function intersects(left: BoundingBox, right: BoundingBox): boolean {
  return !(
    left.east < right.west ||
    left.west > right.east ||
    left.north < right.south ||
    left.south > right.north
  );
}

function berylEventObservation(area: BoundingBox, date: string, retrievedAt: string): Observation | null {
  if (date !== BERYL_DATE || !intersects(area, BERYL_REPORTING_BOX)) return null;
  const record = {
    event: "Hurricane Beryl",
    date: BERYL_DATE,
    reportingOffice: "NWS Houston/Galveston",
    scope: "Southeast Texas regional event context",
    summary:
      "The post-tropical cyclone report documents Hurricane Beryl and widespread wind damage across Southeast Texas, with named regional observing-site gusts.",
  };
  return {
    observationId: "obs-nws-beryl-20240708-regional-context",
    provenance: {
      sourceId: "nws_tropical_cyclone_report",
      sourceUrl: BERYL_REPORT_URL,
      sourceRecordId: "PSHHGX_2024AL02_Beryl_Summary",
      retrievedAt,
      observedAt: "2024-07-08T00:00:00.000Z",
      product: "NWS Houston/Galveston Post-Tropical Cyclone Report for Hurricane Beryl",
      payloadHash: createHash("sha256").update(JSON.stringify(record)).digest("hex"),
      requestParameters: {
        eventDate: date,
        applicability: "selected_area_intersects_governed_reporting_box",
      },
    },
    variableName: "Official regional wind-storm event context",
    textValue: record.summary,
    dataMode: "historical",
    qualifiers: ["official_post_event_report", "regional_context_not_property_evidence"],
    periodStart: "2024-07-08T00:00:00.000Z",
    periodEnd: "2024-07-08T23:59:59.000Z",
    metadata: {
      eventName: record.event,
      reportingOffice: record.reportingOffice,
      applicabilityBasis: "date_and_reporting_box_overlap",
    },
  };
}

function sourceFailureResult(message: string): StormQueryResult {
  return { kind: "source_failure", rejectionReason: message };
}

export async function queryLiveStormEvidence(
  input: StormLiveQueryInput,
  dependencies: { fetchImpl?: typeof fetch; now?: () => Date } = {}
): Promise<StormQueryResult> {
  if (input.placeId !== CUSTOM_AREA_PLACE_ID) {
    return { kind: "unsupported_place", rejectionReason: "Wind & Storm requires a validated selected area." };
  }
  let area: BoundingBox;
  try {
    area = validateQueryArea(input.area);
  } catch {
    return { kind: "unsupported_place", rejectionReason: "The selected Wind & Storm area is invalid." };
  }
  const now = dependencies.now?.() ?? new Date();
  const parsedDate = Date.parse(`${input.date}T00:00:00Z`);
  const latestCompleted = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1
  )).toISOString().slice(0, 10);
  if (
    !/^\d{4}-\d{2}-\d{2}$/u.test(input.date) ||
    !Number.isFinite(parsedDate) ||
    new Date(parsedDate).toISOString().slice(0, 10) !== input.date ||
    input.date < WIND_EARLIEST_DATE ||
    input.date > latestCompleted
  ) {
    return {
      kind: "unsupported_date",
      rejectionReason: `Wind & Storm needs one completed UTC date from ${WIND_EARLIEST_DATE} through ${latestCompleted}.`,
    };
  }

  const retrievedAt = now.toISOString();
  const eventObservation = berylEventObservation(area, input.date, retrievedAt);
  const [ghcnh, localStormReports, nceiStormEvents, hurdat2] = await Promise.all([
    queryGhcnhWindEvidence(input.date, area, {
      fetchImpl: dependencies.fetchImpl,
      now: () => now,
    }),
    queryNwsLocalStormReports(area, input.date, input.date, "wind_storm", {
      fetchImpl: dependencies.fetchImpl,
      now: () => now,
    }),
    queryNceiStormEvents(area, input.date, "wind_storm", {
      fetchImpl: dependencies.fetchImpl,
      now: () => now,
    }),
    queryNhcHurdat2(area, input.date, {
      fetchImpl: dependencies.fetchImpl,
      now: () => now,
    }),
  ]);
  const stationObservations: Observation[] = ghcnh.kind === "observations"
    ? ghcnh.observations.map((observation) => ({ ...observation, dataMode: "historical" as const }))
    : [];
  const localReportObservations = localStormReports.kind === "observations"
    ? localStormReports.observations
    : [];
  const nceiObservations = nceiStormEvents.kind === "observations"
    ? nceiStormEvents.observations
    : [];
  const hurdatObservations = hurdat2.kind === "observations"
    ? hurdat2.observations
    : [];
  const observations: Observation[] = [
    ...stationObservations,
    ...localReportObservations,
    ...nceiObservations,
    ...hurdatObservations,
    ...(eventObservation ? [eventObservation] : []),
  ];
  const derivedMetrics = stationObservations.flatMap((observation) =>
    observation.value === undefined
      ? []
      : [{
          metricId: `metric-${observation.observationId}-mph`,
          sourceObservationIds: [observation.observationId],
          metricName: `${observation.variableName} in miles per hour`,
          value: Math.round(observation.value * 2.2369362921 * 10) / 10,
          unit: "mph",
          derivationMethod: "Multiply the source value in metres per second by 2.2369362921 and round to one decimal place.",
          dataMode: "historical" as const,
        }]
  );

  if (
    observations.length === 0 &&
    ghcnh.kind === "source_failure" &&
    localStormReports.kind === "source_failure" &&
    nceiStormEvents.kind === "source_failure" &&
    hurdat2.kind === "source_failure"
  ) {
    return sourceFailureResult(
      "The NOAA GHCNh, NWS Local Storm Report, NCEI Storm Events, and NHC HURDAT2 checks all failed. No rain, flood, example, or out-of-area information was substituted."
    );
  }

  const hasStation = stationObservations.length > 0;
  const hasOfficialEvent = localReportObservations.length > 0 || nceiObservations.length > 0 || hurdatObservations.length > 0 || eventObservation !== null;
  const stationDateReturnedNoObservation = ghcnh.kind === "no_observation" &&
    ghcnh.stage === "station_year";
  const evidenceState = hasStation
    ? "observations_returned" as const
    : hasOfficialEvent
      ? "inconclusive_evidence" as const
      : stationDateReturnedNoObservation
        ? "no_observation" as const
        : "unsupported_coverage" as const;
  const latestObservationMs = Math.max(
    ...observations
      .map((observation) => Date.parse(observation.provenance.observedAt))
      .filter(Number.isFinite)
  );
  const evidence: EvidenceObject = {
    evidenceId: `evd-wind-${input.date.replaceAll("-", "")}-${retrievedAt.replace(/[^0-9]/gu, "")}`,
    hazardId: "wind_storm",
    intentId: `intent-wind-live-${input.placeId}-${input.date}`,
    evidenceState,
    dataMode: "historical",
    observations,
    derivedMetrics,
    missionAttributions: [
      {
        missionName: "NOAA NCEI Global Historical Climatology Network-hourly",
        agency: "NOAA / NCEI",
        purpose: "Provide named outdoor station wind-speed and wind-gust observations.",
        selectionReason: stationDateReturnedNoObservation
          ? "The station records were checked, but no usable wind reading matched the requested date inside the selected area."
          : ghcnh.kind === "no_observation"
            ? "Station discovery found no station whose coordinate lies inside the selected geometry."
            : "Nearest usable station whose coordinate lies inside the selected geometry.",
        contributedObservationIds: stationObservations.map((item) => item.observationId),
        retrievalStatus: ghcnh.kind === "observations"
          ? "success"
          : ghcnh.kind === "source_failure"
            ? "failed"
            : "no_observation",
        keyLimitation: stationDateReturnedNoObservation
          ? STATION_DATE_NO_OBSERVATION_LIMITATION.description
          : STATION_LIMITATION.description,
        datasetId: "NOAA NCEI GHCNh v1",
      },
      ...(localStormReports.kind === "observations"
        ? [{
            missionName: "NWS Preliminary Local Storm Reports",
            agency: "NOAA / National Weather Service",
            purpose: "Provide recent official, geolocated reports of wind, hail, tornado, and related storm events.",
            selectionReason: "Recent NWS reports were accepted only when their event type matched Wind & Storm, their report date matched the request, and their coordinate was inside the exact selected geometry.",
            contributedObservationIds: localReportObservations.map((item) => item.observationId),
            retrievalStatus: localStormReports.failedRequestCount > 0
              ? "partial" as const
              : "success" as const,
            keyLimitation: LOCAL_STORM_REPORT_LIMITATION.description,
            datasetId: "NWS LSR",
          }]
        : []),
      ...(nceiObservations.length > 0 ? [{
        missionName: "NOAA NCEI Storm Events Database",
        agency: "NOAA / NCEI",
        purpose: "Provide official historical records of documented wind and severe-weather events.",
        selectionReason: nceiStormEvents.kind === "observations"
          ? "Only records whose event date matched the request and whose reported coordinate fell inside the exact selected geometry were included."
          : nceiStormEvents.kind === "source_failure"
            ? "The annual collection of historical storm reports could not be checked."
            : "The published annual file contained no matching geolocated Wind & Storm record inside the selected geometry.",
        contributedObservationIds: nceiObservations.map((item) => item.observationId),
        retrievalStatus: "success" as const,
        keyLimitation: NCEI_STORM_EVENTS_LIMITATION.description,
        datasetId: "NOAA NCEI Storm Events details bulk CSV v1.0",
      }] : []),
      ...(hurdatObservations.length > 0 ? [{
        missionName: "NHC HURDAT2 best-track database",
        agency: "NOAA / National Hurricane Center",
        purpose: "Provide official post-analysis tropical-cyclone center positions and maximum sustained winds.",
        selectionReason: hurdat2.kind === "observations"
          ? "Six-hour best-track center points were included only when their timestamp matched the request and the center coordinate fell inside the exact selected geometry."
          : hurdat2.kind === "source_failure"
            ? "The historical storm-track source could not be checked."
            : hurdat2.kind === "not_applicable"
              ? "The requested date falls outside the currently published HURDAT2 record."
              : "No published tropical-cyclone center track point matched the date and selected geometry.",
        contributedObservationIds: hurdatObservations.map((item) => item.observationId),
        retrievalStatus: "success" as const,
        keyLimitation: HURDAT2_LIMITATION.description,
        datasetId: "NHC HURDAT2",
      }] : []),
      ...(eventObservation ? [{
        missionName: "NWS Houston/Galveston Hurricane Beryl report",
        agency: "NOAA / National Weather Service",
        purpose: "Provide official regional post-event context for the governed Beryl date and area.",
        selectionReason: eventObservation
          ? "The requested date and selected geometry match the report's scope."
          : "The requested date or selected geometry does not match the report scope.",
        contributedObservationIds: eventObservation ? [eventObservation.observationId] : [],
        retrievalStatus: "success" as const,
        keyLimitation: EVENT_LIMITATION.description,
        datasetId: "PSHHGX_2024AL02_Beryl_Summary",
      }] : []),
    ],
    freshness: Number.isFinite(latestObservationMs)
      ? {
          status: "historical",
          classificationBasis: "historical_context",
          mostRecentObservationAt: new Date(latestObservationMs).toISOString(),
          evaluatedAt: retrievedAt,
          ageSeconds: Math.floor((Date.parse(retrievedAt) - latestObservationMs) / 1000),
          note: "Historical observations for the explicitly requested completed UTC date.",
        }
      : {
          status: "unknown",
          classificationBasis: "no_observation_time",
          evaluatedAt: retrievedAt,
          note: "No usable wind-observation timestamp was returned.",
        },
    confidence: {
      level: hasStation ? "low" : "insufficient",
      rationale: hasStation
        ? "A named in-area outdoor station is available, but no roof-level measurement, inspection, or property-damage evidence is present."
        : "Only regional context or no usable observation is available; property-level inference is not supported.",
    },
    limitations: [
      STATION_LIMITATION,
      ...(stationDateReturnedNoObservation ? [STATION_DATE_NO_OBSERVATION_LIMITATION] : []),
      LOCAL_STORM_REPORT_LIMITATION,
      ...(localStormReports.kind === "source_failure" ||
        ("failedRequestCount" in localStormReports && localStormReports.failedRequestCount > 0)
        ? [LOCAL_STORM_REPORT_FAILURE_LIMITATION]
        : []),
      NCEI_STORM_EVENTS_LIMITATION,
      ...(nceiStormEvents.kind === "source_failure" ? [NCEI_STORM_EVENTS_FAILURE_LIMITATION] : []),
      HURDAT2_LIMITATION,
      ...(hurdat2.kind === "source_failure" ? [HURDAT2_FAILURE_LIMITATION] : []),
      EVENT_LIMITATION,
      CLAIM_LIMITATION,
      NO_DATA_LIMITATION,
    ],
    explanations: [],
    assembledAt: retrievedAt,
  };
  validateEvidenceObject(evidence);
  return {
    kind: hasStation
      ? "success"
      : hasOfficialEvent
        ? "inconclusive_evidence"
        : stationDateReturnedNoObservation
          ? "no_observation"
          : "unsupported_coverage",
    sourceOutcomes: {
      ghcnhWind: ghcnh.kind === "observations"
        ? "success"
        : ghcnh.kind === "source_failure"
          ? "failed"
          : "no_observation",
      localStormReports: localStormReports.kind === "observations"
        ? "success"
        : localStormReports.kind === "source_failure"
          ? "failed"
          : localStormReports.kind === "not_applicable"
            ? "not_applicable"
            : "no_observation",
      nceiStormEvents: nceiStormEvents.kind === "observations"
        ? "success"
        : nceiStormEvents.kind === "source_failure"
          ? "failed"
          : "no_observation",
      hurdat2: hurdat2.kind === "observations"
        ? "success"
        : hurdat2.kind === "source_failure"
          ? "failed"
          : hurdat2.kind === "not_applicable"
            ? "not_applicable"
            : "no_observation",
      officialEventContext: eventObservation ? "success" : "not_applicable",
    },
    evidence,
  };
}
