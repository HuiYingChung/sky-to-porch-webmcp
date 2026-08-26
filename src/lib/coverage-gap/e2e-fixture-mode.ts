const FIXTURE_MODE = "coverage-gap-v1";

type FixtureEnvironment = {
  PLAYWRIGHT_TEST_SERVER?: string;
  SKY_TO_PORCH_E2E_FIXTURES?: string;
};

/**
 * Test-only dependency injection. A remote request can never enable this:
 * activation requires two server environment values and a loopback hostname.
 * A partial or unsafe configuration fails closed instead of falling back live.
 */
export async function coverageGapFetchForRequest(
  request: Request,
  environment: FixtureEnvironment = {
    PLAYWRIGHT_TEST_SERVER: process.env.PLAYWRIGHT_TEST_SERVER,
    SKY_TO_PORCH_E2E_FIXTURES: process.env.SKY_TO_PORCH_E2E_FIXTURES,
  }
): Promise<typeof fetch | undefined> {
  const requested = environment.SKY_TO_PORCH_E2E_FIXTURES !== undefined;
  if (!requested) return undefined;
  const url = new URL(request.url);
  if (
    environment.SKY_TO_PORCH_E2E_FIXTURES !== FIXTURE_MODE ||
    environment.PLAYWRIGHT_TEST_SERVER !== "1" ||
    (url.hostname !== "localhost" && url.hostname !== "127.0.0.1")
  ) {
    throw new Error("Coverage-gap E2E fixtures were requested outside the bounded local test server");
  }
  return (await import("./e2e-fixture-fetch")).coverageGapE2eFetch;
}
