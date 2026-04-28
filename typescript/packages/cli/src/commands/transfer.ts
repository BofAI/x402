/**
 * `x402 transfer` — direct account transfer.
 *
 * TRON `exact_gasfree` uses BankofAI's GasFree submit API directly. EVM
 * `exact_permit` / `exact` signs locally and asks the facilitator to verify
 * and settle; the user signs authorization while the settler pays chain gas.
 */

import {
  X402Client,
  GasFreeAPIClient,
  ExactEvmClientMechanism,
  ExactPermitEvmClientMechanism,
  ExactPermitTronClientMechanism,
  getChainId,
  getGasFreeControllerAddress,
  isEvmNetwork,
  isTronNetwork,
  type PaymentRequirements,
  type PaymentPermitContext,
  type PaymentPayload,
  type PaymentPermit,
  type SettleResponse,
} from '@bankofai/x402';
import { TronWeb } from 'tronweb';
import { runCommand, type OutputMode } from '../output.js';
import { loadConfig, getProfile, applyEnvOverrides } from '../config.js';
import { getFacilitatorBaseUrl, getSettlementFacilitatorBaseUrl } from '../facilitator.js';
import { X402CliError } from '../error.js';
import {
  resolveToken,
  parseHumanAmount,
  formatSmallestUnit,
  newPaymentId,
  type ResolvedToken,
} from '../amount.js';
import { appendReceipt, type Receipt } from '../receipts.js';
import { createEvmClientSignerFromEnv, createTronClientSignerFromEnv } from '../wallet.js';
import { FacilitatorHttpClient } from '../facilitatorClient.js';
import { isKnownScheme, pickScheme } from '../schemes.js';

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
    const tokenSymbol = opts.token || effective.token;
    const token = resolveToken({
      network,
      symbol: tokenSymbol,
      asset: opts.asset,
      decimals: opts.decimals,
    });
    const scheme =
      opts.scheme ||
      (opts.network ? pickScheme(network, token.symbol) : effective.scheme) ||
      pickScheme(network, token.symbol);
    if (!scheme) {
      throw new X402CliError(
        'UNSUPPORTED_SCHEME',
        `No default transfer scheme is registered for ${network} ${token.symbol}.`,
        'Pass --scheme explicitly if the token supports an x402 settlement scheme.',
      );
    }
    if (!isKnownScheme(scheme)) {
      throw new X402CliError('UNSUPPORTED_SCHEME', `Unknown transfer scheme '${scheme}'.`);
    }
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

    const facilitatorUrl = scheme === 'exact_gasfree'
      ? getFacilitatorBaseUrl(network)
      : getSettlementFacilitatorBaseUrl(network);
    if (scheme !== 'exact_gasfree') {
      try {
        return await settleViaFacilitator({
          profileName,
          network,
          scheme,
          token,
          amountSmallest,
          requirements,
          paymentPermitContext,
          facilitatorUrl,
          dryRun: Boolean(opts.dryRun),
        });
      } catch (err) {
        if (
          !opts.dryRun &&
          scheme === 'exact_permit' &&
          isTronNetwork(network) &&
          isAllowanceFailure(err)
        ) {
          process.stderr.write(
            `[x402] exact_permit requires an on-chain approve but approval failed ` +
              `(${(err as Error).message}). Falling back to exact_gasfree.\n`,
          );
          const gasFreeRequirements: PaymentRequirements = {
            ...requirements,
            scheme: 'exact_gasfree',
            extra: { ...requirements.extra },
          };
          return settleViaGasFree({
            profileName,
            network,
            token,
            amountSmallest,
            requirements: gasFreeRequirements,
            paymentPermitContext,
            facilitatorUrl: getFacilitatorBaseUrl(network),
            fallbackFrom: 'exact_permit',
          });
        }
        throw err;
      }
    }

    if (opts.dryRun) {
      if (!network.startsWith('tron:')) {
        throw new X402CliError(
          'UNSUPPORTED_NETWORK',
          `transfer with exact_gasfree requires a tron:* network; got '${network}'.`,
        );
      }
      const gasFreeClient = new GasFreeAPIClient(facilitatorUrl);
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

    return settleViaGasFree({
      profileName,
      network,
      token,
      amountSmallest,
      requirements,
      paymentPermitContext,
      facilitatorUrl,
    });
  });
}

async function settleViaGasFree(args: {
  profileName: string;
  network: string;
  token: ResolvedToken;
  amountSmallest: bigint;
  requirements: PaymentRequirements;
  paymentPermitContext: PaymentPermitContext;
  facilitatorUrl: string;
  fallbackFrom?: string;
}) {
  if (!args.network.startsWith('tron:')) {
    throw new X402CliError(
      'UNSUPPORTED_NETWORK',
      `transfer with exact_gasfree requires a tron:* network; got '${args.network}'.`,
    );
  }
  const gasFreeClient = new GasFreeAPIClient(args.facilitatorUrl);
  const signer = createTronClientSignerFromEnv();
  const x402 = new X402Client();
  x402.registerGasFree(signer, { [args.network]: gasFreeClient });

  const payload = await x402.createPaymentPayload(args.requirements, RESOURCE_PSEUDO_URI, {
    paymentPermitContext: args.paymentPermitContext,
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
  const { domain, message } = buildGasFreeSubmitBody(args.network, permit);
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

  const payer = signer.getAddress();
  const receipt: Receipt = {
    paymentId: args.paymentPermitContext.meta.paymentId,
    command: 'transfer',
    createdAt: new Date().toISOString(),
    profile: args.profileName,
    network: args.network,
    scheme: 'exact_gasfree',
    payer,
    payTo: args.requirements.payTo,
    token: args.token.symbol,
    asset: args.token.address,
    amount: args.requirements.amount,
    amountDisplay: `${formatSmallestUnit(args.amountSmallest, args.token.decimals)} ${args.token.symbol}`,
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
      ...(args.fallbackFrom ? { fallbackFrom: args.fallbackFrom } : {}),
    },
  };
  const receiptPath = await appendReceipt(receipt);

  return {
    paymentId: args.paymentPermitContext.meta.paymentId,
    payer,
    payTo: args.requirements.payTo,
    token: args.token.symbol,
    asset: args.token.address,
    amount: args.requirements.amount,
    amountDisplay: `${formatSmallestUnit(args.amountSmallest, args.token.decimals)} ${args.token.symbol}`,
    feeAmount: permit.fee.feeAmount,
    transaction: txnHash,
    traceId,
    gasFreeProvider: permit.fee.feeTo,
    scheme: 'exact_gasfree',
    ...(args.fallbackFrom ? { fallbackFrom: args.fallbackFrom } : {}),
    receiptPath,
  };
}

async function settleViaFacilitator(args: {
  profileName: string;
  network: string;
  scheme: 'exact' | 'exact_permit';
  token: ResolvedToken;
  amountSmallest: bigint;
  requirements: PaymentRequirements;
  paymentPermitContext: PaymentPermitContext;
  facilitatorUrl: string;
  dryRun: boolean;
}) {
  if (!isEvmNetwork(args.network) && !(isTronNetwork(args.network) && args.scheme === 'exact_permit')) {
    throw new X402CliError(
      'UNSUPPORTED_NETWORK',
      `transfer with ${args.scheme} supports eip155:* networks and tron:* exact_permit; got '${args.network}'.`,
    );
  }

  const facilitator = new FacilitatorHttpClient(args.facilitatorUrl);
  const requirements = { ...args.requirements, extra: { ...args.requirements.extra } };

  if (args.scheme === 'exact_permit') {
    const quotes = await facilitator.feeQuote([requirements], args.paymentPermitContext);
    const quote = quotes.find(
      (q) =>
        q.scheme === args.scheme &&
        q.network === args.network &&
        q.asset.toLowerCase() === args.token.address.toLowerCase(),
    ) ?? quotes[0];
    if (!quote) {
      throw new X402CliError(
        'FEE_QUOTE_NOT_FOUND',
        `No facilitator fee quote returned for ${args.network} ${args.scheme}.`,
      );
    }
    requirements.extra = { ...requirements.extra, fee: quote.fee };
  }

  const feeAmount = requirements.extra?.fee?.feeAmount ?? '0';
  if (args.dryRun) {
    const payer = await tempSignerAddressForDryRun(isEvmNetwork(args.network) ? 'evm' : 'tron');
    return {
      dryRun: true,
      profile: args.profileName,
      network: args.network,
      scheme: args.scheme,
      facilitatorUrl: args.facilitatorUrl,
      payer,
      token: args.token.symbol,
      asset: args.token.address,
      amount: requirements.amount,
      amountDisplay: `${formatSmallestUnit(args.amountSmallest, args.token.decimals)} ${args.token.symbol}`,
      payTo: requirements.payTo,
      estimatedFee: feeAmount,
      paymentId: args.paymentPermitContext.meta.paymentId,
    };
  }

  const signer = isEvmNetwork(args.network)
    ? createEvmClientSignerFromEnv()
    : createTronClientSignerFromEnv();
  const x402 = new X402Client();
  if (isEvmNetwork(args.network)) {
    x402.register('eip155:*', new ExactPermitEvmClientMechanism(signer));
    x402.register('eip155:*', new ExactEvmClientMechanism(signer));
  } else {
    x402.register('tron:*', new ExactPermitTronClientMechanism(signer));
  }

  const payload = await x402.createPaymentPayload(requirements, RESOURCE_PSEUDO_URI, {
    paymentPermitContext: args.paymentPermitContext,
  });
  const verify = await facilitator.verify(payload, requirements);
  if (!verify.isValid) {
    throw new X402CliError(
      'VERIFY_FAILED',
      `Facilitator rejected payment payload: ${verify.invalidReason ?? 'unknown reason'}`,
    );
  }
  const settlement = await facilitator.settle(payload, requirements);
  if (!settlement.success) {
    throw new X402CliError(
      'SETTLE_FAILED',
      `Facilitator settlement failed: ${settlement.errorReason ?? 'unknown reason'}`,
    );
  }

  const payer = signer.getAddress();
  const receiptPath = await appendReceipt({
    paymentId: args.paymentPermitContext.meta.paymentId,
    command: 'transfer',
    createdAt: new Date().toISOString(),
    profile: args.profileName,
    network: args.network,
    scheme: args.scheme,
    payer,
    payTo: requirements.payTo,
    token: args.token.symbol,
    asset: args.token.address,
    amount: requirements.amount,
    amountDisplay: `${formatSmallestUnit(args.amountSmallest, args.token.decimals)} ${args.token.symbol}`,
    feeAmount,
    settlement: settlement as SettleResponse & { success: true },
    extra: {
      facilitatorUrl: args.facilitatorUrl,
      paymentPermitContext: args.paymentPermitContext,
    },
  });

  return {
    paymentId: args.paymentPermitContext.meta.paymentId,
    payer,
    payTo: requirements.payTo,
    token: args.token.symbol,
    asset: args.token.address,
    amount: requirements.amount,
    amountDisplay: `${formatSmallestUnit(args.amountSmallest, args.token.decimals)} ${args.token.symbol}`,
    feeAmount,
    transaction: settlement.transaction ?? null,
    receiptPath,
  };
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

function isAllowanceFailure(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: string; message?: string };
  return (
    e.name === 'InsufficientAllowanceError' ||
    e.name === 'AllowanceError' ||
    /allowance|approve|tron|energy|balance|bandwidth/i.test(e.message ?? '')
  );
}

function base58ToEvmHex(address: string): string {
  if (address.startsWith('0x')) return address.toLowerCase();
  const tronHex = TronWeb.address.toHex(address) as string;
  return ('0x' + tronHex.replace(/^41/, '')).toLowerCase();
}

async function tempSignerAddressForDryRun(walletNetwork: 'tron' | 'evm'): Promise<string> {
  // For --dry-run we want to surface what the GasFree API knows about the
  // payer without signing. Reuse deriveWalletInfo to read the env-key address;
  // this throws cleanly
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
  const transferFee = asset ? BigInt(String(asset.transferFee)) : 0n;
  const activateFee =
    asset && !accountInfo.active ? BigInt(String(asset.activateFee)) : 0n;
  const amount = BigInt(requirements.amount);
  const totalFee = transferFee + activateFee;
  const feePctOfAmount =
    amount > 0n ? Number((totalFee * 10000n) / amount) / 100 : null;
  // Warn loud when GasFree fee dwarfs the actual payment — the SDK can't fix
  // this; users should know what they're spending the relayer fee on.
  if (feePctOfAmount !== null && feePctOfAmount >= 10) {
    process.stderr.write(
      `[x402] WARNING: GasFree relayer fee is ` +
        `${formatSmallestUnit(totalFee, token.decimals)} ${token.symbol}, ` +
        `which is ${feePctOfAmount.toFixed(1)}% of the ${formatSmallestUnit(
          amount,
          token.decimals,
        )} ${token.symbol} payment. ` +
        `GasFree fees are flat per-tx; small payments are uneconomical. See ` +
        `docs/solutions.md #12.\n`,
    );
  }
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
    estimatedTransferFee: transferFee.toString(),
    estimatedTransferFeeDisplay: formatSmallestUnit(transferFee, token.decimals),
    estimatedActivateFee: activateFee.toString(),
    feeAsPercentageOfAmount: feePctOfAmount,
    paymentId: paymentPermitContext.meta.paymentId,
  };
}
