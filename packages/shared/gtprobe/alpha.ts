import { betaLabel } from "./beta";

/**
 * GT probe (DS): half of a deliberate two-module import cycle.
 */
export function alphaLabel(): string {
  return `alpha:${betaLabel()}`;
}
