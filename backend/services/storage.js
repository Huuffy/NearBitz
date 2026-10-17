/**
 * File storage abstraction. All file I/O goes through this module.
 * Current implementation: local disk under uploads/
 * Phase 4: swap this file only for S3/Cloudflare R2 — interface unchanged.
 */

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const UPLOAD_DIR = process.env.UPLOAD_DIR
    ? path.resolve(process.env.UPLOAD_DIR)
    : path.join(__dirname, '../uploads');

const CONTEXT_DIRS = {
    company_logo:    'companies/logos',
    company_cover:   'companies/covers',
    product:         'products/images',
    catalogue:       'products/catalogues',
    post:            'posts/media',
    erp:             'erp',
};

function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/**
 * Store a file buffer.
 * @param {Buffer} buffer  - File contents
 * @param {string} originalName - Original filename (used only for extension)
 * @param {string} context - One of the CONTEXT_DIRS keys
 * @returns {{ url: string, path: string }}
 */
async function upload(buffer, originalName, context) {
    const subDir = CONTEXT_DIRS[context] || 'misc';
    const ext = path.extname(originalName || '').toLowerCase() || '.bin';
    const filename = `${uuidv4()}${ext}`;
    const destDir = path.join(UPLOAD_DIR, subDir);

    ensureDir(destDir);

    const destPath = path.join(destDir, filename);
    fs.writeFileSync(destPath, buffer);

    // URL path served by Express via app.use('/files', express.static(uploads/))
    const url = `/files/${subDir}/${filename}`;

    return { url, path: destPath };
}

/**
 * Delete a file by its URL path (as returned by upload()).
 * @param {string} url - e.g. "/files/companies/logos/uuid.jpg"
 */
async function remove(url) {
    if (!url || !url.startsWith('/files/')) return;
    const rel = url.replace('/files/', '');
    const absPath = path.join(UPLOAD_DIR, rel);
    if (fs.existsSync(absPath)) fs.unlinkSync(absPath);
}

module.exports = { upload, remove };
