import winston from "winston";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { mkdirSync, existsSync } from "fs";
import { config } from "../config/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, "..", "..");
const logDir = resolve(projectRoot, "logs");

if (!existsSync(logDir)) {
  mkdirSync(logDir, { recursive: true });
}

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss.SSS" }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
    const stackStr = stack ? `\n${stack}` : "";
    return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}${stackStr}`;
  }),
);

const jsonFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json(),
);

export const logger = winston.createLogger({
  level: config.logging.level,
  defaultMeta: { service: config.agent.name },
  transports: [
    new winston.transports.Console({
      format: logFormat,
    }),
    new winston.transports.File({
      filename: resolve(logDir, "app.log"),
      format: jsonFormat,
      maxsize: parseMaxSize(config.logging.maxSize),
      maxFiles: config.logging.maxFiles,
    }),
    new winston.transports.File({
      filename: resolve(logDir, "error.log"),
      level: "error",
      format: jsonFormat,
      maxsize: parseMaxSize(config.logging.maxSize),
      maxFiles: config.logging.maxFiles,
    }),
  ],
});

function parseMaxSize(size: string): number {
  const match = size.match(/^(\d+)(k|m|g)?$/i);
  if (!match) return 10 * 1024 * 1024;
  const num = parseInt(match[1]!, 10);
  const unit = (match[2] || "b").toLowerCase();
  switch (unit) {
    case "k":
      return num * 1024;
    case "m":
      return num * 1024 * 1024;
    case "g":
      return num * 1024 * 1024 * 1024;
    default:
      return num;
  }
}
