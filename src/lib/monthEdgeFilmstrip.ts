/** Pure geometry, window and gesture primitives for the edge filmstrip rail.
 * No DOM access and no persistence: every value derives from explicit arguments.
 */

export const EDGE_ARC_SLOTS = 5;
export const EDGE_HIT_SIZE = 44;
export const EDGE_SLOT_REGION = EDGE_ARC_SLOTS * EDGE_HIT_SIZE;
export const EDGE_TAB_HEIGHT = 44;
export const EDGE_RAIL_HEIGHT = EDGE_SLOT_REGION + EDGE_TAB_HEIGHT;
export const EDGE_IDLE_WIDTH = 56;
export const EDGE_PREVIEW_MAX = 200;
export const EDGE_PREVIEW_MIN = 96;
export const EDGE_GUTTER_GAP = 8;

export type RailDirection = 'next' | 'previous';

export interface ArcGeometry {
  /** Width of the visible crescent; also the box width in local coordinates. */
  bulge: number;
  /** Circle centre x in local coordinates: always beyond `bulge`, i.e. off-canvas. */
  centerX: number;
  radius: number;
  /** Visible arc span in radians, strictly less than a half circle. */
  span: number;
}

export interface RailSlot { index: number; top: number; height: number }
export interface BlockedBand { top: number; bottom: number }
export interface RailWheelState { total: number; lastTime: number | null; fired: boolean }
export interface RailWheelInput { deltaY: number; deltaX?: number; deltaMode?: number; ctrlKey?: boolean; timeStamp: number }

/** Local, viewport-independent crescent. The circle centre sits at `centerX`, which is
 * always to the right of the drawn box, so only a shallow cap of the circle is on screen —
 * a partial arc beside the edge, never a complete sun.
 */
export function arcShape(region: number = EDGE_SLOT_REGION, bulge: number = EDGE_IDLE_WIDTH): ArcGeometry {
  const height = Number.isFinite(region) && region > 0 ? region : EDGE_SLOT_REGION;
  const inset = Number.isFinite(bulge) && bulge > 0 ? bulge : EDGE_IDLE_WIDTH;
  const radius = Math.max(height, Math.round(height * 1.1));
  return {
    bulge: inset,
    centerX: radius,
    radius,
    span: 2 * Math.asin(Math.min(0.9, height / 2 / radius)),
  };
}

/** Horizontal offset inside the box for a tick at vertical `offset` from the arc centre.
 * Zero at the apex (the box's inner edge), growing toward the viewport edge away from it.
 */
export function arcX(offset: number, geometry: ArcGeometry): number {
  const y = Number.isFinite(offset) ? offset : 0;
  const reach = Math.sqrt(Math.max(0, geometry.radius * geometry.radius - y * y));
  return Math.max(0, geometry.centerX - reach);
}

/** How many disjoint 44px targets fit in the arc region; a thin tick never means a thin target. */
export function slotCountFor(region: number = EDGE_SLOT_REGION): number {
  const height = Number.isFinite(region) && region > 0 ? region : EDGE_SLOT_REGION;
  return Math.max(1, Math.min(EDGE_ARC_SLOTS, Math.floor(height / EDGE_HIT_SIZE)));
}

export function hitSlots(count: number, region: number = EDGE_SLOT_REGION): RailSlot[] {
  const total = Math.max(0, Math.min(EDGE_ARC_SLOTS, Math.trunc(Number.isFinite(count) ? count : 0)));
  if (!total) return [];
  const base = Number.isFinite(region) && region > 0 ? region : EDGE_SLOT_REGION;
  const height = Math.max(total * EDGE_HIT_SIZE, base);
  const size = height / total;
  return Array.from({ length: total }, (_, index) => ({ index, top: index * size, height: size }));
}

/** Vertical offset of a slot's centre from the arc centre. */
export function slotOffset(slot: RailSlot, region: number = EDGE_SLOT_REGION): number {
  const height = Number.isFinite(region) && region > 0 ? region : EDGE_SLOT_REGION;
  return slot.top + slot.height / 2 - height / 2;
}

/** Chronological indexes of the rendered window, clamped and capped at the slot count. */
export function windowIndexes(total: number, active: number, slots: number = EDGE_ARC_SLOTS): number[] {
  const size = Math.max(0, Math.trunc(Number.isFinite(total) ? total : 0));
  if (!size) return [];
  const width = Math.min(Math.max(1, Math.trunc(Number.isFinite(slots) ? slots : EDGE_ARC_SLOTS)), size);
  const center = Math.trunc(Number.isFinite(active) ? active : 0);
  const start = Math.min(size - width, Math.max(0, center - Math.floor(width / 2)));
  return Array.from({ length: width }, (_, offset) => start + offset);
}

/** One chronological step; crossing a loaded page edge asks for the bounded cursor page. */
export function railStep(active: number, total: number, delta: number, hasNext: boolean, hasPrev: boolean): { index: number; page: RailDirection | null } {
  const size = Math.max(0, Math.trunc(Number.isFinite(total) ? total : 0));
  if (!size) return { index: 0, page: null };
  const current = Math.min(Math.max(0, Math.trunc(Number.isFinite(active) ? active : 0)), size - 1);
  const next = current + (Number.isFinite(delta) ? Math.trunc(delta) : 0);
  if (next < 0) return { index: 0, page: hasPrev ? 'previous' : null };
  if (next > size - 1) return { index: size - 1, page: hasNext ? 'next' : null };
  return { index: next, page: null };
}

export function initialRailWheel(): RailWheelState { return { total: 0, lastTime: null, fired: false }; }

/** Vertical wheel only: horizontal and pinch gestures pass through untouched. */
export function accumulateRailWheel(
  state: RailWheelState,
  input: RailWheelInput,
  options: { threshold?: number; idleMs?: number; pagePixels?: number } = {},
): { state: RailWheelState; step: -1 | 0 | 1; handled: boolean; direction: -1 | 0 | 1 } {
  if (input.ctrlKey || !Number.isFinite(input.deltaY) || !Number.isFinite(input.timeStamp) || input.deltaY === 0 || Math.abs(input.deltaX ?? 0) > Math.abs(input.deltaY)) {
    return { state, step: 0, handled: false, direction: 0 };
  }
  const threshold = Math.max(1, options.threshold ?? 80);
  const idleMs = Math.max(0, options.idleMs ?? 180);
  const fresh = state.lastTime === null || input.timeStamp - state.lastTime >= idleMs || input.timeStamp < state.lastTime;
  const previous = fresh ? initialRailWheel() : state;
  const factor = input.deltaMode === 1 ? 16 : input.deltaMode === 2 ? (options.pagePixels ?? 800) : 1;
  const total = previous.total + input.deltaY * factor;
  const step = !previous.fired && Math.abs(total) >= threshold ? (total > 0 ? 1 : -1) : 0;
  return {
    state: { total, lastTime: input.timeStamp, fired: previous.fired || step !== 0 },
    step,
    handled: true,
    direction: total > 0 ? 1 : total < 0 ? -1 : 0,
  };
}

/** Vertical placement avoiding known overlay bands; null when nothing fits safely. */
export function placeRail({ viewportHeight, railHeight = EDGE_RAIL_HEIGHT, blocked = [], margin = 8 }: { viewportHeight: number; railHeight?: number; blocked?: BlockedBand[]; margin?: number }): number | null {
  const viewport = Number.isFinite(viewportHeight) ? Math.max(0, viewportHeight) : 0;
  const height = Number.isFinite(railHeight) && railHeight > 0 ? railHeight : EDGE_RAIL_HEIGHT;
  const lowest = viewport - height - margin;
  if (lowest < margin) return null;
  const preferred = Math.min(lowest, Math.max(margin, Math.round((viewport - height) / 2)));
  for (const shift of [0, -48, 48, -96, 96, -144, 144, -192, 192, -240, 240]) {
    const top = preferred + shift;
    if (top < margin || top > lowest) continue;
    if (blocked.every((band) => band.bottom <= top + 4 || band.top >= top + height - 4)) return top;
  }
  return null;
}

/** Preview width for the free gutter between the content edge and the viewport edge.
 * The preview sits inside that gutter, left of the rail; `null` means no safe frame,
 * so the caller keeps the compact entry instead of covering content.
 */
export function previewWidthFor(gutter: number): number | null {
  const room = Math.floor(Number.isFinite(gutter) ? gutter : 0) - EDGE_IDLE_WIDTH - EDGE_GUTTER_GAP;
  if (room < EDGE_PREVIEW_MIN) return null;
  return Math.min(EDGE_PREVIEW_MAX, room);
}

/** Open stroke arc: only the sliver of the circle that fits inside the box is drawn.
 * An open path cannot become a closed circle, so the widget cannot read as a full sun.
 */
export function arcPath(geometry: ArcGeometry, region: number = EDGE_SLOT_REGION): string {
  const height = Number.isFinite(region) && region > 0 ? region : EDGE_SLOT_REGION;
  const cy = height / 2;
  const half = geometry.span / 2;
  const point = (angle: number) =>
    `${(geometry.centerX - geometry.radius * Math.cos(angle)).toFixed(2)} ${(cy + geometry.radius * Math.sin(angle)).toFixed(2)}`;
  return `M ${point(-half)} A ${geometry.radius} ${geometry.radius} 0 0 1 ${point(half)}`;
}

/** A short radial tick at `offset` from the arc centre, pointing toward the viewport edge. */
export function tickLine(offset: number, geometry: ArcGeometry, region: number = EDGE_SLOT_REGION, depth: number = 7): { x1: number; y1: number; x2: number; y2: number } {
  const height = Number.isFinite(region) && region > 0 ? region : EDGE_SLOT_REGION;
  const y = height / 2 + (Number.isFinite(offset) ? offset : 0);
  const x1 = arcX(offset, geometry);
  return { x1, y1: y, x2: Math.min(geometry.bulge - 1, x1 + Math.max(1, depth)), y2: y };
}

export function railTickLabel(item: { date: string | null; title: string }, ordinal: number, total: number): string {
  return `Memory ${ordinal} of ${total}: ${item.date || 'Undated'} · ${item.title || 'Untitled memory'}`;
}

export function railMonthLabel(month: string): string {
  if (!/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(month)) return 'Undated';
  const date = new Date(`${month}-01T12:00:00`);
  const short = new Intl.DateTimeFormat(undefined, { month: 'short' }).format(date);
  return `${short} ${month.slice(0, 4)}`;
}