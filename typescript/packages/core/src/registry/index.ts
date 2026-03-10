import { AssetRegistry } from "./assetRegistry.js";

export { AssetRegistry, convertMoney } from "./assetRegistry.js";
export type { AssetInfo } from "./assetRegistry.js";

/**
 * Global shared AssetRegistry instance with built-in token data.
 * Used by default in x402ResourceServer. Developers can register
 * custom tokens on this instance or create their own if isolation is needed.
 */
export const globalAssetRegistry = new AssetRegistry();
