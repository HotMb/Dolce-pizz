export type TerminalCaptureRequest = {
  organizationId: string;
  locationId: string;
  orderId: string;
  paymentId: string;
  amount: number;
  currency: 'EUR';
  idempotencyKey: string;
};

export type TerminalRefundRequest = TerminalCaptureRequest & {reason: string};

export type TerminalResult = {
  status: 'captured' | 'pending' | 'failed';
  providerReference?: string;
  code?: string;
};

export interface PaymentTerminalAdapter {
  capture(request: TerminalCaptureRequest): Promise<TerminalResult>;
  refund(request: TerminalRefundRequest): Promise<TerminalResult>;
}

export type PaymentTerminalStatus = {configured: boolean; provider: string};

/**
 * Safe default used until a certified TPE provider is configured.
 * It deliberately never reports a successful payment and never receives PAN/CVV data.
 */
export function missingTerminalAdapter(): PaymentTerminalAdapter {
  return {
    async capture() {return {status: 'failed', code: 'terminal_not_configured'};},
    async refund() {return {status: 'failed', code: 'terminal_not_configured'};},
  };
}

export function paymentTerminalAdapter(): PaymentTerminalAdapter {
  // Provider selection is intentionally explicit. A future adapter can be selected from
  // a server-side secret/configuration without changing POS or accounting code.
  return missingTerminalAdapter();
}

/** Exposes configuration state without exposing provider secrets or card data. */
export function paymentTerminalStatus(): PaymentTerminalStatus {
  return {configured: false, provider: 'none'};
}
