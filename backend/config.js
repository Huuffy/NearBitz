module.exports = {
    database: {
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || 'postgres',
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || 5432,
        database: process.env.DB_NAME || 'sales_app'
    },
    osrm: {
        url: process.env.OSRM_URL || 'http://router.project-osrm.org'
    },
    photon: {
        url: process.env.PHOTON_URL || 'http://localhost:2322'
    },
    nominatim: {
        url: process.env.PHOTON_URL || 'http://localhost:2322'
    },
    jwt: {
        secret: process.env.JWT_SECRET || 'dev-secret-change-in-production',
        expiresIn: process.env.JWT_EXPIRES_IN || '15m',
        refreshExpiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || '7d'
    },
    upload: {
        dir: process.env.UPLOAD_DIR || './uploads',
        maxImageMb: parseInt(process.env.MAX_IMAGE_SIZE_MB) || 5,
        maxPdfMb: parseInt(process.env.MAX_PDF_SIZE_MB) || 20
    }
};
