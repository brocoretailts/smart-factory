// server.js

const express = require('express');
const bodyParser = require('body-parser');
const morgan = require('morgan');
const helmet = require('helmet');
const cors = require('cors');

const app = express();

// Middleware
app.use(helmet()); // Security headers
app.use(cors()); // Enable CORS
app.use(bodyParser.json()); // Parsing JSON requests
app.use(morgan('combined')); // Logging

// Middlewares for role-based permissions
app.use((req, res, next) => {
    const userRole = req.headers['role']; // Assuming role is sent as a header
    if (userRole !== 'admin') {
        return res.status(403).send('Permission denied'); // Role-based permission handling
    }
    next();
});

// Route for order tracking
app.get('/orders/:id', (req, res) => {
    const orderId = req.params.id;
    // Logic to retrieve order from database
    // Include data quality checks
    if (!orderId) {
        return res.status(400).send('Order ID is required');
    }
    // Fetch order logic...
    res.send(`Order details for ${orderId}`);
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Something broke!');
});

// Audit trails
app.use((req, res, next) => {
    console.log(`Audit Trail: ${req.method} ${req.url} - ${new Date().toISOString()}`);
    next();
});

// Health check endpoint
app.get('/health', (req, res) => res.send('OK'));

// Server performance optimizations
const startServer = () => {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
};

startServer();

// Additional features can be added below as needed...