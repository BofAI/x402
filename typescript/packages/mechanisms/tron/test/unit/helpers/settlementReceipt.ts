import { utils as tronUtils } from "tronweb";
import type { FacilitatorTronSigner, TronTransactionReceipt } from "../../../src/signer";
import { normalizeAddressForSigning } from "../../../src/utils";

const TRANSFER_TOPIC = "ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

type ContractWrite = Parameters<FacilitatorTronSigner["writeContract"]>[0];

/** Build a realistic successful receipt from the contract write submitted by a test signer. */
export function successfulSettlementReceipt(write: ContractWrite): TronTransactionReceipt {
  const iface = new tronUtils.ethersUtils.Interface(write.abi);
  const target = normalizeAddressForSigning(write.address);

  let token: string;
  let from: string;
  let to: string;
  let amount: bigint;
  let encodedArgs: readonly unknown[];

  if (write.functionName === "transferWithAuthorization") {
    token = target;
    from = normalizeAddressForSigning(String(write.args[0]));
    to = normalizeAddressForSigning(String(write.args[1]));
    amount = BigInt(write.args[2] as bigint | string | number);
    encodedArgs = [from, to, ...write.args.slice(2)];
  } else if (write.functionName === "settle" && write.args.length === 4) {
    const permit = write.args[0] as readonly [readonly [string, bigint], bigint, bigint];
    const witness = write.args[2] as readonly [string, bigint];
    token = normalizeAddressForSigning(permit[0][0]);
    from = normalizeAddressForSigning(String(write.args[1]));
    to = normalizeAddressForSigning(witness[0]);
    amount = BigInt(permit[0][1]);
    encodedArgs = [
      [[token, permit[0][1]], permit[1], permit[2]],
      from,
      [to, witness[1]],
      write.args[3],
    ];
  } else if (write.functionName === "settle" && write.args.length === 5) {
    const permit = write.args[0] as readonly [readonly [string, bigint], bigint, bigint];
    const witness = write.args[3] as readonly [string, string, bigint];
    token = normalizeAddressForSigning(permit[0][0]);
    from = normalizeAddressForSigning(String(write.args[2]));
    to = normalizeAddressForSigning(witness[0]);
    amount = BigInt(write.args[1] as bigint | string | number);
    encodedArgs = [
      [[token, permit[0][1]], permit[1], permit[2]],
      write.args[1],
      from,
      [to, normalizeAddressForSigning(witness[1]), witness[2]],
      write.args[4],
    ];
  } else if (write.functionName === "deposit" && write.args.length === 4) {
    const config = write.args[0] as readonly [string, string, string, string, string];
    token = normalizeAddressForSigning(config[4]);
    from = normalizeAddressForSigning(config[0]);
    to = target;
    amount = BigInt(write.args[1] as bigint | string | number);
    encodedArgs = write.args;
  } else {
    throw new Error(`unsupported settlement test call: ${write.functionName}/${write.args.length}`);
  }
  const data = iface.encodeFunctionData(write.functionName, [...encodedArgs]).replace(/^0x/, "");

  return {
    status: "success",
    finality: "packed",
    call: { contractAddress: `41${target.slice(2)}`, data },
    logs: [
      {
        address: token.slice(2),
        topics: [TRANSFER_TOPIC, from.slice(2).padStart(64, "0"), to.slice(2).padStart(64, "0")],
        data: amount.toString(16).padStart(64, "0"),
      },
    ],
  };
}
