/**
 * `x402 transfer` — direct gas-free transfer.
 *
 * The CLI builds PaymentRequirements locally, runs them through the SDK's
 * X402Client + ExactGasFreeClientMechanism (which signs TIP-712 and produces a
 * full PaymentPermit), then submits the permit straight to the BankofAI
 * GasFree proxy via `GasFreeAPIClient.submit`. We do NOT route through the
 * facilitator's `/fee/quote` / `/verify` / `/settle` HTTP surface — the hosted
 * BankofAI endpoint at `facilitator.bankofai.io/<network>` is the GasFree
 * proxy only; the full facilitator surface lives in `examples/facilitator/`
 * for e2e and is not what we want CLI users to depend on.
 *
 * MVP scope: TRON `exact_gasfree`. The signing path goes through
 * `TronClientSigner.create()`, which means @bankofai/agent-wallet's
 * resolveWalletProvider must find a wallet via TRON_PRIVATE_KEY (D1).
 */

import {
  X402Client,
  TronClientSigner,
  GasFreeAPIClient,
  getChainId,
  getGasFreeControllerAddress,
  type PaymentRequirements,
  type PaymentPermitContext,
  type PaymentPayload,
  type PaymentPermit,
} from '@bankofai/x402';
import { TronWeb } from 'tronweb';
import { runCommand, type OutputMode } from '../output.js';
import { loadConfig, getProfile, applyEnvOverrides } from '../config.js';
import { getFacilitatorBaseUrl } from '../facilitator.js';
import { X402CliError } from '../error.js';
import {
  resolveToken,
  parseHumanAmount,
  formatSmallestUnit,
  newPaymentId,
  type ResolvedToken,
} from '../amount.js';
import { appendReceipt, type Receipt } from '../receipts.js';

const RESOURCE_PSEUDO_URI = 'cli://transfer';

export interface TransferOpts {
  to: string;
  amount: string;
  token?: string;
  asset?: string;
  decimals?: number;
  network?: string;
  scheme?: string;
  profile?: string;
  validForSeconds?: number;
  paymentId?: string;
  dryRun?: boolean;
  yes?: boolean;
  output: OutputMode;
}

export async function cmdTransfer(opts: TransferOpts): Promise<number> {
  return runCommand({ command: 'transfer' }, opts.output, async () => {
    const cfg = await loadConfig();
    const { name: profileName, profile } = getProfile(cfg, opts.profile);
    const effective = applyEnvOverrides(profile);
    const network = opts.network || effective.network;
    const scheme = opts.scheme || effective.scheme;

    if (scheme !== 'exact_gasfree') {
      throw new X402CliError(
        'UNSUPPORTED_SCHEME',
        `transfer currently supports scheme=exact_gasfree only; got '${scheme}'.`,
        `Drop --scheme or pin the profile to exact_gasfree until other schemes ship.`,
      );
    }
    if (!network.startsWith('tron:')) {
      throw new X402CliError(
        'UNSUPPORTED_NETWORK',
        `transfer with exact_gasfree requires a tron:* network; got '${network}'.`,
      );
    }

    const tokenSymbol = opts.token || effective.token;
    const token = resolveToken({
      network,
      symbol: tokenSymbol,
      asset: opts.asset,
      decimals: opts.decimals,
    });
    const amountSmallest = parseHumanAmount(opts.amount, token.decimals);
    const amountStr = amountSmallest.toString();

    if (!opts.to || !opts.to.trim()) {
      throw new X402CliError('INVALID_INPUT', `--to <address> is required.`);
    }

    const requirements: PaymentRequirements = {
      scheme,
      network,
      amount: amountStr,
      asset: token.address,
      payTo: opts.to.trim(),
      maxTimeoutSeconds: 180,
      extra: {
        name: token.name,
        version: token.version,
      },
    };

    const facilitatorUrl = getFacilitatorBaseUrl(network);
    const gasFreeClient = new GasFreeAPIClient(facilitatorUrl);

    // PaymentPermitContext seed: paymentId (16 random bytes) + validAfter (now-5).
    // The mechanism overwrites nonce from the GasFree API and clamps validBefore
    // to the network deadline window.
    const paymentId = opts.paymentId?.trim() || newPaymentId();
    const now = Math.floor(Date.now() / 1000);
    const paymentPermitContext: PaymentPermitContext = {
      meta: {
        kind: 'PAYMENT_ONLY',
        paymentId,
        nonce: '0',
        validAfter: now - 5,
        validBefore: opts.validForSeconds ? now + opts.validForSeconds : 0,
      },
    };

    if (opts.dryRun) {
      const accountInfo = await gasFreeClient.getAddressInfo(
        await tempSignerAddressForDryRun(profile.wallet.network),
      );
      return buildDryRunResult(
        profileName,
        network,
        scheme,
        token,
        requirements,
        paymentPermitContext,
        facilitatorUrl,
        accountInfo,
      );
    }

    // Sign + build the permit (this is where TIP-712 happens).
    const signer = await TronClientSigner.create();
    const x402 = new X402Client();
    x402.registerGasFree(signer, { [network]: gasFreeClient });

    const payload = await x402.createPaymentPayload(requirements, RESOURCE_PSEUDO_URI, {
      paymentPermitContext,
    });
    const permit = (payload as PaymentPayload).payload.paymentPermit;
    if (!permit) {
      throw new X402CliError(
        'SETTLE_FAILED',
        'createPaymentPayload returned without a paymentPermit; cannot submit GasFree settlement.',
      );
    }
    const signature = (payload as PaymentPayload).payload.signature;

    // Submit straight to GasFree.
    const { domain, message } = buildGasFreeSubmitBody(network, permit);
    let traceId: string;
    try {
      traceId = await gasFreeClient.submit(domain, message, signature);
    } catch (err) {
      throw new X402CliError(
        'SETTLE_FAILED',
        `GasFree submit failed: ${(err as Error).message}`,
      );
    }
    let resultData;
    try {
      resultData = await gasFreeClient.waitForSuccess(traceId);
    } catch (err) {
      throw new X402CliError(
        'SETTLE_FAILED',
        `GasFree settlement timed out / failed: ${(err as Error).message}`,
      );
    }
    const txnHash = resultData.txnHash;
    if (!txnHash) {
      throw new X402CliError(
        'SETTLE_FAILED',
        `GasFree polling returned ${resultData.state} but txnHash was empty.`,
      );
    }

    // Receipt.
    const payer = signer.getAddress();
    const receipt: Receipt = {
      paymentId,
      command: 'transfer',
      createdAt: new Date().toISOString(),
      profile: profileName,
      network,
      scheme,
      payer,
      payTo: requirements.payTo,
      token: token.symbol,
      asset: token.address,
      amount: amountStr,
      amountDisplay: `${formatSmallestUnit(amountSmallest, token.decimals)} ${token.symbol}`,
      feeAmount: permit.fee.feeAmount,
      settlement: {
        success: true,
        transaction: txnHash,
      },
      extra: {
        traceId,
        gasFreeAddress: permit.buyer,
        serviceProvider: permit.fee.feeTo,
        deadline: permit.meta.validBefore,
      },
    };
    const receiptPath = await appendReceipt(receipt);

    return {
      paymentId,
      payer,
      payTo: requirements.payTo,
      token: token.symbol,
      asset: token.address,
      amount: amountStr,
      amountDisplay: `${formatSmallestUnit(amountSmallest, token.decimals)} ${token.symbol}`,
      feeAmount: permit.fee.feeAmount,
      transaction: txnHash,
      traceId,
      gasFreeProvider: permit.fee.feeTo,
      receiptPath,
    };
  });
}

function buildGasFreeSubmitBody(network: string, permit: PaymentPermit) {
  const chainId = getChainId(network);
  const controllerHex = base58ToEvmHex(getGasFreeControllerAddress(network));
  const domain = {
    name: 'GasFreeController',
    version: 'V1.0.0',
    chainId,
    verifyingContract: controllerHex,
  };
  const message = {
    token: permit.payment.payToken,
    serviceProvider: permit.fee.feeTo,
    user: permit.buyer,
    receiver: permit.payment.payTo,
    value: permit.payment.payAmount,
    maxFee: permit.fee.feeAmount,
    deadline: String(permit.meta.validBefore),
    version: 1,
    nonce: Number.parseInt(permit.meta.nonce, 10),
  };
  return { domain, message };
}

function base58ToEvmHex(address: string): string {
  if (address.startsWith('0x')) return address.toLowerCase();
  const tronHex = TronWeb.address.toHex(address) as string;
  return ('0x' + tronHex.replace(/^41/, '')).toLowerCase();
}

async function tempSignerAddressForDryRun(walletNetwork: 'tron' | 'evm'): Promise<string> {
  // For --dry-run we want to surface what the GasFree API knows about the
  // payer without going through @bankofai/agent-wallet's full provider flow.
  // Reuse deriveWalletInfo to read the env-key address; this throws cleanly
  // (WALLET_NOT_AVAILABLE) when TRON_PRIVATE_KEY is not set.
  const { deriveWalletInfo } = await import('../wallet.js');
  return deriveWalletInfo(walletNetwork).address;
}

function buildDryRunResult(
  profile: string,
  network: string,
  scheme: string,
  token: ResolvedToken,
  requirements: PaymentRequirements,
  paymentPermitContext: PaymentPermitContext,
  facilitatorUrl: string,
  accountInfo: Awaited<ReturnType<GasFreeAPIClient['getAddressInfo']>>,
) {
  const asset = accountInfo.assets.find((a) => a.tokenAddress === token.address);
  const transferFee = asset ? String(asset.transferFee) : '0';
  return {
    dryRun: true,
    profile,
    network,
    scheme,
    facilitatorUrl,
    payer: accountInfo.accountAddress,
    gasFreeAddress: accountInfo.gasFreeAddress,
    active: accountInfo.active,
    token: token.symbol,
    asset: token.address,
    amount: requirements.amount,
    amountDisplay: `${formatSmallestUnit(requirements.amount, token.decimals)} ${token.symbol}`,
    payTo: requirements.payTo,
    estimatedTransferFee: transferFee,
    paymentId: paymentPermitContext.meta.paymentId,
  };
}
