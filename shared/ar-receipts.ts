export interface ArReceipt {
  id: string;
  source: "payment" | "bank_transaction";
  tenantId: string;
  tenantName: string;
  amount: number;
  currency: string;
  date: string;
  contactName: string;
  reference: string;
  invoiceId?: string;
  invoiceNumber?: string;
  isReconciled: boolean;
}

export interface ArReceiptLink {
  id: number;
  invoiceId: string;
  invoiceTenantId: string;
  invoiceNumber: string;
  invoiceTenantName: string;
  vendor: string;
  amount: number;
  receipt: ArReceipt;
  linkedAt: string;
  linkedBy: string;
  removedAt: string | null;
  removedBy: string | null;
}

export interface ArReceiptEvidence extends ArReceiptLink {
  verification: "verified" | "invalid" | "unavailable";
}
