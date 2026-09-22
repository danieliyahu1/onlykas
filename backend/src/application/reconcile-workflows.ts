import type {
  MembershipGateway,
  MembershipVerifier,
  PaymentGateway,
  Repositories,
} from "./ports.js";
import type {
  MembershipWorkflow,
  PaymentWorkflow,
  PreparedMembershipRecord,
  PreparedPaymentRecord,
} from "../domain/models.js";
import { logger as defaultLogger, safeError, type Logger } from "../observability.js";
import { defaultMetrics, type Metrics } from "../metrics.js";

/**
 * How long a persisted transaction may stay unresolved before the reconciler
 * stops waiting for it. A transaction that never lands on chain is not a
 * payment; leaving it pending forever would hide that from the operator.
 */
const STALE_WORKFLOW_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_BATCH = 100;

export interface WorkflowReconcilerDependencies {
  store: Repositories;
  paymentGateway?: PaymentGateway | undefined;
  membershipGateway?: MembershipGateway | undefined;
  membershipVerifier?: MembershipVerifier | undefined;
  now?: (() => number) | undefined;
  logger?: Logger | undefined;
  metrics?: Metrics | undefined;
  batchSize?: number | undefined;
  staleWorkflowMs?: number | undefined;
}

export interface ReconcileSummary {
  scanned: number;
  confirmed: number;
  rejected: number;
  retried: number;
  abandoned: number;
}

/**
 * Drives every in-flight payment and membership transaction to a terminal
 * off-chain state without any further client involvement.
 *
 * A user can approve a transaction in their wallet and then lose connectivity,
 * close the tab, or simply never return. The chain may still accept the
 * transaction and, for memberships, discovery can later find it. The receipt,
 * however, must be written by the server from chain evidence. This service is
 * the durable half of "the backend decides": it polls persisted transaction IDs
 * and finalizes the off-chain record. It never broadcasts a transaction and
 * never trusts a value the client supplied. Exactly one process finalizes a
 * workflow because terminal claiming is atomic in the store.
 */
export class WorkflowReconciler {
  private readonly now: () => number;
  private readonly logger: Logger;
  private readonly metrics: Metrics;
  private readonly batchSize: number;
  private readonly staleWorkflowMs: number;

  constructor(private readonly d: WorkflowReconcilerDependencies) {
    this.now = d.now ?? Date.now;
    this.logger = d.logger ?? defaultLogger;
    this.metrics = d.metrics ?? defaultMetrics;
    this.batchSize = d.batchSize ?? DEFAULT_BATCH;
    this.staleWorkflowMs = d.staleWorkflowMs ?? STALE_WORKFLOW_MS;
  }

  /** One reconciliation pass over all unresolved workflows. */
  async run(now = this.now()): Promise<ReconcileSummary> {
    const summary: ReconcileSummary = {
      scanned: 0,
      confirmed: 0,
      rejected: 0,
      retried: 0,
      abandoned: 0,
    };
    await this.reconcilePayments(now, summary);
    await this.reconcileMemberships(now, summary);
    this.metrics.workflowReconcileRun(summary);
    if (summary.confirmed || summary.rejected || summary.abandoned)
      this.logger.info("workflow_reconcile_cycle", { ...summary });
    return summary;
  }

  private async reconcilePayments(
    now: number,
    summary: ReconcileSummary,
  ): Promise<void> {
    const gateway = this.d.paymentGateway;
    if (!gateway) return;
    for (const workflow of await this.d.store.pendingPaymentWorkflows(this.batchSize)) {
      summary.scanned += 1;
      await this.reconcilePayment(gateway, workflow, now, summary).catch((error) =>
        this.logFailure("payment", error),
      );
    }
  }

  private async reconcilePayment(
    gateway: PaymentGateway,
    workflow: PaymentWorkflow,
    now: number,
    summary: ReconcileSummary,
  ): Promise<void> {
    // The prepared record is the server's own view of what the buyer authorized.
    // It is read without an expiry window because reconciliation happens after
    // the client's prepared TTL has elapsed.
    const prepared = await this.d.store.getPreparedPayment(
      workflow.preparedPaymentId,
      now,
    );
    if (!prepared) {
      await this.abandonPayment(workflow, now, "prepared_missing", summary);
      return;
    }
    const submission = await gateway.status(workflow.transactionId);
    if (submission.isAccepted === null) {
      if (this.workflowAge(workflow, now) > this.staleWorkflowMs)
        await this.abandonPayment(workflow, now, "unconfirmed_timeout", summary);
      else summary.retried += 1;
      return;
    }
    if (submission.isAccepted !== true) {
      await this.rejectPayment(workflow, now, summary);
      return;
    }
    await this.confirmPayment(workflow, prepared, workflow.transactionId, now, summary);
  }

  private async confirmPayment(
    workflow: PaymentWorkflow,
    prepared: PreparedPaymentRecord,
    transactionId: string,
    now: number,
    summary: ReconcileSummary,
  ): Promise<void> {
    const claimed = await this.d.store.claimPaymentWorkflowTerminal(
      workflow.preparedPaymentId,
      "CONFIRMED",
      now,
    );
    if (claimed === null) return;
    const outcome = await this.d.store.finalizePurchase(workflow.preparedPaymentId, {
      postId: prepared.postId,
      buyer: prepared.buyer,
      transactionId,
    });
    await this.d.store.deletePaymentWorkflow(workflow.preparedPaymentId);
    summary.confirmed += 1;
    this.metrics.paymentFinalizeAttempt(
      outcome === "DUPLICATE" ? "purchase_exists" : "confirmed",
    );
  }

  private async rejectPayment(
    workflow: PaymentWorkflow,
    now: number,
    summary: ReconcileSummary,
  ): Promise<void> {
    const claimed = await this.d.store.claimPaymentWorkflowTerminal(
      workflow.preparedPaymentId,
      "REJECTED",
      now,
      "RECONCILED_REJECTED",
    );
    if (claimed === null) return;
    await this.d.store.deletePaymentWorkflow(workflow.preparedPaymentId);
    summary.rejected += 1;
    this.metrics.paymentFinalizeAttempt("rejected");
  }

  private async abandonPayment(
    workflow: PaymentWorkflow,
    now: number,
    reason: string,
    summary: ReconcileSummary,
  ): Promise<void> {
    const claimed = await this.d.store.claimPaymentWorkflowTerminal(
      workflow.preparedPaymentId,
      "REJECTED",
      now,
      reason,
    );
    if (claimed === null) return;
    await this.d.store.deletePaymentWorkflow(workflow.preparedPaymentId);
    summary.abandoned += 1;
    this.metrics.paymentFinalizeAttempt("abandoned");
    this.logger.warn("workflow_reconcile_payment_abandoned", { reason });
  }

  private async reconcileMemberships(
    now: number,
    summary: ReconcileSummary,
  ): Promise<void> {
    if (!this.d.membershipVerifier && !this.d.membershipGateway) return;
    for (const workflow of await this.d.store.pendingMembershipWorkflows(
      this.batchSize,
    )) {
      summary.scanned += 1;
      await this.reconcileMembership(workflow, now, summary).catch((error) =>
        this.logFailure("membership", error),
      );
    }
  }

  private async reconcileMembership(
    workflow: MembershipWorkflow,
    now: number,
    summary: ReconcileSummary,
  ): Promise<void> {
    const prepared = await this.d.store.getPreparedMembership(
      workflow.preparedMembershipId,
      now,
    );
    if (!prepared) {
      await this.abandonMembership(workflow, now, "prepared_missing", summary);
      return;
    }
    const accepted = await this.membershipAccepted(workflow.transactionId, prepared);
    if (accepted === null) {
      if (this.workflowAge(workflow, now) > this.staleWorkflowMs)
        await this.abandonMembership(workflow, now, "unconfirmed_timeout", summary);
      else summary.retried += 1;
      return;
    }
    if (!accepted) {
      await this.rejectMembership(workflow, now, summary);
      return;
    }
    await this.confirmMembership(workflow, prepared, now, summary);
  }

  /**
   * Confirms the transaction is accepted on chain for the exact covenant and
   * member output the server prepared. Returns null while it cannot yet tell.
   */
  private async membershipAccepted(
    transactionId: string,
    prepared: PreparedMembershipRecord,
  ): Promise<boolean | null> {
    const verifier = this.d.membershipVerifier;
    if (!verifier) return this.gatewayAccepted(transactionId);
    if (prepared.kind !== "purchase" || prepared.memberOutputIndex === null)
      return this.gatewayAccepted(transactionId);
    const check = await verifier.verifyUtxo(
      transactionId,
      prepared.memberOutputIndex,
      prepared.buyer,
      prepared.covenantId,
      prepared.creator,
    );
    if (check.status === "VALID") return true;
    if (check.status === "EXPIRED") return true;
    return null;
  }

  private async gatewayAccepted(transactionId: string): Promise<boolean | null> {
    const gateway = this.d.membershipGateway;
    if (!gateway?.status) return null;
    const submission = await gateway.status(transactionId);
    return submission.isAccepted;
  }

  private async confirmMembership(
    workflow: MembershipWorkflow,
    prepared: PreparedMembershipRecord,
    now: number,
    summary: ReconcileSummary,
  ): Promise<void> {
    const claimed = await this.d.store.claimMembershipWorkflowTerminal(
      workflow.preparedMembershipId,
      "CONFIRMED",
      now,
    );
    if (claimed === null) return;
    await this.finalizeMembershipRecord(prepared, workflow.transactionId);
    await this.d.store.deleteMembershipWorkflow(workflow.preparedMembershipId);
    summary.confirmed += 1;
    this.metrics.membershipFinalizeAttempt(prepared.kind, "confirmed");
  }

  private async finalizeMembershipRecord(
    prepared: PreparedMembershipRecord,
    transactionId: string,
  ): Promise<void> {
    switch (prepared.kind) {
      case "offer":
        await this.d.store.finalizeOffer(prepared.id, {
          creator: prepared.creator,
          covenantId: prepared.covenantId,
          priceSompi: prepared.priceSompi ?? "0",
        });
        return;
      case "update":
        await this.d.store.finalizePriceUpdate(prepared.id, {
          creator: prepared.creator,
          covenantId: prepared.covenantId,
          priceSompi: prepared.priceSompi ?? "0",
        });
        return;
      case "cancel":
        if (this.d.store.finalizeCancellation)
          await this.d.store.finalizeCancellation(prepared.id, {
            creator: prepared.creator,
            covenantId: prepared.covenantId,
          });
        return;
      case "purchase":
        await this.d.store.finalizeMembershipPurchase(prepared.id, {
          transactionId,
          buyer: prepared.buyer,
          creator: prepared.creator,
          covenantId: prepared.covenantId,
        });
        return;
    }
  }

  private async rejectMembership(
    workflow: MembershipWorkflow,
    now: number,
    summary: ReconcileSummary,
  ): Promise<void> {
    const claimed = await this.d.store.claimMembershipWorkflowTerminal(
      workflow.preparedMembershipId,
      "REJECTED",
      now,
      "RECONCILED_REJECTED",
    );
    if (claimed === null) return;
    await this.d.store.deleteMembershipWorkflow(workflow.preparedMembershipId);
    summary.rejected += 1;
  }

  private async abandonMembership(
    workflow: MembershipWorkflow,
    now: number,
    reason: string,
    summary: ReconcileSummary,
  ): Promise<void> {
    const claimed = await this.d.store.claimMembershipWorkflowTerminal(
      workflow.preparedMembershipId,
      "REJECTED",
      now,
      reason,
    );
    if (claimed === null) return;
    await this.d.store.deleteMembershipWorkflow(workflow.preparedMembershipId);
    summary.abandoned += 1;
    this.logger.warn("workflow_reconcile_membership_abandoned", { reason });
  }

  private workflowAge(
    workflow: { submittedAt?: number | null | undefined },
    now: number,
  ): number {
    return now - (workflow.submittedAt ?? now);
  }

  private logFailure(kind: string, error: unknown): void {
    this.logger.warn("workflow_reconcile_failed", {
      kind,
      error: safeError(error),
    });
  }
}
