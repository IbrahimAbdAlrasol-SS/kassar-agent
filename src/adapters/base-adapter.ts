import { logger } from "../utils/logger.js";

export interface AdapterOptions {
  name: string;
  retries?: number;
  timeoutMs?: number;
}

export abstract class BaseAdapter {
  readonly name: string;
  protected retries: number;
  protected timeoutMs: number;

  constructor(options: AdapterOptions) {
    this.name = options.name;
    this.retries = options.retries ?? 3;
    this.timeoutMs = options.timeoutMs ?? 30000;
  }

  async connect(): Promise<void> {
    logger.info(`Adapter connecting: ${this.name}`);
    await this.onConnect();
    logger.info(`Adapter connected: ${this.name}`);
  }

  async disconnect(): Promise<void> {
    logger.info(`Adapter disconnecting: ${this.name}`);
    await this.onDisconnect();
    logger.info(`Adapter disconnected: ${this.name}`);
  }

  abstract isConnected(): boolean;
  protected abstract onConnect(): Promise<void>;
  protected abstract onDisconnect(): Promise<void>;
}
