import type { Explanation } from "@/contracts/evidence";
import { missionContextReference } from "@/data/mission-context";

/** Full deterministic claim trace belongs in Evidence, not the concise Meaning answer. */
export function ExplanationAudit({ explanation }: { explanation?: Explanation }) {
  if (!explanation) return null;
  const uniqueNotSupported = [...new Set(explanation.notSupported)];
  const keyBoundaries = uniqueNotSupported.slice(0, 5);
  const additionalLimitations = uniqueNotSupported.slice(5);

  return (
    <section
      aria-label="Explanation claim audit"
      data-testid="explanation-audit"
      style={{
        marginBottom: "10px",
        padding: "10px",
        border: "1px solid var(--border-default)",
        borderRadius: "6px",
        fontSize: "14px",
      }}
    >
      <h3 style={{ margin: 0, fontSize: "15px" }}>How this answer was built</h3>
      <div
        style={{
          marginTop: "8px",
          padding: "9px 10px",
          borderRadius: "5px",
          background: "var(--surface-2)",
          lineHeight: 1.5,
        }}
      >
        <strong style={{ display: "block", marginBottom: "3px" }}>Observed</strong>
        {explanation.observed}
      </div>
      {explanation.inferred && (
        <div
          style={{
            marginTop: "8px",
            padding: "9px 10px",
            borderInlineStart: "3px solid #7c3aed",
            background: "var(--surface-2)",
            lineHeight: 1.5,
          }}
        >
          <strong style={{ display: "block", marginBottom: "3px" }}>Inferred</strong>
          {explanation.inferred}
        </div>
      )}
      {keyBoundaries.length > 0 && (
        <div style={{ marginTop: "10px" }}>
          <strong>Key boundaries</strong>
          <ul style={{ margin: "6px 0 0", paddingInlineStart: "20px", display: "grid", gap: "6px" }}>
            {keyBoundaries.map((item) => (
              <li key={item} style={{ paddingInlineStart: "2px", lineHeight: 1.45 }}>{item}</li>
            ))}
          </ul>
        </div>
      )}
      {additionalLimitations.length > 0 && (
        <details style={{ marginTop: "10px" }}>
          <summary style={{ cursor: "pointer", color: "var(--text-link)", fontWeight: 650 }}>
            Show {additionalLimitations.length} additional data and method limitations
          </summary>
          <ul style={{ margin: "8px 0 0", paddingInlineStart: "20px", display: "grid", gap: "7px" }}>
            {additionalLimitations.map((item) => (
              <li key={item} style={{ paddingInlineStart: "2px", lineHeight: 1.5 }}>{item}</li>
            ))}
          </ul>
        </details>
      )}
      {explanation.conflictsOrGaps && (
        <div
          style={{
            marginTop: "10px",
            padding: "8px 10px",
            borderInlineStart: "3px solid #b45309",
            background: "var(--surface-2)",
          }}
        >
          <strong style={{ display: "block", marginBottom: "3px" }}>Conflicts or missing data</strong>
          {explanation.conflictsOrGaps}
        </div>
      )}
    </section>
  );
}

export function MissionContextNote() {
  return (
    <div
      role="note"
      data-testid="mission-context-note"
      style={{
        marginBottom: "10px",
        padding: "8px 10px",
        borderInlineStart: "3px solid #2563eb",
        background: "var(--surface-2)",
        fontSize: "14px",
        lineHeight: 1.5,
      }}
    >
      <strong>Background only.</strong> This is not the exact observation used for this result;
      exact products, times, and values are in Evidence.
    </div>
  );
}

export function MissionReferenceDetails({
  datasetId,
  missionName,
}: {
  datasetId?: string;
  missionName: string;
}) {
  const reference = missionContextReference(datasetId, missionName);
  if (!reference) {
    return (
      <p style={{ color: "var(--text-muted)" }}>
        No registered mission-background link is available for this attribution.
      </p>
    );
  }
  return (
    <div data-testid="mission-reference-details" style={{ marginTop: "8px" }}>
      <div><strong>Mission/product family:</strong> {reference.label}</div>
      <div><strong>Sensor/instrument:</strong> {reference.instrument}</div>
      <div style={{ display: "grid", gap: "6px", marginTop: "6px" }}>
        <a href={reference.overviewUrl} target="_blank" rel="noopener noreferrer"
          style={{ color: "var(--text-link)" }}>
          Official mission/product overview ↗
        </a>
        <a href={reference.imageryUrl} target="_blank" rel="noopener noreferrer"
          style={{ color: "var(--text-link)" }}>
          {reference.imageryLabel} ↗
        </a>
      </div>
    </div>
  );
}
