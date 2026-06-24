export const x402Version = 2;

export {
  type Logger,
  consoleLogger,
  noopLogger,
  setLogger,
  resetLogger,
  getLogger,
  log,
} from "./observability/logger";

export { attachFacilitatorLogging, createFacilitator } from "./observability/facilitatorLogging";
