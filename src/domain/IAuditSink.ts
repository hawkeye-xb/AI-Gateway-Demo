import type { RawUsage } from './types';

export interface BillingEvent {
  requestId: string;
  accountId: string;
  modality: string;
  model: string;
  provider: string;
  usage: RawUsage;
  cost: number;          // credits charged
  realCostUsd: number;   // actual provider cost
  timestamp: number;
}

export interface IAuditSink {
  record(event: BillingEvent): Promise<void>;
  claimEvent(externalEventId: string, source: string): Promise<boolean>;
}
