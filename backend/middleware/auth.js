const jwt = require('jsonwebtoken');
const config = require('../config');

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, error: 'Access token required' });
    try {
        req.user = jwt.verify(token, config.jwt.secret);
        next();
    } catch {
        res.status(401).json({ success: false, error: 'Invalid or expired token' });
    }
}

function requireRole(...roles) {
    return (req, res, next) => {
        if (!req.user) return res.status(401).json({ success: false, error: 'Not authenticated' });
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ success: false, error: 'Insufficient permissions' });
        }
        next();
    };
}

function requireCompanyAccess(req, res, next) {
    if (!req.user) return res.status(401).json({ success: false, error: 'Not authenticated' });
    if (req.user.role === 'platform_admin') return next();
    if (req.user.company_id !== req.params.id) {
        return res.status(403).json({ success: false, error: 'No access to this company' });
    }
    next();
}

function optionalAuth(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (token) {
        try { req.user = jwt.verify(token, config.jwt.secret); } catch { req.user = null; }
    }
    next();
}

module.exports = { authenticateToken, requireRole, requireCompanyAccess, optionalAuth };
