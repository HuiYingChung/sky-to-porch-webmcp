"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";

interface Point {
  x: number;
  y: number;
}

interface DragState {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  origin: Point;
}

interface DraggableMapCardProps {
  children: ReactNode;
  initiallyCollapsed?: boolean;
  initialStyle?: CSSProperties;
  testId: string;
  title: string;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

/** Draggable, collapsible map card constrained to its overlay container. */
export function DraggableMapCard({
  children,
  initiallyCollapsed = false,
  initialStyle,
  testId,
  title,
}: DraggableMapCardProps) {
  const [collapsed, setCollapsed] = useState(initiallyCollapsed);
  const [position, setPosition] = useState<Point | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const contentId = useId();

  const cardPoint = useCallback((): Point => {
    const card = cardRef.current;
    const parent = card?.parentElement;
    if (!card || !parent) return position ?? { x: 0, y: 0 };
    const cardBox = card.getBoundingClientRect();
    const parentBox = parent.getBoundingClientRect();
    return { x: cardBox.left - parentBox.left, y: cardBox.top - parentBox.top };
  }, [position]);

  const boundedPoint = useCallback((next: Point): Point => {
    const card = cardRef.current;
    const parent = card?.parentElement;
    if (!card || !parent) return next;
    const cardBox = card.getBoundingClientRect();
    const parentBox = parent.getBoundingClientRect();
    return {
      x: clamp(next.x, 0, parentBox.width - cardBox.width),
      y: clamp(next.y, 0, parentBox.height - cardBox.height),
    };
  }, []);

  const moveTo = useCallback((next: Point) => {
    setPosition(boundedPoint(next));
  }, [boundedPoint]);

  useLayoutEffect(() => {
    setPosition((current) => {
      if (!current) return current;
      const next = boundedPoint(current);
      return next.x === current.x && next.y === current.y ? current : next;
    });
  }, [collapsed, boundedPoint]);

  useEffect(() => {
    function handleResize() {
      setPosition((current) => current ? boundedPoint(current) : current);
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [boundedPoint]);

  function handlePointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    const origin = cardPoint();
    setPosition(boundedPoint(origin));
    dragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      origin,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  }

  function handlePointerMove(event: PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    moveTo({
      x: drag.origin.x + event.clientX - drag.startClientX,
      y: drag.origin.y + event.clientY - drag.startClientY,
    });
    event.preventDefault();
    event.stopPropagation();
  }

  function endPointerDrag(event: PointerEvent<HTMLButtonElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    event.stopPropagation();
  }

  function handleMoveKey(event: KeyboardEvent<HTMLButtonElement>) {
    const delta = event.shiftKey ? 24 : 10;
    const current = cardPoint();
    let next: Point | null = null;
    if (event.key === "ArrowLeft") next = { x: current.x - delta, y: current.y };
    if (event.key === "ArrowRight") next = { x: current.x + delta, y: current.y };
    if (event.key === "ArrowUp") next = { x: current.x, y: current.y - delta };
    if (event.key === "ArrowDown") next = { x: current.x, y: current.y + delta };
    if (!next) return;
    moveTo(next);
    event.preventDefault();
    event.stopPropagation();
  }

  return (
    <div
      ref={cardRef}
      data-testid={testId}
      data-positioned={position ? "true" : "false"}
      style={{
        ...initialStyle,
        ...(position
          ? {
              position: "absolute",
              inset: "auto",
              left: 0,
              top: 0,
              margin: 0,
              transform: `translate(${position.x}px, ${position.y}px)`,
            }
          : { position: "relative" }),
        maxWidth: "100%",
        maxHeight: "100%",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        background: "var(--surface-1)",
        border: "1px solid var(--border-default)",
        borderRadius: "6px",
        opacity: 0.96,
        pointerEvents: "auto",
        boxShadow: "0 2px 8px rgba(0, 0, 0, 0.18)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "stretch",
          minHeight: "38px",
          borderBottom: collapsed ? "none" : "1px solid var(--border-subtle)",
        }}
      >
        <button
          type="button"
          data-testid={`${testId}-drag-handle`}
          aria-label={`Move ${title} card. Use drag or arrow keys.`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endPointerDrag}
          onPointerCancel={endPointerDrag}
          onKeyDown={handleMoveKey}
          style={{
            flex: 1,
            minWidth: 0,
            padding: "8px 10px",
            border: 0,
            background: "transparent",
            color: "var(--text-primary)",
            font: "inherit",
            fontSize: "14px",
            fontWeight: 700,
            textAlign: "left",
            cursor: "grab",
            touchAction: "none",
          }}
        >
          <span aria-hidden="true" style={{ marginRight: "6px" }}>⠿</span>
          {title}
        </button>
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-controls={contentId}
          aria-label={`${collapsed ? "Expand" : "Collapse"} ${title}`}
          data-testid={`${testId}-collapse-toggle`}
          onClick={(event) => {
            setCollapsed((current) => !current);
            event.stopPropagation();
          }}
          style={{
            width: "38px",
            border: 0,
            borderInlineStart: "1px solid var(--border-subtle)",
            background: "transparent",
            color: "var(--text-secondary)",
            fontSize: "16px",
            cursor: "pointer",
          }}
        >
          <span aria-hidden="true">{collapsed ? "▸" : "▾"}</span>
        </button>
      </div>
      <div
        id={contentId}
        hidden={collapsed}
        data-testid={`${testId}-content`}
        style={{ minHeight: 0, overflowY: "auto", padding: "10px" }}
      >
        {children}
      </div>
    </div>
  );
}
