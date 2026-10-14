// Geometry shared by the floating bar and the four tab scroll containers.
// The pinned pill is 40-point controls + two 9-point pads + two 1-point borders.
// Each control also has 6 points of hit slop around its visual bounds.
export const TAB_BAR_ITEM_HEIGHT = 40;
export const TAB_BAR_PILL_VERTICAL_PADDING = 9;
export const TAB_BAR_PILL_BORDER = 1;
export const TAB_BAR_PILL_HEIGHT =
  TAB_BAR_ITEM_HEIGHT + 2 * TAB_BAR_PILL_VERTICAL_PADDING + 2 * TAB_BAR_PILL_BORDER;

export function tabBarBottomOffset(insetBottom) {
  const safeBottom = Number.isFinite(insetBottom) ? insetBottom : 0;
  return Math.max(safeBottom, 8) + 4;
}

export function tabBarScrollClearance(insetBottom) {
  // The last focusable row can scroll 16 points above the pill's top edge.
  return TAB_BAR_PILL_HEIGHT + tabBarBottomOffset(insetBottom) + 16;
}
