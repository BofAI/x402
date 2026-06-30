/**
 * Optional FacilitatorClient decorator that drops `paymentPayload.resource`
 * before forwarding verify/settle to the wrapped facilitator.
 *
 * Why this exists
 * ---------------
 * `resource.url` is informational metadata: the facilitator never reads it on
 * the verify/settle path, and the payment signature does not cover it. When a
 * resource server runs locally, its `resource.url` is `http://localhost:<port>`.
 * Some edge WAFs in front of a hosted facilitator (observed: AWS WAF managed
 * rule `EC2MetaDataSSRF_BODY`) treat that loopback URL in the request body as an
 * SSRF probe and reject `POST /verify` and `/settle` with `403 Forbidden` —
 * which surfaces to the client as a failed payment (the resource server falls
 * back to 402). Dropping the field removes the false positive without changing
 * verification or settlement in any way.
 *
 * This is opt-in: wrap your `HTTPFacilitatorClient` with it only when you need
 * it (e.g. local server pointed at a WAF-fronted facilitator). It is a no-op for
 * correctness — keep it off when you want the wire payload untouched.
 */
import type { FacilitatorClient } from "@bankofai/x402-core/server";
import type {
  PaymentPayload,
  PaymentRequirements,
  VerifyResponse,
  SettleResponse,
  SupportedResponse,
} from "@bankofai/x402-core/types";

/** Return a shallow copy of the payload with the optional `resource` removed. */
function stripResource(paymentPayload: PaymentPayload): PaymentPayload {
  const copy = { ...paymentPayload };
  delete copy.resource;
  return copy;
}

/** Decorates a FacilitatorClient, stripping `resource` from verify/settle. */
export class ResourceStrippingFacilitatorClient implements FacilitatorClient {
  constructor(private readonly inner: FacilitatorClient) {}

  verify(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    return this.inner.verify(stripResource(paymentPayload), paymentRequirements);
  }

  settle(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ): Promise<SettleResponse> {
    return this.inner.settle(stripResource(paymentPayload), paymentRequirements);
  }

  getSupported(): Promise<SupportedResponse> {
    return this.inner.getSupported();
  }
}
