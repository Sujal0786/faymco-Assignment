require('dotenv').config();
const app = require('./app');
const db = require('./database/db');

const PORT = process.env.PORT || 3000;

// Test DB Connection on startup
db.raw('SELECT 1')
  .then(() => {
    console.log('Database connection has been established successfully.');
    app.listen(PORT, () => {
      console.log(
        `Server is running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`
      );
    });
  })
  .catch((err) => {
    console.error('Unable to connect to the database:', err.message);
    process.exit(1);
  });
