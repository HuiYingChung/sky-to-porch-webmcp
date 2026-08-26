"use client";
/**
 * src/components/states/base-states.tsx
 *
 * Reusable loading, empty, and error components.
 *
 * Safety rules:
 * - Loading: exposes a status with aria-live.
 * - Empty: explains what is missing; does NOT imply safety.
 * - Error: uses role="alert" and a safe recovery action when available.
 *   Never exposes provider details, credentials, or raw error messages.
 */

import React from "react";

/* ── Loading ─────────────────────────────────── */

interface LoadingStateProps {
  /** Accessible description of what is loading. */
  label?: string;
}

export function LoadingState({ label = "Loading…" }: LoadingStateProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      data-testid="loading-state"
      style={{
        padding: "1rem",
        color: "var(--status-loading-fg)",
        fontSize: "14px",
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
      }}
    >
      {/* No animation — reduced-motion respected by no-animation default */}
      <span aria-hidden="true">⋯</span>
      <span>{label}</span>
    </div>
  );
}

/* ── Empty ───────────────────────────────────── */

interface EmptyStateProps {
  /** Short description of what data is missing. */
  message: string;
  /** Optional hint about what to do next — must not imply safety. */
  hint?: string;
}

export function EmptyState({ message, hint }: EmptyStateProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="empty-state"
      style={{
        padding: "1rem",
        color: "var(--status-empty-fg)",
        fontSize: "14px",
        border: "1px solid var(--border-subtle)",
        borderRadius: "4px",
      }}
    >
      <p style={{ margin: 0, fontWeight: 500 }}>{message}</p>
      {hint && (
        <p style={{ margin: "0.25rem 0 0", fontSize: "14px" }}>{hint}</p>
      )}
    </div>
  );
}

/* ── Error ───────────────────────────────────── */

interface ErrorStateProps {
  /**
   * Safe, user-facing message. Must NOT expose provider details, credentials,
   * URLs, or internal error messages.
   */
  message?: string;
  /** Optional recovery action the user can take. */
  recoveryLabel?: string;
  onRecover?: () => void;
}

export function ErrorState({
  message = "Something went wrong. Please try again.",
  recoveryLabel,
  onRecover,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      data-testid="error-state"
      style={{
        padding: "1rem",
        background: "var(--status-error-bg)",
        border: "1px solid var(--status-error-border)",
        borderRadius: "4px",
        color: "var(--status-error-fg)",
        fontSize: "14px",
      }}
    >
      <p style={{ margin: 0, fontWeight: 500 }}>{message}</p>
      {recoveryLabel && onRecover && (
        <button
          type="button"
          onClick={onRecover}
          data-testid="error-recovery-btn"
          style={{
            marginTop: "0.5rem",
            padding: "4px 12px",
            fontSize: "14px",
            border: "1px solid var(--status-error-border)",
            borderRadius: "4px",
            background: "transparent",
            color: "var(--status-error-fg)",
            cursor: "pointer",
          }}
        >
          {recoveryLabel}
        </button>
      )}
    </div>
  );
}
