const express = require('express');
const apiRoutes = require('./routes/api');
const errorHandler = require('./middleware/errorHandler');

const app = express();

// Standard middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API Routes
app.use('/api', apiRoutes);

// 404 handler
app.use((req, res, next) => {
  const err = new Error('Resource not found');
  err.statusCode = 404;
  next(err);
});

// Central error handler
app.use(errorHandler);

module.exports = app;
