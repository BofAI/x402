import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { EnvWalletProvider, type Wallet, type Eip712Capable } from "@bankofai/agent-wallet";
import { TronWeb, utils } from "tronweb";

export const NETWORK = "tron:3448148188";
export const TOKEN = "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf";
export const PERMIT2 = "TYQuuhGbEMxF7nZxUHV3uHJxAVVAegNU9h";
export const PROXY = "TFGoaq2KjizijgjtkVxT7yjffW1A5T1j6F";
export const MAX = (1n << 256n) - 1n;

export async function testWallet() {
  const provider = new EnvWalletProvider({
    network: NETWORK,
    env: { AGENT_WALLET_PRIVATE_KEY: randomBytes(32).toString("hex") },
  });
  const wallet = (await provider.getActiveWallet(NETWORK)) as Wallet & Eip712Capable;
  return { wallet, address: await wallet.getAddress() };
}

export function unsignedContract(body: Record<string, any>) {
  const tx: Record<string, any> = {
    visible: false,
    raw_data: {
      contract: [
        {
          type: "TriggerSmartContract",
          Permission_id: body.Permission_id ?? body.permission_id ?? 0,
          parameter: {
            type_url: "type.googleapis.com/protocol.TriggerSmartContract",
            value: {
              owner_address: body.owner_address,
              contract_address: body.contract_address,
              data: TronWeb.sha3(body.function_selector).slice(2, 10) + (body.parameter ?? ""),
              call_value: body.call_value ?? 0,
            },
          },
        },
      ],
      ref_block_bytes: "1234",
      ref_block_hash: "0102030405060708",
      timestamp: Date.now(),
      expiration: Date.now() + 60_000,
      fee_limit: body.fee_limit ?? 100_000_000,
    },
  };
  const pb = utils.transaction.txJsonToPb(tx as never);
  tx.raw_data_hex = utils.transaction.txPbToRawDataHex(pb);
  tx.txID = utils.transaction.txPbToTxID(pb).replace(/^0x/, "");
  return tx;
}

// Independent test-only envelope decoder; signed bytes are verified, never fabricated.
export function signedEnvelope(hex: string) {
  const bytes = Buffer.from(hex, "hex");
  let pos = 0;
  const readVarint = () => {
    let n = 0,
      shift = 0,
      b: number;
    do {
      b = bytes[pos++];
      n += (b & 127) * 2 ** shift;
      shift += 7;
    } while (b & 128);
    return n;
  };
  let raw = Buffer.alloc(0),
    signature = Buffer.alloc(0);
  while (pos < bytes.length) {
    const tag = readVarint();
    if ((tag & 7) !== 2) throw new Error("Unexpected test envelope field");
    const len = readVarint(),
      value = bytes.subarray(pos, pos + len);
    pos += len;
    if (tag >> 3 === 1) raw = value;
    if (tag >> 3 === 2) signature = value;
  }
  const txID = createHash("sha256").update(raw).digest("hex");
  return {
    rawDataHex: raw.toString("hex"),
    signature: signature.toString("hex"),
    txID,
    recovered: utils.crypto.ecRecover(txID, signature.toString("hex")),
  };
}

export async function localRpc() {
  const state = {
    allowance: 0n,
    permissions: true,
    receipt: "SUCCESS",
    broadcasts: [] as Record<string, any>[],
    requests: [] as string[],
  };
  const server = createServer(async (req, res) => {
    let body: Record<string, any> = {};
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
      const requestUrl = new URL(req.url ?? "/", "http://local-test.invalid");
      body = { ...Object.fromEntries(requestUrl.searchParams), ...body };
      const path = requestUrl.pathname;
      state.requests.push(path);
      let result: unknown;
      if (path === "/wallet/triggerconstantcontract") {
        const value = body.function_selector?.startsWith("allowance")
          ? state.allowance
          : 1_000_000_000n;
        result = {
          result: { result: true },
          constant_result: [value.toString(16).padStart(64, "0")],
        };
      } else if (path === "/wallet/triggersmartcontract")
        result = { result: { result: true }, transaction: unsignedContract(body) };
      else if (path === "/wallet/broadcasttransaction") {
        const signature = body.signature?.[0];
        if (
          !utils.transaction.txCheck(body as never) ||
          !signature ||
          !["00", "01"].includes(signature.slice(-2)) ||
          utils.crypto.ecRecover(body.txID, signature).toLowerCase() !==
            body.raw_data.contract[0].parameter.value.owner_address.toLowerCase()
        )
          throw new Error("Invalid signed transaction");
        state.broadcasts.push(body);
        if (body.raw_data.contract[0].parameter.value.data.startsWith("095ea7b3"))
          state.allowance = MAX;
        result = { result: true, txid: body.txID };
      } else if (path === "/wallet/broadcasthex") {
        const signed = signedEnvelope(body.transaction);
        state.broadcasts.push({
          txID: signed.txID,
          signature: [signed.signature],
          signedHex: body.transaction,
        });
        result = { result: true, txid: signed.txID, transaction: "{}" };
      } else if (
        path === "/wallet/gettransactioninfobyid" ||
        path === "/walletsolidity/gettransactioninfobyid"
      )
        result = { id: body.value, blockNumber: 100, receipt: { result: state.receipt } };
      else if (path === "/wallet/getaccount" || path === "/walletsolidity/getaccount")
        result = {
          address: body.address,
          type: 0,
          active_permission: state.permissions
            ? [{ id: 2, operations: "00".repeat(7) + "06" + "00".repeat(24) }]
            : [],
        };
      else if (path === "/wallet/getblock" || path === "/wallet/getnowblock")
        result = {
          blockID: "0".repeat(16) + "0102030405060708" + "0".repeat(32),
          block_header: { raw_data: { number: 0x1234, timestamp: Date.now() } },
        };
      else throw new Error(`Unsupported local test RPC ${path}`);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (error) {
      res.writeHead(400);
      res.end(
        JSON.stringify({ Error: error instanceof Error ? error.message : "Test RPC failed" }),
      );
    }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  return {
    state,
    url: `http://127.0.0.1:${port}`,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}
