import winston from 'winston';
import path from 'path';
import fs from 'fs';

/**
 * Centralized logger for the supervisor application
 */
export const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
        winston.format.timestamp({
            format: 'YYYY-MM-DD HH:mm:ss'
        }),
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message }) => {
            return `${timestamp} [${level}]: ${message}`;
        })
    ),
    transports: [new winston.transports.Console()]
});

/**
 * Reconfigures the logger for TUI Chat Mode, diverting all output
 * to a file to prevent polluting the interactive terminal.
 */
export function configureChatLogging(homeDir: string): void {
    logger.clear();
    const logDir = path.join(homeDir, 'logs');
    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
    }
    logger.add(
        new winston.transports.File({
            filename: path.join(logDir, 'chat.log'),
            level: process.env.LOG_LEVEL || 'info',
            format: winston.format.combine(
                winston.format.timestamp({
                    format: 'YYYY-MM-DD HH:mm:ss'
                }),
                winston.format.uncolorize(), // No ANSI color codes in log files
                winston.format.printf(({ timestamp, level, message }) => {
                    return `${timestamp} [${level}]: ${message}`;
                })
            )
        })
    );
}

/**
 * Configures the logger for Daemon/Background mode, writing logs to
 * the application's log directory for traceability and debugging.
 */
export function configureDaemonLogging(homeDir: string): void {
    const logDir = path.join(homeDir, 'logs');
    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
    }
    // Add file transport WITHOUT clearing console transport (keep both)
    logger.add(
        new winston.transports.File({
            filename: path.join(logDir, 'supervisor.log'),
            level: process.env.LOG_LEVEL || 'debug', // Default to debug for full traceability
            format: winston.format.combine(
                winston.format.timestamp({
                    format: 'YYYY-MM-DD HH:mm:ss'
                }),
                winston.format.uncolorize(),
                winston.format.printf(({ timestamp, level, message }) => {
                    return `${timestamp} [${level}]: ${message}`;
                })
            )
        })
    );
    logger.info(`📝 Daemon logging enabled: ${path.join(logDir, 'supervisor.log')}`);
}

export default logger;
