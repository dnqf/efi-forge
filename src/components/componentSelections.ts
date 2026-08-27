import type {
  ComponentAction,
  ComponentItem,
  ComponentSelection,
} from "../native/efiBuilder";

export function createDefaultComponentActions(
  items: ComponentItem[],
): Record<string, ComponentAction> {
  return Object.fromEntries(items.map((item) => [item.id, item.defaultAction]));
}

export function createComponentSelections(
  items: ComponentItem[],
  actions: Record<string, ComponentAction>,
): ComponentSelection[] {
  return items.map((item) => ({
    itemId: item.id,
    action: actions[item.id] ?? item.defaultAction,
  }));
}
