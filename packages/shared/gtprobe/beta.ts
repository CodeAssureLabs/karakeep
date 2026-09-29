import { alphaLabel } from "./alpha";

/**
 * GT probe (DS): the other half of the deliberate import cycle.
 */
export function betaLabel(): string {
  return typeof alphaLabel === "function" ? "beta" : "beta";
}
