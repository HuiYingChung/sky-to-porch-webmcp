import type { BoundingBox } from "@/contracts/common";
import { QUERY_AREA_MAX_SPAN_DEG, validateQueryArea } from "@/lib/location/query-area";

/**
 * Converts MapLibre's visible bounds to the bounded FIRMS query window.
 * Wide/world views are clipped around the visual centre instead of sending an
 * unbounded request. The map selection is not changed.
 */
export function boundedViewportArea(
  visible: BoundingBox,
  center: { lon: number; lat: number }
): BoundingBox {
  const halfWidth = Math.min((visible.east - visible.west) / 2, QUERY_AREA_MAX_SPAN_DEG / 2);
  const halfHeight = Math.min((visible.north - visible.south) / 2, QUERY_AREA_MAX_SPAN_DEG / 2);
  const safeHalfWidth = Math.max(0.0001, halfWidth);
  const safeHalfHeight = Math.max(0.0001, halfHeight);
  const normalizedCenterLon = ((((center.lon + 180) % 360) + 360) % 360) - 180;
  const boundedCenterLon = Math.min(180 - safeHalfWidth, Math.max(-180 + safeHalfWidth, normalizedCenterLon));
  const boundedCenterLat = Math.min(90 - safeHalfHeight, Math.max(-90 + safeHalfHeight, center.lat));
  return validateQueryArea({
    west: boundedCenterLon - safeHalfWidth,
    south: boundedCenterLat - safeHalfHeight,
    east: boundedCenterLon + safeHalfWidth,
    north: boundedCenterLat + safeHalfHeight,
  });
}
