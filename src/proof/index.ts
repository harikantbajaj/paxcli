/**
 * `paxcli/proof` — the Proof Layer as a library: integrity pins, static
 * reward-hack detectors, the shared screening pipeline, withheld checks,
 * receipts (versioned + validated), and redaction.
 */
export { runDetectors, parseDiff, type DetectorFinding } from './detectors.js';
export { capturePins, verifyPins, type PinSet } from './pins.js';
export {
  RECEIPT_VERSION,
  buildReceipt,
  parseReceipt,
  receiptSchema,
  writeReceipt,
  type Receipt,
} from './receipt.js';
export { containsSecrets, redactText, redactValue } from './redact.js';
export { screenCandidate, type ScreenResult } from './verify.js';
export { runWithheldChecks, withheldDir } from './withheld.js';
