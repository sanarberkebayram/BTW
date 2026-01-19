import fs from "node:fs";
import path from "node:path";
import os from "node:os";

class FileLogger {
  private logPath: string;

  constructor() {
    const home = os.homedir();
    const logDir = path.join(home, ".btw", "logs");
    try {
      fs.mkdirSync(logDir, { recursive: true });
    } catch {
      // best-effort
    }
    this.logPath = path.join(logDir, "btw-mcp.log");
  }

  private write(level: string, message: string): void {
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] [${level}] ${message}\n`;
    try {
      fs.appendFileSync(this.logPath, logLine);
    } catch {
      // silent fail - can't log if logging fails
    }
  }

  warn(message: string): void {
    this.write("WARN", message);
  }

  error(message: string): void {
    this.write("ERROR", message);
  }

  info(message: string): void {
    this.write("INFO", message);
  }
}

export const logger = new FileLogger();
