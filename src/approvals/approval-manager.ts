import { logger } from "../utils/logger.js";
import { generateId } from "../utils/helpers.js";
import type { RiskLevel } from "../tools/base-tool.js";

export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";

export interface ApprovalRequest {
  id: string;
  toolName: string;
  riskLevel: RiskLevel | "CRITICAL";
  description: string;
  requester: string;
  status: ApprovalStatus;
  createdAt: number;
  resolvedAt?: number;
  resolvedBy?: string;
  metadata?: Record<string, unknown>;
}

export interface ApprovalOutcome {
  allowed: boolean;
  reason: string;
  requestId?: string;
}

const APPROVAL_LOG = (msg: string) => logger.info(`[APPROVAL] ${msg}`);
const APPROVAL_WARN = (msg: string) => logger.warn(`[APPROVAL] ${msg}`);

export class ApprovalManager {
  private requests: Map<string, ApprovalRequest> = new Map();

  async check(
    toolName: string,
    riskLevel: RiskLevel | "CRITICAL",
    source: string,
    metadata?: Record<string, unknown>,
  ): Promise<ApprovalOutcome> {
    switch (riskLevel) {
      case "LOW":
        return this.handleLow(toolName);

      case "MEDIUM":
        return this.handleMedium(toolName, source, metadata);

      case "HIGH":
        return this.handleHigh(toolName, source, metadata);

      case "CRITICAL":
        return this.handleCritical(toolName);

      default:
        return { allowed: false, reason: `Unknown risk level: ${String(riskLevel)}` };
    }
  }

  private handleLow(toolName: string): ApprovalOutcome {
    APPROVAL_LOG(`AUTO-APPROVED  tool=${toolName}  risk=LOW`);
    return { allowed: true, reason: "LOW risk — auto-approved" };
  }

  private handleMedium(
    toolName: string,
    source: string,
    metadata?: Record<string, unknown>,
  ): ApprovalOutcome {
    APPROVAL_WARN(`MEDIUM risk executed  tool=${toolName}  source=${source}`);
    APPROVAL_LOG(`granted  tool=${toolName}  risk=MEDIUM`);

    const req = this.createRequest(toolName, "MEDIUM", source, metadata);
    req.status = "approved";
    req.resolvedAt = Date.now();
    req.resolvedBy = "system:auto";

    return { allowed: true, reason: "MEDIUM risk — executed with warning", requestId: req.id };
  }

  private async handleHigh(
    toolName: string,
    source: string,
    metadata?: Record<string, unknown>,
  ): Promise<ApprovalOutcome> {
    const req = this.createRequest(toolName, "HIGH", source, metadata);

    logger.warn(`[APPROVAL REQUIRED] tool=${toolName}  requestId=${req.id}  risk=HIGH`);
    APPROVAL_WARN(`Awaiting approval for HIGH risk tool: ${toolName} (${req.id})`);

    await new Promise<void>((r) => setTimeout(r, 800));

    req.status = "approved";
    req.resolvedAt = Date.now();
    req.resolvedBy = "system:simulator";

    APPROVAL_LOG(`granted  tool=${toolName}  requestId=${req.id}  risk=HIGH  approver=system:simulator`);

    return { allowed: true, reason: "HIGH risk — simulated approval granted", requestId: req.id };
  }

  private handleCritical(toolName: string): ApprovalOutcome {
    APPROVAL_WARN(`BLOCKED  tool=${toolName}  risk=CRITICAL — execution denied`);
    logger.error(`[APPROVAL] denied  tool=${toolName}  risk=CRITICAL`);
    return { allowed: false, reason: `CRITICAL risk — tool "${toolName}" is blocked from execution` };
  }

  private createRequest(
    toolName: string,
    riskLevel: RiskLevel | "CRITICAL",
    requester: string,
    metadata?: Record<string, unknown>,
  ): ApprovalRequest {
    const req: ApprovalRequest = {
      id: generateId("apr"),
      toolName,
      riskLevel,
      description: `Tool "${toolName}" requested by ${requester}`,
      requester,
      status: "pending",
      createdAt: Date.now(),
      metadata,
    };
    this.requests.set(req.id, req);
    return req;
  }

  approve(requestId: string, approver: string): ApprovalRequest {
    const req = this.requests.get(requestId);
    if (!req) throw new Error(`Approval request not found: ${requestId}`);
    if (req.status !== "pending") throw new Error(`Request ${requestId} is already ${req.status}`);

    req.status = "approved";
    req.resolvedAt = Date.now();
    req.resolvedBy = approver;
    APPROVAL_LOG(`granted  requestId=${requestId}  approver=${approver}`);
    return req;
  }

  reject(requestId: string, rejector: string): ApprovalRequest {
    const req = this.requests.get(requestId);
    if (!req) throw new Error(`Approval request not found: ${requestId}`);
    if (req.status !== "pending") throw new Error(`Request ${requestId} is already ${req.status}`);

    req.status = "rejected";
    req.resolvedAt = Date.now();
    req.resolvedBy = rejector;
    logger.warn(`[APPROVAL] denied  requestId=${requestId}  rejector=${rejector}`);
    return req;
  }

  getRequest(requestId: string): ApprovalRequest | undefined {
    return this.requests.get(requestId);
  }

  getPendingRequests(): ApprovalRequest[] {
    return Array.from(this.requests.values()).filter((r) => r.status === "pending");
  }

  getAllRequests(): ApprovalRequest[] {
    return Array.from(this.requests.values());
  }
}

export const approvalManager = new ApprovalManager();
