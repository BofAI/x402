import { utils as tronUtils } from "tronweb";
import { PERMIT2_ADDRESSES, erc20AllowanceAbi } from "../../constants";

const MAX_UINT256 = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");

/**
 * Creates transaction data to approve Permit2 to spend TRC-20 tokens.
 * The user sends this transaction before using the Permit2 flow.
 *
 * @param tokenAddress - The TRC-20 token contract address.
 * @param network - The CAIP-2 network identifier.
 * @returns The transaction target and calldata for the approval.
 */
export function createPermit2ApprovalTx(
  tokenAddress: string,
  network: string,
): {
  to: string;
  data: string;
} {
  const permit2Address = PERMIT2_ADDRESSES[network];
  if (!permit2Address) {
    throw new Error(`No Permit2 contract address configured for network ${network}`);
  }

  const selector = tronUtils.ethersUtils.id("approve(address,uint256)").slice(2, 10);
  const encodedArgs = tronUtils.abi.encodeParams(
    ["address", "uint256"],
    [permit2Address, MAX_UINT256.toString()],
  );
  const data = `${selector}${encodedArgs.replace(/^0x/, "")}`;

  return {
    to: tokenAddress,
    data,
  };
}

export interface Permit2AllowanceParams {
  tokenAddress: string;
  ownerAddress: string;
  network: string;
}

/**
 * Returns contract read parameters for checking Permit2 allowance on TRON.
 *
 * @param params - The token, owner, and network parameters used to read allowance.
 * @returns A readContract-compatible allowance query.
 */
export function getPermit2AllowanceReadParams(params: Permit2AllowanceParams): {
  address: string;
  abi: typeof erc20AllowanceAbi;
  functionName: "allowance";
  args: readonly [string, string];
} {
  const permit2Address = PERMIT2_ADDRESSES[params.network];
  if (!permit2Address) {
    throw new Error(`No Permit2 contract address configured for network ${params.network}`);
  }

  return {
    address: params.tokenAddress,
    abi: erc20AllowanceAbi,
    functionName: "allowance",
    args: [params.ownerAddress, permit2Address] as const,
  };
}
