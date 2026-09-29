
const fs = require('fs');
const path = require('path');

const logFilePath = path.join(__dirname, '../logs/operations.log');

// Ensure logs directory exists
if (!fs.existsSync(path.dirname(logFilePath))) {
    fs.mkdirSync(path.dirname(logFilePath), { recursive: true });
}

// Middleware for logging
const logger = (req, res, next) => {
    const { method, url, body, params, query, user } = req;

    // Log only DELETE, POST, and PUT methods
    if (['DELETE', 'POST', 'PUT'].includes(method)) {
        
        // const username = user?.firstname || user?.lastname || 'Unknown User';

        const logEntry = `${new Date().toISOString()} - ${method} ${url}  - Body: ${JSON.stringify(body)} \n`;

        fs.appendFile(logFilePath, logEntry, (err) => {
            if (err) {
                console.error("Logging error:", err);
            }
        });
    }

    next();
};

module.exports = logger;
