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

export default logger;
