// The clinician service agreement they accept when submitting their application.
export const AGREEMENT_VERSION = process.env.AGREEMENT_VERSION ?? "2026-09";

/** Where the agreement can be read, if it's published. */
export const agreementUrl = (): string | undefined => process.env.AGREEMENT_URL;
