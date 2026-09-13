import { createServer, type Server } from "node:http";
import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from "prom-client";

export interface BuildInfo {
  version: string;
  revision: string;
}

export interface HttpRequestObservation {
  method: string;
  route: string;
  statusCode: number;
  durationSeconds: number;
}

const HTTP_DURATION_BUCKETS = [
  0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
];
const MEDIA_BYTES_BUCKETS = [
  10_000, 100_000, 1_000_000, 5_000_000, 10_000_000, 25_000_000, 50_000_000,
  100_000_000,
];

/**
 * Owns the Prometheus registry and every OnlyKas signal recorded against it.
 *
 * Labels are deliberately bounded: route templates, method, status class, and
 * enumerated outcomes only. Wallet addresses, post IDs, transaction IDs,
 * storage keys, request IDs, and raw URLs are never used as labels.
 */
export class Metrics {
  readonly registry: Registry;
  readonly contentType: string;

  private readonly httpInFlight: Gauge;
  private readonly httpRequests: Counter<"method" | "route" | "status">;
  private readonly httpDuration: Histogram<"method" | "route">;
  private readonly mediaPublish: Counter<"outcome" | "media_type">;
  private readonly mediaPublishBytes: Histogram<"media_type">;
  private readonly mediaValidationFailures: Counter<"category">;
  private readonly mediaDelivery: Counter<"method" | "outcome" | "range">;
  private readonly mediaDeliveryBytes: Counter<"media_type">;
  private readonly paymentPrepare: Counter<"outcome">;
  private readonly paymentFinalize: Counter<"state">;
  private readonly paymentVerification: Counter<"outcome">;
  private readonly membershipPrepare: Counter<"kind" | "outcome">;
  private readonly membershipFinalize: Counter<"kind" | "state">;
  private readonly membershipVerification: Counter<"scope" | "status">;
  private readonly authChallenge: Counter<"outcome">;
  private readonly authSession: Counter<"outcome">;
  private readonly feedback: Counter<"outcome">;
  private readonly dependencyRequests: Counter<
    "dependency" | "operation" | "outcome"
  >;
  private readonly dependencyDuration: Histogram<"dependency" | "operation">;

  constructor(build: BuildInfo, registry = new Registry()) {
    this.registry = registry;
    this.contentType = registry.contentType;
    collectDefaultMetrics({ register: registry });
    const registers = [registry];

    this.httpInFlight = new Gauge({
      name: "onlykas_http_requests_in_flight",
      help: "HTTP requests currently being served.",
      registers,
    });
    this.httpRequests = new Counter({
      name: "onlykas_http_requests_total",
      help: "HTTP requests completed by method, route template, and status.",
      labelNames: ["method", "route", "status"],
      registers,
    });
    this.httpDuration = new Histogram({
      name: "onlykas_http_request_duration_seconds",
      help: "HTTP request duration in seconds by method and route template.",
      labelNames: ["method", "route"],
      buckets: HTTP_DURATION_BUCKETS,
      registers,
    });
    this.mediaPublish = new Counter({
      name: "onlykas_media_publish_total",
      help: "Media publication attempts by outcome and media type.",
      labelNames: ["outcome", "media_type"],
      registers,
    });
    this.mediaPublishBytes = new Histogram({
      name: "onlykas_media_publish_bytes",
      help: "Size in bytes of successfully published media by media type.",
      labelNames: ["media_type"],
      buckets: MEDIA_BYTES_BUCKETS,
      registers,
    });
    this.mediaValidationFailures = new Counter({
      name: "onlykas_media_validation_failures_total",
      help: "Media validation failures by category.",
      labelNames: ["category"],
      registers,
    });
    this.mediaDelivery = new Counter({
      name: "onlykas_media_delivery_total",
      help: "Protected media delivery requests by method, outcome, and range.",
      labelNames: ["method", "outcome", "range"],
      registers,
    });
    this.mediaDeliveryBytes = new Counter({
      name: "onlykas_media_delivery_bytes_total",
      help: "Bytes served through the protected media proxy by media type.",
      labelNames: ["media_type"],
      registers,
    });
    this.paymentPrepare = new Counter({
      name: "onlykas_payment_prepare_total",
      help: "Per-post payment preparation attempts by outcome.",
      labelNames: ["outcome"],
      registers,
    });
    this.paymentFinalize = new Counter({
      name: "onlykas_payment_finalize_total",
      help: "Per-post payment finalization attempts by state.",
      labelNames: ["state"],
      registers,
    });
    this.paymentVerification = new Counter({
      name: "onlykas_payment_verification_total",
      help: "Purchase access verifications by outcome.",
      labelNames: ["outcome"],
      registers,
    });
    this.membershipPrepare = new Counter({
      name: "onlykas_membership_prepare_total",
      help: "Membership preparation attempts by kind and outcome.",
      labelNames: ["kind", "outcome"],
      registers,
    });
    this.membershipFinalize = new Counter({
      name: "onlykas_membership_finalize_total",
      help: "Membership finalization attempts by kind and state.",
      labelNames: ["kind", "state"],
      registers,
    });
    this.membershipVerification = new Counter({
      name: "onlykas_membership_verification_total",
      help: "Membership verification results by scope and status.",
      labelNames: ["scope", "status"],
      registers,
    });
    this.authChallenge = new Counter({
      name: "onlykas_auth_challenge_total",
      help: "Wallet authentication challenges by outcome.",
      labelNames: ["outcome"],
      registers,
    });
    this.authSession = new Counter({
      name: "onlykas_auth_session_total",
      help: "Wallet authentication sessions by outcome.",
      labelNames: ["outcome"],
      registers,
    });
    this.feedback = new Counter({
      name: "onlykas_feedback_total",
      help: "Anonymous user feedback submissions by outcome.",
      labelNames: ["outcome"],
      registers,
    });
    this.dependencyRequests = new Counter({
      name: "onlykas_dependency_requests_total",
      help: "Outbound dependency requests by dependency, operation, and outcome.",
      labelNames: ["dependency", "operation", "outcome"],
      registers,
    });
    this.dependencyDuration = new Histogram({
      name: "onlykas_dependency_request_duration_seconds",
      help: "Outbound dependency request duration in seconds.",
      labelNames: ["dependency", "operation"],
      buckets: HTTP_DURATION_BUCKETS,
      registers,
    });
    new Gauge({
      name: "onlykas_build_info",
      help: "Build information for the running OnlyKas process.",
      labelNames: ["version", "revision"],
      registers,
    }).set({ version: build.version, revision: build.revision }, 1);
  }

  render(): Promise<string> {
    return this.registry.metrics();
  }

  httpRequestStarted(): void {
    this.httpInFlight.inc();
  }

  httpRequestFinished(observation: HttpRequestObservation): void {
    this.httpInFlight.dec();
    const status = String(observation.statusCode);
    this.httpRequests.inc({
      method: observation.method,
      route: observation.route,
      status,
    });
    this.httpDuration.observe(
      { method: observation.method, route: observation.route },
      observation.durationSeconds,
    );
  }

  mediaPublishAttempt(outcome: string, mediaType: string): void {
    this.mediaPublish.inc({ outcome, media_type: mediaType });
  }

  mediaPublished(mediaType: string, bytes: number): void {
    this.mediaPublish.inc({ outcome: "committed", media_type: mediaType });
    this.mediaPublishBytes.observe({ media_type: mediaType }, bytes);
  }

  mediaValidationFailure(category: string): void {
    this.mediaValidationFailures.inc({ category });
  }

  mediaDeliveryAttempt(method: string, outcome: string, range: string): void {
    this.mediaDelivery.inc({ method, outcome, range });
  }

  mediaDelivered(mediaType: string, bytes: number): void {
    this.mediaDeliveryBytes.inc({ media_type: mediaType }, bytes);
  }

  paymentPrepareAttempt(outcome: string): void {
    this.paymentPrepare.inc({ outcome });
  }

  paymentFinalizeAttempt(state: string): void {
    this.paymentFinalize.inc({ state });
  }

  paymentVerificationAttempt(ok: boolean): void {
    this.paymentVerification.inc({ outcome: ok ? "verified" : "rejected" });
  }

  membershipPrepareAttempt(kind: string, outcome: string): void {
    this.membershipPrepare.inc({ kind, outcome });
  }

  membershipFinalizeAttempt(kind: string, state: string): void {
    this.membershipFinalize.inc({ kind, state });
  }

  membershipVerificationAttempt(scope: string, status: string): void {
    this.membershipVerification.inc({ scope, status });
  }

  authChallengeAttempt(outcome: string): void {
    this.authChallenge.inc({ outcome });
  }

  authSessionAttempt(outcome: string): void {
    this.authSession.inc({ outcome });
  }

  /** Records an anonymous user feedback submission. */
  recordFeedback(fields: { outcome: string }): void {
    this.feedback.inc({ outcome: fields.outcome });
  }

  /**
   * Times an outbound dependency call and records its outcome. Errors are
   * rethrown unchanged so callers keep their existing error handling.
   */
  async observeDependency<T>(
    dependency: string,
    operation: string,
    run: () => Promise<T>,
  ): Promise<T> {
    const startedAt = process.hrtime.bigint();
    try {
      const result = await run();
      this.dependencyRequests.inc({ dependency, operation, outcome: "success" });
      return result;
    } catch (error) {
      this.dependencyRequests.inc({ dependency, operation, outcome: "error" });
      throw error;
    } finally {
      const seconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
      this.dependencyDuration.observe({ dependency, operation }, seconds);
    }
  }
}

/**
 * Serves Prometheus text on a dedicated listener. Only `GET /metrics` is
 * answered; every other request is rejected so the port cannot be mistaken for
 * an application endpoint.
 */
export function createMetricsServer(metrics: Metrics): Server {
  return createServer((request, response) => {
    const path = (request.url ?? "").split("?")[0];
    if (request.method !== "GET" || path !== "/metrics") {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found\n");
      return;
    }
    metrics.render().then(
      (body) => {
        response.writeHead(200, { "Content-Type": metrics.contentType });
        response.end(body);
      },
      () => {
        response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Metrics unavailable\n");
      },
    );
  });
}

export const defaultMetrics = new Metrics({
  version: "0.1.0",
  revision: "unknown",
});

export function createMetrics(build: BuildInfo): Metrics {
  return new Metrics(build);
}
