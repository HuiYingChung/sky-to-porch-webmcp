#!/usr/bin/env node
/**
 * scripts/wp05-live-source-smoke.mjs
 *
 * WP-05-004: Manual live-source smoke check for NOAA HMS.
 *
 * USAGE: npm run smoke:wp05:live
 *
 * This script MUST NOT be included in `npm run verify`, CI, or automated
 * test suites. It makes real network requests to NOAA's archive and should
 * only be run under explicit user authorization.
 *
 * What it does:
 *   1. Exercises the built local product route POST /api/fire/query for
 *      both LA (mode=live) and Lake Michigan (mode=live).
 *   2. Reports actual hashes, counts, timestamps, and freshness status.
 *   3. Compares results with the 2026-08-07 preflight reference values.
 *   4. Fails closed on unexplained drift (hash mismatch, count mismatch).
 *
 * Raw payloads are never written to disk or logged.
 *
 * Preflight reference (from docs/evidence/WP-05/2026-08-07-hms-live-preflight.md):
 *   Fire points:
 *     SHA-256: 878506D644EEAC979AE2BC9529B6825F53C0532769BB92796DC65B6FF1C8A67D
 *     Total pairs: 12986 / LA box: 4942
 *   Smoke polygons:
 *     SHA-256: B7BF4B38E35C2C9DCBB09D20E8693FE3A73DA3F099B35226AAA3893A86F4BAAB
 *     Total pairs: 2285 / LA box: 83
 *
 * Boundaries:
 *   - This is a local manual check only; it does not prove CI or remote
 *     deployment behavior.
 *   - NOAA archive data for historical dates is stable; drift is unexpected.
 *   - If drift is detected, stop and report before taking any action.
 */

const BASE_URL = "http://localhost:3000";
const PINNED_DATE = "2025-01-08";

// Preflight reference values from docs/evidence/WP-05/2026-08-07-hms-live-preflight.md
const PREFLIGHT = {
  firePoints: {
    hash: "878506D644EEAC979AE2BC9529B6825F53C0532769BB92796DC65B6FF1C8A67D",
    totalPairs: 12986,
    laBoxPairs: 4942,
  },
  smokePolygons: {
    hash: "B7BF4B38E35C2C9DCBB09D20E8693FE3A73DA3F099B35226AAA3893A86F4BAAB",
    totalPairs: 2285,
    laBoxPairs: 83,
  },
};

let exitCode = 0;

function log(msg) {
  console.log(`[wp05-live-smoke] ${msg}`);
}

function fail(msg) {
  console.error(`[wp05-live-smoke] FAIL: ${msg}`);
  exitCode = 1;
}

function pass(msg) {
  log(`PASS: ${msg}`);
}

async function queryRoute(placeId, date, mode) {
  const response = await fetch(`${BASE_URL}/api/fire/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ placeId, date, mode, concern: "home" }),
  });
  if (!response.ok) {
    throw new Error(`Route returned non-2xx: ${response.status}`);
  }
  return await response.json();
}

async function runSmoke() {
  log("Starting WP-05 live-source smoke check");
  log(`Target: ${BASE_URL}`);
  log(`Pinned date: ${PINNED_DATE}`);
  log(`Preflight reference: docs/evidence/WP-05/2026-08-07-hms-live-preflight.md`);
  log("---");
  log("NOTE: This script makes real network requests to NOAA. Authorized manual run only.");
  log("NOTE: Do not include in verify or CI.");
  log("---");

  // --- LA smoke (should return observations_returned) ---
  log("Querying demo-los-angeles (live mode)...");
  let laBody;
  try {
    laBody = await queryRoute("demo-los-angeles", PINNED_DATE, "live");
  } catch (err) {
    fail(`LA query failed: ${err.message}`);
    process.exit(1);
  }

  if (!laBody.ok || !laBody.result) {
    fail(`LA route returned ok=false or missing result: ${JSON.stringify(laBody)}`);
    process.exit(1);
  }

  const laResult = laBody.result;
  log(`LA kind: ${laResult.kind}`);

  if (laResult.kind !== "success") {
    fail(`LA expected kind=success, got ${laResult.kind}. Rejection: ${laResult.rejectionReason ?? "none"}`);
    process.exit(1);
  }

  const laEvidence = laResult.evidence;
  log(`LA evidenceId: ${laEvidence.evidenceId}`);
  log(`LA dataMode: ${laEvidence.dataMode}`);
  log(`LA freshness: ${laEvidence.freshness.status}`);
  log(`LA assembledAt: ${laEvidence.assembledAt}`);
  log(`LA confidence: ${laEvidence.confidence.level}`);

  if (laEvidence.dataMode !== "live") {
    fail(`LA dataMode expected=live, got=${laEvidence.dataMode}`);
  } else {
    pass("LA dataMode=live");
  }

  if (laEvidence.freshness.status !== "historical") {
    fail(`LA freshness expected=historical, got=${laEvidence.freshness.status}`);
  } else {
    pass("LA freshness=historical");
  }

  // Check fire observation
  const laFireObs = laEvidence.observations.find((o) => o.provenance.sourceId === "noaa_hms_fire_points");
  const laSmokeObs = laEvidence.observations.find((o) => o.provenance.sourceId === "noaa_hms_smoke_polygons");

  if (!laFireObs) {
    fail("LA missing fire observation");
  } else {
    log(`LA fire hash: ${laFireObs.provenance.payloadHash}`);
    log(`LA fire in-box pairs: ${laFireObs.value}`);
    log(`LA fire total pairs: ${laFireObs.metadata?.totalCoordinatePairs ?? "unknown"}`);

    if (laFireObs.provenance.payloadHash !== PREFLIGHT.firePoints.hash) {
      fail(`LA fire hash DRIFT. Expected: ${PREFLIGHT.firePoints.hash}, Got: ${laFireObs.provenance.payloadHash}`);
    } else {
      pass(`LA fire hash matches preflight`);
    }

    if (laFireObs.value !== PREFLIGHT.firePoints.laBoxPairs) {
      fail(`LA fire in-box count DRIFT. Expected: ${PREFLIGHT.firePoints.laBoxPairs}, Got: ${laFireObs.value}`);
    } else {
      pass(`LA fire in-box pairs matches preflight (${PREFLIGHT.firePoints.laBoxPairs})`);
    }

    if (laFireObs.metadata?.totalCoordinatePairs !== PREFLIGHT.firePoints.totalPairs) {
      fail(`LA fire total count DRIFT. Expected: ${PREFLIGHT.firePoints.totalPairs}, Got: ${laFireObs.metadata?.totalCoordinatePairs ?? "missing"}`);
    } else {
      pass(`LA fire total pairs matches preflight (${PREFLIGHT.firePoints.totalPairs})`);
    }
  }

  if (!laSmokeObs) {
    fail("LA missing smoke observation");
  } else {
    log(`LA smoke hash: ${laSmokeObs.provenance.payloadHash}`);
    log(`LA smoke in-box pairs: ${laSmokeObs.value}`);
    log(`LA smoke total pairs: ${laSmokeObs.metadata?.totalCoordinatePairs ?? "unknown"}`);

    if (laSmokeObs.provenance.payloadHash !== PREFLIGHT.smokePolygons.hash) {
      fail(`LA smoke hash DRIFT. Expected: ${PREFLIGHT.smokePolygons.hash}, Got: ${laSmokeObs.provenance.payloadHash}`);
    } else {
      pass(`LA smoke hash matches preflight`);
    }

    if (laSmokeObs.value !== PREFLIGHT.smokePolygons.laBoxPairs) {
      fail(`LA smoke in-box count DRIFT. Expected: ${PREFLIGHT.smokePolygons.laBoxPairs}, Got: ${laSmokeObs.value}`);
    } else {
      pass(`LA smoke in-box pairs matches preflight (${PREFLIGHT.smokePolygons.laBoxPairs})`);
    }

    if (laSmokeObs.metadata?.totalCoordinatePairs !== PREFLIGHT.smokePolygons.totalPairs) {
      fail(`LA smoke total count DRIFT. Expected: ${PREFLIGHT.smokePolygons.totalPairs}, Got: ${laSmokeObs.metadata?.totalCoordinatePairs ?? "missing"}`);
    } else {
      pass(`LA smoke total pairs matches preflight (${PREFLIGHT.smokePolygons.totalPairs})`);
    }
  }

  log("---");

  // --- Lake Michigan smoke (should return no_observation) ---
  log("Querying demo-lake-michigan (live mode)...");
  let lakeBody;
  try {
    lakeBody = await queryRoute("demo-lake-michigan", PINNED_DATE, "live");
  } catch (err) {
    fail(`Lake Michigan query failed: ${err.message}`);
    process.exit(1);
  }

  if (!lakeBody.ok || !lakeBody.result) {
    fail(`Lake Michigan route returned ok=false or missing result: ${JSON.stringify(lakeBody)}`);
    process.exit(1);
  }

  const lakeResult = lakeBody.result;
  log(`Lake Michigan kind: ${lakeResult.kind}`);

  if (lakeResult.kind !== "no_observation") {
    fail(`Lake Michigan expected kind=no_observation, got ${lakeResult.kind}`);
  } else {
    pass("Lake Michigan kind=no_observation");
  }

  const lakeEvidence = lakeResult.evidence;
  if (lakeEvidence) {
    log(`Lake Michigan dataMode: ${lakeEvidence.dataMode}`);
    log(`Lake Michigan freshness: ${lakeEvidence.freshness.status}`);
    log(`Lake Michigan confidence: ${lakeEvidence.confidence.level}`);

    if (lakeEvidence.dataMode !== "live") {
      fail(`Lake Michigan dataMode expected=live, got=${lakeEvidence.dataMode}`);
    } else {
      pass("Lake Michigan dataMode=live");
    }

    if (lakeEvidence.freshness.status !== "historical") {
      fail(`Lake Michigan freshness expected=historical, got=${lakeEvidence.freshness.status}`);
    } else {
      pass("Lake Michigan freshness=historical");
    }

    if (lakeEvidence.confidence.level !== "insufficient") {
      fail(`Lake Michigan no_obs confidence expected=insufficient, got=${lakeEvidence.confidence.level}`);
    } else {
      pass("Lake Michigan confidence=insufficient (no_observation)");
    }

    // Check hashes — same NOAA file, different box
    const lakeFireObs = lakeEvidence.observations.find((o) => o.provenance.sourceId === "noaa_hms_fire_points");
    const lakeSmokeObs = lakeEvidence.observations.find((o) => o.provenance.sourceId === "noaa_hms_smoke_polygons");

    if (lakeFireObs) {
      log(`Lake Michigan fire hash: ${lakeFireObs.provenance.payloadHash}`);
      if (lakeFireObs.provenance.payloadHash !== PREFLIGHT.firePoints.hash) {
        fail(`Lake Michigan fire hash DRIFT. Expected: ${PREFLIGHT.firePoints.hash}, Got: ${lakeFireObs.provenance.payloadHash}`);
      } else {
        pass("Lake Michigan fire hash matches preflight (same file, zero in-box)");
      }
      if (lakeFireObs.value !== 0) {
        fail(`Lake Michigan fire in-box expected 0, got ${lakeFireObs.value}`);
      } else {
        pass("Lake Michigan fire in-box=0 (confirmed no-observation)");
      }
    }

    if (lakeSmokeObs) {
      log(`Lake Michigan smoke hash: ${lakeSmokeObs.provenance.payloadHash}`);
      if (lakeSmokeObs.provenance.payloadHash !== PREFLIGHT.smokePolygons.hash) {
        fail(`Lake Michigan smoke hash DRIFT. Expected: ${PREFLIGHT.smokePolygons.hash}, Got: ${lakeSmokeObs.provenance.payloadHash}`);
      } else {
        pass("Lake Michigan smoke hash matches preflight (same file, zero in-box)");
      }
      if (lakeSmokeObs.value !== 0) {
        fail(`Lake Michigan smoke in-box expected 0, got ${lakeSmokeObs.value}`);
      } else {
        pass("Lake Michigan smoke in-box=0 (confirmed no-observation)");
      }
    }
  }

  log("---");

  if (exitCode === 0) {
    log("All checks passed. Live source smoke complete.");
    log("BOUNDARY: Local manual check only. Does not prove CI, remote, or production behavior.");
  } else {
    log("One or more checks FAILED. See FAIL lines above.");
    log("STOP: Report drift before taking action. Do not dismiss drift.");
  }

  process.exit(exitCode);
}

runSmoke().catch((err) => {
  console.error("[wp05-live-smoke] Unexpected error:", err);
  process.exit(1);
});
