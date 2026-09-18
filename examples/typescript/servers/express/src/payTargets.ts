import { tronNetworksEqual } from "@bankofai/x402-tron";

/**
 * Filters configured networks using the optional PAY_TARGETS selection shared
 * with the exact client example. A namespace-only target (for example
 * `eip155`) selects every configured network in that namespace.
 *
 * When PAY_TARGETS is unset, every configured network remains enabled.
 */
export function selectPayTargetNetworks<T extends string>(
  networks: readonly T[],
): T[] {
  const rawTargets = process.env.PAY_TARGETS?.trim();
  if (!rawTargets) return [...networks];

  const targets = rawTargets
    .split(",")
    .map((target) => target.trim().split("@", 1)[0])
    .filter((target): target is string => Boolean(target));

  return networks.filter((network) => {
    const namespace = network.split(":", 1)[0];
    return targets.some((target) => {
      if (target === namespace || target === `${namespace}:`) return true;
      if (namespace === "tron" && target.startsWith("tron:")) {
        return tronNetworksEqual(network, target);
      }
      return target === network;
    });
  });
}
