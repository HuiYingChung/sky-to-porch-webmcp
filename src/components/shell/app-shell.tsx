"use client";
/**
 * src/components/shell/app-shell.tsx
 *
 * Application shell — desktop three-area layout + mobile three-view layout.
 *
 * DOM structure guarantees (C01 corrections):
 * - Exactly one <main id="main-content"> exists in the document at all times.
 *   Both the skip link and keyboard navigation target it.
 * - Tab/panel IDs are prefixed ("desktop-" or "mobile-insight-") to remain
 *   unique when both Insight Navigation instances are in the DOM.
 * - ThemeSelector instances share one ThemeProvider context (mounted in layout)
 *   so aria-pressed state stays synchronized across desktop/mobile headers.
 *
 * Desktop (>= 1024px):
 *   Header | [Query area | Map placeholder | Insight area]
 *
 * Mobile (< 1024px):
 *   Header with theme selector
 *   Primary views: Ask | Map | Insight (tab-bar at bottom)
 *   Same QueryProvider instance backs all views.
 *
 * State preservation: QueryProvider is mounted once above this shell.
 * Switching primary views never unmounts or re-creates the query state.
 */

import React, { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ThemeSelector } from "@/components/theme/theme-selector";
import { SkyToPorchMark } from "@/components/brand/sky-to-porch-mark";
import { GuidedQuery } from "@/components/query/guided-query";
import { InsightNavigation } from "@/components/navigation/insight-navigation";
import { AnalysisMap } from "@/components/map/analysis-map";

const AboutDialog = dynamic(
  () => import("@/components/about/about-dialog").then((module) => module.AboutDialog),
  { ssr: false }
);

type MobileView = "ask" | "map" | "insight";

const MOBILE_VIEWS: { id: MobileView; label: string }[] = [
  { id: "ask", label: "Ask" },
  { id: "map", label: "Map" },
  { id: "insight", label: "Insight" },
];

type DesktopPanel = "query" | "insight";

interface DesktopPanelWidths {
  query: number;
  insight: number;
}

const QUERY_PANEL_MIN_WIDTH = 240;
const QUERY_PANEL_DEFAULT_WIDTH = 280;
const QUERY_PANEL_MAX_WIDTH = 480;
const INSIGHT_PANEL_MIN_WIDTH = 280;
const INSIGHT_PANEL_DEFAULT_WIDTH = 320;
const INSIGHT_PANEL_MAX_WIDTH = 560;
const MAP_MIN_WIDTH = 320;
const RESIZE_HANDLE_WIDTH = 18;
const KEYBOARD_RESIZE_STEP = 16;

const PANEL_LIMITS: Record<DesktopPanel, { min: number; max: number }> = {
  query: { min: QUERY_PANEL_MIN_WIDTH, max: QUERY_PANEL_MAX_WIDTH },
  insight: { min: INSIGHT_PANEL_MIN_WIDTH, max: INSIGHT_PANEL_MAX_WIDTH },
};

function HeaderControls({ onOpenAbout }: { onOpenAbout: () => void }) {
  return (
    <div className="app-header-controls">
      <button type="button" className="app-about-button" onClick={onOpenAbout}>
        About
      </button>
      <ThemeSelector />
    </div>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function panelMaximum(
  shellWidth: number,
  widths: DesktopPanelWidths,
  panel: DesktopPanel
) {
  const limits = PANEL_LIMITS[panel];
  if (shellWidth <= 0) return limits.max;

  const otherWidth = panel === "query" ? widths.insight : widths.query;
  return Math.min(
    limits.max,
    Math.max(
      limits.min,
      shellWidth - otherWidth - MAP_MIN_WIDTH - RESIZE_HANDLE_WIDTH * 2
    )
  );
}

function constrainPanelWidths(shellWidth: number, widths: DesktopPanelWidths) {
  let query = clamp(
    widths.query,
    QUERY_PANEL_MIN_WIDTH,
    QUERY_PANEL_MAX_WIDTH
  );
  let insight = clamp(
    widths.insight,
    INSIGHT_PANEL_MIN_WIDTH,
    INSIGHT_PANEL_MAX_WIDTH
  );

  if (shellWidth <= 0) return { query, insight };

  const combinedMaximum = Math.max(
    QUERY_PANEL_MIN_WIDTH + INSIGHT_PANEL_MIN_WIDTH,
    shellWidth - MAP_MIN_WIDTH - RESIZE_HANDLE_WIDTH * 2
  );
  const overflow = query + insight - combinedMaximum;

  if (overflow > 0) {
    const queryCapacity = query - QUERY_PANEL_MIN_WIDTH;
    const insightCapacity = insight - INSIGHT_PANEL_MIN_WIDTH;
    const totalCapacity = queryCapacity + insightCapacity;

    if (totalCapacity > 0) {
      const queryReduction = Math.min(
        queryCapacity,
        overflow * (queryCapacity / totalCapacity)
      );
      query -= queryReduction;
      insight -= Math.min(insightCapacity, overflow - queryReduction);
    }
  }

  return { query: Math.round(query), insight: Math.round(insight) };
}

export function AppShell() {
  const [mobileView, setMobileView] = useState<MobileView>("ask");
  const [aboutOpen, setAboutOpen] = useState(false);
  const [desktopPanelWidths, setDesktopPanelWidths] =
    useState<DesktopPanelWidths>({
      query: QUERY_PANEL_DEFAULT_WIDTH,
      insight: INSIGHT_PANEL_DEFAULT_WIDTH,
    });
  const [desktopShellWidth, setDesktopShellWidth] = useState(0);
  const desktopShellRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    panel: DesktopPanel;
    pointerId: number;
    startX: number;
    startWidth: number;
  } | null>(null);

  useEffect(() => {
    const shell = desktopShellRef.current;
    if (!shell) return;

    const syncToShellWidth = () => {
      const shellWidth = shell.clientWidth;
      setDesktopShellWidth((current) =>
        current === shellWidth ? current : shellWidth
      );
      setDesktopPanelWidths((current) => {
        const next = constrainPanelWidths(shellWidth, current);
        return next.query === current.query && next.insight === current.insight
          ? current
          : next;
      });
    };

    syncToShellWidth();
    const observer = new ResizeObserver(syncToShellWidth);
    observer.observe(shell);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, []);

  // Input events dispatched before hydration are silently dropped by React;
  // this attribute lets automation (tests/e2e/helpers.ts gotoHydrated) wait
  // until the shell is interactive.
  useEffect(() => {
    document.documentElement.dataset.appHydrated = "true";
  }, []);

  const resizePanel = (panel: DesktopPanel, requestedWidth: number) => {
    setDesktopPanelWidths((current) => {
      const shellWidth = desktopShellRef.current?.clientWidth ?? desktopShellWidth;
      const limits = PANEL_LIMITS[panel];
      const maximum = panelMaximum(shellWidth, current, panel);
      const nextWidth = Math.round(clamp(requestedWidth, limits.min, maximum));
      return nextWidth === current[panel]
        ? current
        : { ...current, [panel]: nextWidth };
    });
  };

  const handleResizePointerDown = (
    panel: DesktopPanel,
    event: React.PointerEvent<HTMLDivElement>
  ) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      panel,
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: desktopPanelWidths[panel],
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  const handleResizePointerMove = (
    panel: DesktopPanel,
    event: React.PointerEvent<HTMLDivElement>
  ) => {
    const drag = dragRef.current;
    if (!drag || drag.panel !== panel || drag.pointerId !== event.pointerId) {
      return;
    }

    const pointerDelta = event.clientX - drag.startX;
    const widthDelta = panel === "query" ? pointerDelta : -pointerDelta;
    resizePanel(panel, drag.startWidth + widthDelta);
  };

  const finishResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  };

  const handleResizeKeyDown = (
    panel: DesktopPanel,
    event: React.KeyboardEvent<HTMLDivElement>
  ) => {
    const currentWidth = desktopPanelWidths[panel];
    const maximum = panelMaximum(
      desktopShellRef.current?.clientWidth ?? desktopShellWidth,
      desktopPanelWidths,
      panel
    );
    let requestedWidth: number | null = null;

    if (event.key === "Home") requestedWidth = PANEL_LIMITS[panel].min;
    if (event.key === "End") requestedWidth = maximum;
    if (event.key === "ArrowLeft") {
      requestedWidth =
        currentWidth + (panel === "query" ? -KEYBOARD_RESIZE_STEP : KEYBOARD_RESIZE_STEP);
    }
    if (event.key === "ArrowRight") {
      requestedWidth =
        currentWidth + (panel === "query" ? KEYBOARD_RESIZE_STEP : -KEYBOARD_RESIZE_STEP);
    }

    if (requestedWidth === null) return;
    event.preventDefault();
    resizePanel(panel, requestedWidth);
  };

  const renderResizeHandle = (panel: DesktopPanel) => {
    const isQuery = panel === "query";
    const width = desktopPanelWidths[panel];
    const maximum = panelMaximum(
      desktopShellWidth,
      desktopPanelWidths,
      panel
    );

    return (
      <div
        role="separator"
        className="panel-resize-handle"
        aria-label={`Resize ${isQuery ? "query" : "insight"} panel`}
        aria-orientation="vertical"
        aria-controls={isQuery ? "desktop-query-panel" : "desktop-insight-panel"}
        aria-valuemin={PANEL_LIMITS[panel].min}
        aria-valuemax={maximum}
        aria-valuenow={width}
        aria-valuetext={`${width} pixels`}
        title={`Drag or use arrow keys to resize the ${isQuery ? "query" : "insight"} panel`}
        tabIndex={0}
        data-testid={`${panel}-resize-handle`}
        onPointerDown={(event) => handleResizePointerDown(panel, event)}
        onPointerMove={(event) => handleResizePointerMove(panel, event)}
        onPointerUp={finishResize}
        onPointerCancel={finishResize}
        onKeyDown={(event) => handleResizeKeyDown(panel, event)}
        style={{
          position: "relative",
          cursor: "col-resize",
          touchAction: "none",
          background: "var(--surface-1)",
          zIndex: 2,
        }}
      >
        <span
          aria-hidden="true"
          className="panel-resize-grip"
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            width: "22px",
            height: "28px",
            display: "grid",
            placeItems: "center",
            transform: "translate(-50%, -50%)",
            border: "1px solid var(--border-default)",
            borderRadius: "6px",
            background: "var(--surface-2)",
            color: "var(--text-secondary)",
            fontSize: "14px",
            fontWeight: 700,
            lineHeight: 1,
          }}
        >
          ↔
        </span>
      </div>
    );
  };

  return (
    <>
      {/* ── Desktop header (hidden on mobile) ───────────────────────────── */}
      <header
        data-testid="app-header"
        className="desktop-header"
        style={{
          display: "none",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 1rem",
          height: "52px",
          borderBottom: "1px solid var(--border-default)",
          background: "var(--surface-1)",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: "9px",
            fontWeight: 700,
            fontSize: "16px",
            color: "var(--text-primary)",
          }}
        >
          {/* ADR-0050: the mark is decorative here — the product name sits
              beside it as real text, so it must not be announced twice. */}
          <SkyToPorchMark size={26} />
          Sky to Porch
        </span>
        <HeaderControls onOpenAbout={() => setAboutOpen(true)} />
      </header>

      {/* ── Mobile header (hidden on desktop) ───────────────────────────── */}
      <header
        data-testid="mobile-header"
        className="mobile-header"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 1rem",
          height: "52px",
          borderBottom: "1px solid var(--border-default)",
          background: "var(--surface-1)",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            fontWeight: 700,
            fontSize: "15px",
            color: "var(--text-primary)",
          }}
        >
          <SkyToPorchMark size={23} />
          Sky to Porch
        </span>
        <HeaderControls onOpenAbout={() => setAboutOpen(true)} />
      </header>

      <AboutDialog open={aboutOpen} onRequestClose={() => setAboutOpen(false)} />

      {/* ── Single <main> ── skip link and keyboard navigation target ─────── */}
      <main
        id="main-content"
        tabIndex={-1}
        style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", outline: "none" }}
      >
        {/* Desktop three-area grid with two resize handles (hidden on mobile) */}
        <div
          ref={desktopShellRef}
          data-testid="desktop-shell"
          className="desktop-shell"
          style={{
            display: "none",
            flex: 1,
            gridTemplateColumns: `${desktopPanelWidths.query}px ${RESIZE_HANDLE_WIDTH}px minmax(${MAP_MIN_WIDTH}px, 1fr) ${RESIZE_HANDLE_WIDTH}px ${desktopPanelWidths.insight}px`,
            minHeight: 0,
          }}
        >
          {/* Query area */}
          <aside
            id="desktop-query-panel"
            aria-label="Query"
            style={{
              overflowY: "auto",
              background: "var(--surface-1)",
            }}
          >
            <GuidedQuery idPrefix="desktop-" />
          </aside>

          {renderResizeHandle("query")}

          {/* Map area — AnalysisMap (WP-04) */}
          <section
            aria-label="Map area"
            data-testid="map-area"
            style={{
              position: "relative",
              overflow: "hidden",
            }}
          >
            <AnalysisMap idPrefix="desktop-map-" />
          </section>

          {renderResizeHandle("insight")}

          {/* Insight area */}
          <aside
            id="desktop-insight-panel"
            aria-label="Insight"
            style={{
              overflowY: "auto",
              background: "var(--surface-1)",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <InsightNavigation idPrefix="desktop-" />
          </aside>
        </div>

        {/* Mobile views (hidden on desktop) */}
        <div
          data-testid="mobile-shell"
          className="mobile-shell"
          style={{
            display: "flex",
            flex: 1,
            flexDirection: "column",
            minHeight: 0,
          }}
        >
          {/* Mobile primary view content */}
          <div style={{ flex: 1, overflowY: "auto", background: "var(--canvas-bg)" }}>
            {mobileView === "ask" && (
              <section aria-label="Ask — guided query" data-testid="mobile-ask-view">
                <GuidedQuery idPrefix="mobile-" />
              </section>
            )}
            {mobileView === "map" && (
              <section
                aria-label="Map area"
                data-testid="mobile-map-view"
                style={{
                  position: "relative",
                  height: "100%",
                  minHeight: "300px",
                  overflow: "hidden",
                }}
              >
                <AnalysisMap idPrefix="mobile-map-" />
              </section>
            )}
            {mobileView === "insight" && (
              <section aria-label="Insight" data-testid="mobile-insight-view">
                <InsightNavigation idPrefix="mobile-insight-" />
              </section>
            )}
          </div>

          {/* Mobile bottom tab bar */}
          <nav
            aria-label="Primary navigation"
            style={{
              display: "flex",
              borderTop: "1px solid var(--border-default)",
              background: "var(--surface-1)",
              flexShrink: 0,
            }}
          >
            {MOBILE_VIEWS.map((v) => (
              <button
                key={v.id}
                type="button"
                aria-pressed={mobileView === v.id}
                aria-label={v.label}
                onClick={() => setMobileView(v.id)}
                data-testid={`mobile-nav-${v.id}`}
                style={{
                  flex: 1,
                  padding: "12px 0 10px",
                  fontSize: "14px",
                  fontWeight: mobileView === v.id ? 600 : 400,
                  border: "none",
                  borderTop: mobileView === v.id
                    ? "2px solid var(--text-link)"
                    : "2px solid transparent",
                  background: "transparent",
                  color: mobileView === v.id ? "var(--text-primary)" : "var(--text-secondary)",
                  cursor: "pointer",
                }}
              >
                {v.label}
              </button>
            ))}
          </nav>
        </div>
      </main>

      {/* ── Responsive CSS ─────────────────── */}
      <style>{`
        html, body { height: 100%; }
        body { display: flex; flex-direction: column; }
        @media (min-width: 1024px) {
          .desktop-header { display: flex !important; }
          .mobile-header  { display: none  !important; }
          .desktop-shell  { display: grid !important; }
          .mobile-shell   { display: none !important; }
        }
        .panel-resize-handle:hover .panel-resize-grip,
        .panel-resize-handle:focus-visible .panel-resize-grip {
          color: var(--text-link);
          border-color: var(--focus-ring);
          background: var(--surface-1);
        }
      `}</style>
    </>
  );
}
