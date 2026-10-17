const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Simple request logger
app.use((req, _res, next) => {
  console.log(`${new Date().toISOString().slice(11,19)} ${req.method} ${req.path}${req.method==='GET'&&Object.keys(req.query).length?'?'+new URLSearchParams(req.query).toString().slice(0,80):''}`);
  next();
});

// Compress all responses (gzip) — critical for 5MB all-pins payload
app.use(compression());

// Security middleware
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
const corsOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map(s => s.trim())
    : ['http://localhost:8080', 'http://localhost:8081', 'http://localhost:19006'];
app.use(cors({
    origin: (origin, cb) => {
        // Allow requests with no origin (curl, mobile apps) or from allowed list
        if (!origin || corsOrigins.some(o => origin.startsWith(o))) return cb(null, true);
        // Also allow any IP on port 8081 or 3000 (dev hotspot/LAN)
        if (/^http:\/\/\d+\.\d+\.\d+\.\d+:(8081|3000|19006)$/.test(origin)) return cb(null, true);
        cb(new Error('CORS: ' + origin + ' not allowed'));
    },
    credentials: true,
}));
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));

// Serve uploaded files
app.use('/files', express.static(path.join(__dirname, 'uploads')));

// Rate limiters
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: { success: false, error: 'Too many requests' } });
const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 200, message: { success: false, error: 'Too many requests' } });

app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/', apiLimiter);

// Routes
app.use('/api/auth',      require('./routes/auth'));
app.use('/api/map',       require('./routes/map'));
app.use('/api/companies', require('./routes/companies'));
app.use('/api/feed',      require('./routes/feed'));
app.use('/api/meetings',  require('./routes/meetings'));
app.use('/api/upload',    require('./routes/upload'));
app.use('/api/users',     require('./routes/users'));

app.get('/health', (req, res) => res.json({ status: 'ok', app: 'GeoSales.ai', timestamp: new Date().toISOString() }));

// Global error handler
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(err.status || 500).json({ success: false, error: err.message || 'Internal server error' });
});

app.listen(PORT, () => {
    console.log(`GeoSales.ai backend running on http://localhost:${PORT}`);
});

module.exports = app;
