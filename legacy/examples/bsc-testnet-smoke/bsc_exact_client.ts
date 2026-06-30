import {
  X402Client,
  X402FetchClient,
  ExactPermitEvmClientMechanism,
  ExactEvmClientMechanism,
  EvmClientSigner,
  SufficientBalancePolicy,
  type SettleResponse,
  decodePaymentPayload,
} from '../../typescript/packages/x402/dist/index.js';
import { createWalletClient, http, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { bscTestnet } from 'viem/chains';

type LocalWallet = {
  getAddress(): Promise<string>;
  signMessage(msg: Uint8Array): Promise<string>;
  signTypedData(data: Record<string, unknown>): Promise<string>;
  signTransaction(payload: Record<string, unknown>): Promise<string>;
};

function createLocalWallet(privateKey: Hex): LocalWallet {
  const account = privateKeyToAccount(privateKey);
  return {
    async getAddress() {
      return account.address;
    },
    async signMessage(msg: Uint8Array) {
      return account.signMessage({ message: { raw: msg } });
    },
    async signTypedData(data: Record<string, unknown>) {
      const { domain, types, primaryType, message } = data as {
        domain: Record<string, unknown>;
        types: Record<string, unknown>;
        primaryType: string;
        message: Record<string, unknown>;
      };
      const normalizedTypes = { ...types } as Record<string, unknown>;
      delete normalizedTypes.EIP712Domain;
      return account.signTypedData({
        domain: domain as any,
        types: normalizedTypes as any,
        primaryType: primaryType as any,
        message: message as any,
      });
    },
    async signTransaction(payload: Record<string, unknown>) {
      const client = createWalletClient({
        account,
        chain: bscTestnet,
        transport: http(process.env.BSC_TESTNET_RPC_URL ?? 'https://data-seed-prebsc-1-s1.binance.org:8545'),
      });
      const signed = await client.signTransaction(payload as any);
      return signed.replace(/^0x/, '');
    },
  };
}

async function main() {
  const privateKey = process.env.BSC_CLIENT_PRIVATE_KEY as Hex;
  const serverUrl = process.env.SERVER_URL ?? 'http://127.0.0.1:8012';
  const endpoint = process.env.ENDPOINT ?? '/protected-bsc-testnet-coinbase';

  const wallet = createLocalWallet(privateKey);
  const signer = new EvmClientSigner(wallet);
  signer.setAddress(await wallet.getAddress());

  const x402 = new X402Client();
  x402.register('eip155:97', new ExactPermitEvmClientMechanism(signer));
  x402.register('eip155:97', new ExactEvmClientMechanism(signer));
  x402.registerPolicy(SufficientBalancePolicy);

  const client = new X402FetchClient(x402);
  const response = await client.get(`${serverUrl}${endpoint}`);
  console.log(response.status, response.statusText);

  const paymentHeader = response.headers.get('payment-response');
  if (paymentHeader) {
    const settle = decodePaymentPayload<SettleResponse>(paymentHeader);
    console.log(settle);
  }

  console.log(await response.text());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
