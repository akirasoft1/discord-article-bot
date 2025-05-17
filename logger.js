const winston = require('winston');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info', // Set log level via environment variable
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => `${timestamp} [${level.toUpperCase()}]: ${message}`)
  ),
  transports: [
    new winston.transports.Console(), // Log to console
  ],
});

module.exports = logger;
