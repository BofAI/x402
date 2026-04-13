# Client, Server & Facilitator Roles

## Client

The client initiates payments and makes requests to protected resources.

### Mechanism Registration

Mechanisms are registered against **network patterns**:

- **Exact match**: `"tron:nile"` matches only `tron:nile` — higher priority
- **Wildcard match**: `"tron:*"` matches any `tron:<name>` — lower priority

When multiple mechanisms match a network, the most specific pattern wins. Each mechanism is associated with a scheme (e.g., `exact_permit`, `exact_gasfree`).

### Payment Selection Pipeline

When the client receives a 402 response with multiple `accepts` (payment requirements), it runs a selection pipeline:

```
accepts[]
  |
  v
[1] Filter by scheme        (if filter specified)
  |
  v
[2] Filter by network       (if filter specified)
  |
  v
[3] Filter by max amount    (if filter specified)
  |
  v
[4] Filter by registered mechanisms
     (keep only requirements that have a matching mechanism)
  |
  v
[5] Apply policies in registration order
     (each policy receives the list and returns a filtered/reordered subset)
  |
  v
[6] Token selection strategy
     (pick a single requirement from the remaining list)
  |
  v
  selected PaymentRequirements
```

### Policies

A policy receives a list of payment requirements and returns a subset. Policies are applied sequentially in registration order.

**SufficientBalancePolicy** (built-in):
- For each requirement, checks if the buyer has enough token balance (amount + fee)
- If balance check fails (network error, no signer, etc.), the requirement is **kept** (fail-open)
- Requirements with insufficient balance are removed

### Token Selection Strategy

After filtering, a strategy picks the single best requirement:

- **CheapestTokenSelectionStrategy** (default): selects the requirement with the lowest cost, normalized by token decimals
- **DefaultTokenSelectionStrategy**: selects the first requirement in the list

### HTTP Client Behavior

The HTTP client wraps standard HTTP calls with automatic 402 handling:

1. Make the original HTTP request
2. If response status is **not** 402, return the response as-is
3. If 402:
   a. Try to decode `PAYMENT-REQUIRED` header (Base64 JSON)
   b. If header missing or invalid, try to parse the response body as JSON
   c. Extract the `accepts` array from the PaymentRequired structure
   d. Run the payment selection pipeline
   e. Create a PaymentPayload via the selected mechanism
   f. Encode the payload as Base64 JSON
   g. Retry the original request with `PAYMENT-SIGNATURE` header
   h. Return the retry response

Convenience methods: `get(url)`, `post(url, body)`, `put(url, body)`, `delete(url)`.

---

## Server

The server protects resources behind payment requirements and delegates settlement to the facilitator.

### Endpoint Protection

Endpoints are configured with:
- **Price**: human-readable string (e.g., `"100 USDT"`, `"0.5 USDD"`)
- **Scheme**: which payment scheme(s) to accept
- **Network**: which blockchain network(s)
- **Pay-to address**: recipient of the payment
- **Validity window**: how long the payment permit is valid

### Building Payment Requirements

When a client requests a protected resource without payment:

1. Parse the price string (e.g., `"100 USDT"`) into amount + asset address via the token registry
2. Construct `PaymentRequirements` for each price/scheme/network combination
3. Request a fee quote from the facilitator (for schemes that support fees)
4. Merge fee info into requirements
5. Generate `PaymentPermitContext`:
   - `paymentId`: random 16-byte hex with `0x` prefix
   - `nonce`: random value (as string)
   - `validAfter`: current Unix timestamp
   - `validBefore`: current timestamp + validity window
6. Return 402 response with `PaymentRequired` in header and/or body

### Payment Verification & Settlement

When a client retries with `PAYMENT-SIGNATURE`:

1. Decode the `PaymentPayload` from the header
2. **Anti-tampering check**: verify the `accepted` requirements in the payload match what this server originally issued (scheme, network, amount, asset, payTo)
3. Delegate to facilitator for cryptographic verification
4. If valid, delegate to facilitator for on-chain settlement
5. On success, return the protected resource with a 200 status

### Framework Integrations

- **FastAPI**: middleware/decorator that wraps endpoint functions — intercepts requests before the handler, returns 402 or passes through
- **Flask**: similar decorator pattern

---

## Facilitator

The facilitator is the cryptographic and on-chain authority — it verifies signatures and executes settlements.

### Fee Quoting

- Receives payment requirements and returns a `FeeQuoteResponse`
- Fee structure depends on the scheme:
  - `exact_permit`: configurable flat fee per token
  - `exact`: no fees (always returns feeAmount `"0"`)
  - `exact_gasfree`: fee determined by service provider

### Verification

- Recovers the signer from the EIP-712/TIP-712 signature
- Verifies the recovered address matches the `buyer` in the permit
- Validates permit fields against the original requirements (see validation rules in each scheme spec)

### Settlement

- Calls the appropriate on-chain function:
  - `exact_permit`: `permitTransferFrom` on the PaymentPermit contract
  - `exact`: `transferWithAuthorization` on the token contract
  - `exact_gasfree`: submits to the GasFree API relay
- Waits for transaction receipt / confirmation
- Validates on-chain transaction status
- Returns `SettleResponse` with transaction hash or error

### Error Handling

All facilitator operations catch exceptions and return structured responses:
- Verification errors → `VerifyResponse { isValid: false, invalidReason: "..." }`
- Settlement errors → `SettleResponse { success: false, errorReason: "..." }`
