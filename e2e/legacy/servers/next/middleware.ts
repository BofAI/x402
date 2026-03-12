import { Address } from "viem";
import { paymentMiddleware, Network, Resource, FacilitatorConfig } from "@bankofai/x402-next-legacy";

const payTo = process.env.EVM_PAYEE_ADDRESS as Address;
const network = process.env.EVM_NETWORK as Network;
const facilitatorUrl = process.env.FACILITATOR_URL;

// Create facilitator config if URL is provided
const facilitatorConfig: FacilitatorConfig | undefined = facilitatorUrl
  ? { url: facilitatorUrl as Resource }
  : undefined;

if (facilitatorUrl) {
  console.log(`Using remote facilitator at: ${facilitatorUrl}`);
} else {
  console.log(`Using default facilitator`);
}

export const middleware = paymentMiddleware(
  payTo,
  {
    "/api/protected": {
      price: {
        amount: "1000",
        asset: {
          address: "0x375cADdd2cB68cE82e3D9B075D551067a7b4B816",
          decimals: 6,
          eip712: {
            name: "DA HULU",
            version: "1",
          },
        },
      },
      network,
      config: {
        description: "Protected API endpoint",
      },
    },
  },
  facilitatorConfig,
  {
    appName: "Next x402 E2E Test",
    appLogo: "/x402-icon-blue.png",
  },
);

// Configure which paths the middleware should run on
export const config = {
  matcher: ["/api/protected"],
  runtime: 'nodejs', // TEMPORARY: Only needed until Edge runtime support is added
};
