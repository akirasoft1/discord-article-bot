// logger.js
const winston = require('winston');

const logger = winston.createLogger({
  level: (process.env.LOG_LEVEL || 'debug').toLowerCase(),  // This controls winston's log level
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.printf(info => {
          return `${info.timestamp} ${info.level}: ${info.message}`;
        })
      )
    })
  ]
});

// Add the debug method if it doesn't exist
if (!logger.debug) {
  logger.debug = logger.log.bind(logger, 'debug');
}

logger.info(`Logger initialized - Level: ${logger.level}`);
logger.console = console.log;
module.exports = logger;