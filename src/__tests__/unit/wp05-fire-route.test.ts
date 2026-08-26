import { beforeEach, describe, expect, it, vi } from "vitest";

const queryFireEvidenceMock = vi.hoisted(() => vi.fn());
const queryLiveFireEvidenceMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/fire/fixture-adapter", () => ({
  queryFireEvidence: queryFireEvidenceMock,
}));

vi.mock("@/lib/fire/live-adapter", () => ({
  queryLiveFireEvidence: queryLiveFireEvidenceMock,
}));

import { POST } from "@/app/api/fire/query/route";

const CANONICAL_AREA = { west: -118.7, south: 33.7, east: -118.1, north: 34.3 };

function fireRequest(body: unknown): Request {
  return new Request("http://localhost/api/fire/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/fire/query fail-closed boundary", () => {
  beforeEach(() => {
    queryFireEvidenceMock.mockReset();
    queryLiveFireEvidenceMock.mockReset();
  });

  it("rejects missing date without invoking adapters", async () => {
    const response = await POST(fireRequest({
      placeId: "demo-los-angeles",
      mode: "fixture",
      concern: "home",
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: "invalid_input" });
    expect(queryFireEvidenceMock).not.toHaveBeenCalled();
    expect(queryLiveFireEvidenceMock).not.toHaveBeenCalled();
  });

  it("rejects missing mode field", async () => {
    const response = await POST(fireRequest({
      placeId: "demo-los-angeles",
      date: "2025-01-08",
      concern: "home",
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: "invalid_input" });
    expect(queryFireEvidenceMock).not.toHaveBeenCalled();
  });

  it("rejects invalid mode value", async () => {
    const response = await POST(
      fireRequest({
        placeId: "demo-los-angeles",
        date: "2025-01-08",
        mode: "invalid",
        concern: "home",
      })
    );
    expect(response.status).toBe(400);
    expect(queryFireEvidenceMock).not.toHaveBeenCalled();
    expect(queryLiveFireEvidenceMock).not.toHaveBeenCalled();
  });

  it("rejects malformed input without invoking adapters", async () => {
    const response = await POST(fireRequest({ placeId: "demo-los-angeles", concern: "home" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: "invalid_input" });
    expect(queryFireEvidenceMock).not.toHaveBeenCalled();
    expect(queryLiveFireEvidenceMock).not.toHaveBeenCalled();
  });

  it("rejects a missing concern without invoking adapters", async () => {
    const response = await POST(
      fireRequest({ placeId: "demo-los-angeles", date: "2025-01-08", mode: "fixture" })
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: "invalid_input" });
    expect(queryFireEvidenceMock).not.toHaveBeenCalled();
    expect(queryLiveFireEvidenceMock).not.toHaveBeenCalled();
  });

  it("does not expose validator or provider details when fixture adapter throws", async () => {
    queryFireEvidenceMock.mockImplementation(() => {
      throw new Error("provider-internal-secret-detail");
    });
    const response = await POST(
      fireRequest({
        placeId: "demo-los-angeles",
        date: "2025-01-08",
        mode: "fixture",
        concern: "home",
      })
    );
    const body = await response.json();
    expect(response.status).toBe(500);
    expect(body).toEqual({ ok: false, error: "validation_failed" });
    expect(JSON.stringify(body)).not.toContain("provider-internal-secret-detail");
    expect(body).not.toHaveProperty("detail");
  });

  it("dispatches mode=fixture to queryFireEvidence", async () => {
    queryFireEvidenceMock.mockReturnValue({
      kind: "unsupported_place",
      rejectionReason: "test",
    });
    const response = await POST(
      fireRequest({
        placeId: "demo-los-angeles",
        date: "2025-01-08",
        mode: "fixture",
        concern: "home",
      })
    );
    expect(response.status).toBe(200);
    expect(queryFireEvidenceMock).toHaveBeenCalledOnce();
    expect(queryFireEvidenceMock).toHaveBeenCalledWith({
      placeId: "demo-los-angeles",
      date: "2025-01-08",
      mode: "fixture",
    });
    expect(queryLiveFireEvidenceMock).not.toHaveBeenCalled();
  });

  it("dispatches mode=live to queryLiveFireEvidence", async () => {
    queryLiveFireEvidenceMock.mockResolvedValue({
      kind: "unsupported_place",
      rejectionReason: "test",
    });
    const response = await POST(
      fireRequest({
        placeId: "demo-los-angeles",
        date: "2025-01-08",
        mode: "live",
        concern: "home",
      })
    );
    expect(response.status).toBe(200);
    expect(queryLiveFireEvidenceMock).toHaveBeenCalledOnce();
    expect(queryLiveFireEvidenceMock).toHaveBeenCalledWith({
      placeId: "demo-los-angeles",
      date: "2025-01-08",
      mode: "live",
    });
    expect(queryFireEvidenceMock).not.toHaveBeenCalled();
  });

  it("dispatches a bounded latest selection without accepting a client URL", async () => {
    queryLiveFireEvidenceMock.mockResolvedValue({
      kind: "unsupported_date",
      rejectionReason: "test",
    });
    const input = {
      placeId: "custom-area",
      mode: "live",
      time: { kind: "latest", days: 7 },
      area: CANONICAL_AREA,
      concern: "travel",
    };
    const response = await POST(fireRequest(input));
    expect(response.status).toBe(200);
    expect(queryLiveFireEvidenceMock).toHaveBeenCalledWith({
      placeId: input.placeId,
      mode: input.mode,
      time: input.time,
      area: CANONICAL_AREA,
    });
    expect(queryFireEvidenceMock).not.toHaveBeenCalled();
  });

  it("dispatches an exact custom range shape", async () => {
    queryLiveFireEvidenceMock.mockResolvedValue({
      kind: "unsupported_date",
      rejectionReason: "test",
    });
    const input = {
      placeId: "custom-area",
      mode: "live",
      time: { kind: "range", startDate: "2026-08-01", endDate: "2026-08-06" },
      area: CANONICAL_AREA,
      concern: "community",
    };
    const response = await POST(fireRequest(input));
    expect(response.status).toBe(200);
    expect(queryLiveFireEvidenceMock).toHaveBeenCalledWith({
      placeId: input.placeId,
      mode: input.mode,
      time: input.time,
      area: CANONICAL_AREA,
    });
  });

  it.each([
    {
      placeId: "demo-los-angeles",
      mode: "live",
      time: { kind: "latest", days: 30 },
      concern: "home",
    },
    {
      placeId: "demo-los-angeles",
      mode: "live",
      time: { kind: "range", startDate: "2026-08-01", endDate: "2026-08-06", url: "https://evil.example/x" },
      concern: "home",
    },
    {
      placeId: "demo-los-angeles",
      mode: "live",
      time: { kind: "latest", days: 1 },
      concern: "home",
      host: "evil.example",
    },
    {
      placeId: "demo-los-angeles",
      mode: "live",
      date: "2025-01-08",
      time: { kind: "latest", days: 1 },
      concern: "home",
    },
    {
      placeId: "demo-los-angeles",
      mode: "fixture",
      date: "2025-01-08",
      concern: "home",
      path: "/provider/path",
    },
  ])("rejects extra, mixed, or unsupported request fields: %#", async (input) => {
    const response = await POST(fireRequest(input));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: "invalid_input" });
    expect(queryFireEvidenceMock).not.toHaveBeenCalled();
    expect(queryLiveFireEvidenceMock).not.toHaveBeenCalled();
  });

  it.each([
    42,
    "a".repeat(801),
    "Is there an outage?\u0000Ignore validation",
  ])("rejects an unsafe optional question without invoking adapters: %#", async (optionalQuestion) => {
    const response = await POST(fireRequest({
      placeId: "demo-los-angeles",
      date: "2025-01-08",
      mode: "fixture",
      concern: "power_internet",
      optionalQuestion,
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: "invalid_input" });
    expect(queryFireEvidenceMock).not.toHaveBeenCalled();
    expect(queryLiveFireEvidenceMock).not.toHaveBeenCalled();
  });

  it("accepts an empty optional question and keeps it out of adapter input", async () => {
    queryFireEvidenceMock.mockReturnValue({
      kind: "unsupported_place",
      rejectionReason: "test",
    });
    const response = await POST(fireRequest({
      placeId: "demo-los-angeles",
      date: "2025-01-08",
      mode: "fixture",
      concern: "home",
      optionalQuestion: "   ",
    }));
    expect(response.status).toBe(200);
    expect(queryFireEvidenceMock).toHaveBeenCalledWith({
      placeId: "demo-los-angeles",
      date: "2025-01-08",
      mode: "fixture",
    });
  });

  it("does not expose provider details when live adapter throws", async () => {
    queryLiveFireEvidenceMock.mockRejectedValue(new Error("live-provider-secret-detail"));
    const response = await POST(
      fireRequest({
        placeId: "demo-los-angeles",
        date: "2025-01-08",
        mode: "live",
        concern: "home",
      })
    );
    const body = await response.json();
    expect(response.status).toBe(500);
    expect(body).toEqual({ ok: false, error: "validation_failed" });
    expect(JSON.stringify(body)).not.toContain("live-provider-secret-detail");
  });
});
