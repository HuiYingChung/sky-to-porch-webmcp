"use client";

import { useQueryDraft } from "@/components/query/query-provider";
import { SelectionSummary } from "@/components/selection/selection-summary";

interface NonMapSelectionProps {
  idPrefix: string;
}

/**
 * Textual alternative to the visual map. Query controls remain in the left
 * Query column; this view only describes the same atomic canonical selection.
 */
export function NonMapSelection({ idPrefix }: NonMapSelectionProps) {
  const { placeSelection } = useQueryDraft();
  const headingId = `${idPrefix}non-map-heading`;

  return (
    <section
      aria-labelledby={headingId}
      data-testid="non-map-selection"
      style={{ padding: "1rem", display: "grid", gap: "0.75rem" }}
    >
      <h3 id={headingId} style={{ fontSize: "16px", margin: 0 }}>
        Selected area — text view
      </h3>
      {!placeSelection ? (
        <p role="status" style={{ margin: 0, color: "var(--text-secondary)", fontSize: "14px" }}>
          No area is selected. Enter or choose a location in Query, or switch to Map and click a place.
        </p>
      ) : (
        <SelectionSummary selection={placeSelection} includeTime={false} showMethodDetails />
      )}
    </section>
  );
}
