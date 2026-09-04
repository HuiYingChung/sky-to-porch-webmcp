import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AgentPlaceLookupNotice } from "@/components/shell/app-shell";
import { createAgentPlaceLookupFeedbackCoordinator } from "@/components/webmcp/webmcp-bridge";
import {
  placeLookupChoiceReceipt,
  placeLookupFailureReceipt,
  placeLookupInvalidRequestReceipt,
  placeLookupPendingReceipt,
  placeLookupResolvedReceipt,
  placeLookupSupersededReceipt,
  type AgentPlaceLookupFeedbackContext,
  type AgentPlaceLookupReceipt,
  type AgentPlaceLookupReceiptPayload,
} from "@/lib/webmcp/place-tool";

const AUSTIN: AgentPlaceLookupFeedbackContext = {
  query: "Austin",
  operation: "analysis",
};
const DALLAS: AgentPlaceLookupFeedbackContext = {
  query: "Dallas",
  operation: "map",
};

describe("shared WebMCP place-search feedback", () => {
  it("publishes pending, visible superseded, and only the latest terminal state", async () => {
    const receipts: AgentPlaceLookupReceiptPayload[] = [];
    const publish = vi.fn(async (receipt: AgentPlaceLookupReceiptPayload) => {
      receipts.push(receipt);
    });
    const begin = createAgentPlaceLookupFeedbackCoordinator(publish);

    const older = await begin(AUSTIN);
    expect(receipts.at(-1)).toMatchObject({
      status: "lookup_pending",
      query: "Austin",
      operation: "analysis",
      map_unchanged: true,
    });

    const newer = await begin(DALLAS);
    expect(receipts.slice(-2)).toMatchObject([
      {
        status: "superseded",
        query: "Austin",
        operation: "analysis",
        ui_updated: true,
      },
      {
        status: "lookup_pending",
        query: "Dallas",
        operation: "map",
      },
    ]);
    const latestMessage = receipts.at(-1);
    expect(latestMessage && "message" in latestMessage ? latestMessage.message : "").toContain(
      "The earlier search for “Austin” stopped because this newer request took its place."
    );
    expect(older.isCurrent()).toBe(false);
    await expect(older.publish(placeLookupFailureReceipt(
      AUSTIN,
      "place_not_found"
    ))).resolves.toBe(false);

    await expect(newer.publish(placeLookupResolvedReceipt(DALLAS, {
      id: "private-dallas-id",
      label: "Dallas, Texas, United States",
      lon: -96.797,
      lat: 32.777,
      boundingBox: null,
      adminContext: { state: "Texas", country: "United States" },
    }, true))).resolves.toBe(true);
    expect(receipts.at(-1)).toMatchObject({
      status: "place_resolved",
      canonical_label: "Dallas, Texas, United States",
      map_updated: true,
    });
    expect(publish).toHaveBeenCalledTimes(4);
  });

  it("shows every candidate's geography without placing choice ids in the page", () => {
    const receipt: AgentPlaceLookupReceipt = {
      ...placeLookupChoiceReceipt({
        query: "Springfield",
        operation: "comparison",
        context_label: "First comparison place",
      }, [
        {
          id: "private-illinois-choice",
          label: "Springfield, Illinois, United States",
          lon: -89.6501,
          lat: 39.7817,
          boundingBox: {
            west: -89.7,
            south: 39.72,
            east: -89.58,
            north: 39.84,
          },
          adminContext: {
            city: "Springfield",
            state: "Illinois",
            country: "United States",
            countryCode: "US",
          },
        },
        {
          id: "private-massachusetts-choice",
          label: "Springfield, Massachusetts, United States",
          lon: -72.5898,
          lat: 42.1015,
          boundingBox: null,
          adminContext: {
            city: "Springfield",
            state: "Massachusetts",
            country: "United States",
            countryCode: "US",
          },
        },
      ]),
      receipt_revision: 7,
    };

    const html = renderToStaticMarkup(
      <AgentPlaceLookupNotice receipt={receipt} />
    );
    const container = document.createElement("div");
    container.innerHTML = html;
    const notice = container.querySelector<HTMLElement>(
      "[data-testid='agent-place-lookup-notice']"
    );
    const visibleText = container.textContent ?? "";
    expect(visibleText).toContain("Which place did you mean?");
    expect(visibleText).toContain("First comparison place");
    expect(visibleText).toContain("Springfield, Illinois, United States");
    expect(visibleText).toContain("Springfield, Massachusetts, United States");
    expect(visibleText).toContain("39.72 to 39.84");
    expect(visibleText).toContain("Located in:");
    expect(visibleText).toContain("Illinois");
    expect(visibleText).toContain("Massachusetts");
    expect(visibleText).not.toContain("place-private-illinois-choice");
    expect(visibleText).not.toContain("place-private-massachusetts-choice");
    expect(visibleText).not.toContain("choice_id");
    expect(notice?.style.overflowY).toBe("auto");
    expect(notice?.style.overflowWrap).toBe("anywhere");
    expect(notice?.style.maxHeight).toContain("42vh");
    expect(notice?.getAttribute("tabindex")).toBe("0");
    expect(notice?.getAttribute("aria-label")).toBe("Place search choices");
  });

  it("uses plain visible text for waiting, failure, and stopped searches", () => {
    const pending: AgentPlaceLookupReceipt = {
      ...placeLookupPendingReceipt(AUSTIN),
      receipt_revision: 7,
    };
    const failed: AgentPlaceLookupReceipt = {
      ...placeLookupFailureReceipt(
        { query: "Atlantis", operation: "analysis" },
        "place_not_found"
      ),
      receipt_revision: 8,
    };
    const stopped: AgentPlaceLookupReceipt = {
      ...placeLookupSupersededReceipt(AUSTIN),
      receipt_revision: 9,
    };
    const invalid: AgentPlaceLookupReceipt = {
      ...placeLookupInvalidRequestReceipt(AUSTIN),
      receipt_revision: 10,
    };
    const pendingHtml = renderToStaticMarkup(
      <AgentPlaceLookupNotice receipt={pending} />
    );
    const failedHtml = renderToStaticMarkup(
      <AgentPlaceLookupNotice receipt={failed} />
    );
    const stoppedHtml = renderToStaticMarkup(
      <AgentPlaceLookupNotice receipt={stopped} />
    );
    const invalidHtml = renderToStaticMarkup(
      <AgentPlaceLookupNotice receipt={invalid} />
    );
    expect(pendingHtml).toContain("Finding the place");
    expect(pendingHtml).toContain("current map and results stay in place");
    expect(failedHtml).toContain("We couldn’t find that place");
    expect(failedHtml).toContain("Try a more specific name");
    expect(failedHtml).toContain("current map and results have not changed");
    expect(stoppedHtml).toContain("Earlier place search stopped");
    expect(stoppedHtml).toContain("newer request or selection took its place");
    expect(invalidHtml).toContain("We couldn’t start that check");
    expect(invalidHtml).toContain("Check the place, topic, date, and area size");
    expect(invalidHtml).not.toContain("hazard");
    expect(invalidHtml).not.toContain("radius_km");
  });
});
