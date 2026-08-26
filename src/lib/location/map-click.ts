/** Hotspot interaction is inspection-only and must never replace query location. */
export function shouldSelectMapClick(
  defaultPrevented: boolean,
  renderedHotspotCount: number
): boolean {
  return !defaultPrevented && renderedHotspotCount === 0;
}
