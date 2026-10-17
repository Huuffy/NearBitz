const XLSX = require('xlsx');
const { normalize } = require('./product-normalizer');

// Canonical field → substrings to match in header (all lowercase)
const COLUMN_ALIASES = {
    quotation_no: ['quotation', 'quot no', 'quote no', 'order no', 'ref no', 'voucher', 'bill no', 'sr no', 'invoice no'],
    order_date:   ['date', 'order date', 'quot date', 'invoice date', 'bill date', 'transaction date'],
    status:       ['status', 'order status', 'quote status', 'stage'],
    customer_name:['customer', 'client', 'party', 'buyer', 'account', 'debtor', 'sold to', 'consignee'],
    address:      ['address', 'addr', 'billing address', 'ship address', 'location', 'site'],
    state:        ['state', 'province', 'region'],
    contact_name: ['contact', 'contact person', 'person name', 'attn'],
    email:        ['email', 'e-mail', 'mail id', 'contact email'],
    phone:        ['mobile', 'phone', 'mob no', 'cell', 'telephone', 'contact no', 'mobile no'],
    item_name:    ['item', 'product', 'material', 'description', 'goods', 'particulars', 'item name', 'product name'],
    quantity:     ['qty', 'quantity', 'total qty', 'total quantity', 'nos', 'units'],
    amount:       ['amount', 'total', 'value', 'total amount', 'net amount', 'net value', 'total value'],
};

function normalizeHeader(h) {
    return String(h).toLowerCase().replace(/[^a-z0-9 ]/g, '').trim().replace(/\s+/g, ' ');
}

function detectColumns(headers) {
    const detected = {};
    for (const header of headers) {
        const norm = normalizeHeader(header);
        let bestField = null, bestScore = 0;
        for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
            if (detected[field]) continue; // already mapped
            for (const alias of aliases) {
                if (norm === alias || norm.includes(alias) || alias.includes(norm)) {
                    const score = norm === alias ? 3 : norm.includes(alias) ? 2 : 1;
                    if (score > bestScore) { bestScore = score; bestField = field; }
                }
            }
        }
        if (bestField && bestScore > 0) detected[bestField] = header;
    }
    return detected;
}

function parseDate(val) {
    if (!val) return null;
    if (val instanceof Date) return val;
    const s = String(val).trim();
    // Excel serial number
    if (/^\d{5}$/.test(s)) {
        const d = XLSX.SSF.parse_date_code(parseInt(s));
        if (d) return new Date(d.y, d.m - 1, d.d);
    }
    // DD/MM/YYYY or DD-MM-YYYY
    const m1 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (m1) {
        const [, d, mo, y] = m1;
        return new Date(`${y.length === 2 ? '20' + y : y}-${mo.padStart(2,'0')}-${d.padStart(2,'0')}`);
    }
    // YYYY-MM-DD
    const m2 = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m2) return new Date(s);
    const d = new Date(s);
    return isNaN(d) ? null : d;
}

function parseAmount(val) {
    if (!val && val !== 0) return null;
    const s = String(val).replace(/[₹,\s]/g, '');
    const n = parseFloat(s);
    return isNaN(n) ? null : n;
}

function normalizeCustomerKey(name, address) {
    const n = String(name || '').toLowerCase()
        .replace(/\bpvt\.?\s*ltd\.?\b/g, '')
        .replace(/\bprivate\s+limited\b/g, '')
        .replace(/\bltd\.?\b/g, '')
        .replace(/\bllp\b/g, '')
        .replace(/\b&\s*co\.?\b/g, '')
        .replace(/\bindustries\b/g, '')
        .replace(/\benterprises\b/g, '')
        .trim().replace(/\s+/g, ' ');
    const a = String(address || '').toLowerCase().trim().slice(0, 50);
    return `${n}||${a}`;
}

async function parseERP(buffer, filename) {
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    if (rows.length < 2) return { error: 'File is empty or has no data rows', clients: [], column_mapping: {} };

    // Detect header row (first row with >50% non-numeric short cells)
    let headerRowIdx = 0;
    for (let i = 0; i < Math.min(5, rows.length); i++) {
        const r = rows[i];
        const textCells = r.filter(c => c && isNaN(Number(c)) && String(c).length < 60).length;
        if (textCells / r.length > 0.5) { headerRowIdx = i; break; }
    }

    const headers = rows[headerRowIdx].map(h => String(h).trim()).filter(Boolean);
    const columnMapping = detectColumns(headers);
    const dataRows = rows.slice(headerRowIdx + 1);

    // Group rows by customer (dedup within one upload)
    const customerMap = new Map();

    for (const row of dataRows) {
        const get = (field) => {
            const col = columnMapping[field];
            if (!col) return '';
            const idx = rows[headerRowIdx].findIndex(h => String(h).trim() === col);
            return idx >= 0 ? row[idx] : '';
        };

        const customerName = String(get('customer_name') || '').trim();
        if (!customerName) continue;

        const address   = String(get('address') || '').trim();
        const state     = String(get('state') || '').trim();
        const phone     = String(get('phone') || '').trim();
        const email     = String(get('email') || '').trim();
        const itemRaw   = String(get('item_name') || '').trim();
        const quantity  = parseAmount(get('quantity'));
        const amount    = parseAmount(get('amount'));
        const orderDate = parseDate(get('order_date'));
        const quotNo    = String(get('quotation_no') || '').trim();
        const status    = String(get('status') || '').trim();

        const key = normalizeCustomerKey(customerName, address);

        if (!customerMap.has(key)) {
            customerMap.set(key, {
                customer_name: customerName,
                address,
                state,
                phone,
                email,
                orders: [],
                last_order_date: null,
                last_order_amount: null,
                last_product_raw: null,
                total_amount: 0,
            });
        }

        const client = customerMap.get(key);

        // Update last order (most recent date wins)
        if (orderDate && (!client.last_order_date || orderDate > client.last_order_date)) {
            client.last_order_date = orderDate;
            client.last_order_amount = amount;
            client.last_product_raw = itemRaw;
        }
        if (amount) client.total_amount += amount;

        if (itemRaw) {
            const normalized = await normalize(itemRaw);
            client.orders.push({
                quotation_no: quotNo || null,
                order_date: orderDate,
                status: status || null,
                item_name_raw: itemRaw,
                category_id: normalized ? normalized.category_id : null,
                canonical_name: normalized ? normalized.canonical : itemRaw,
                quantity,
                amount,
            });
        }
    }

    return {
        clients: Array.from(customerMap.values()),
        column_mapping: columnMapping,
        rows_parsed: dataRows.length,
        customers_found: customerMap.size,
    };
}

module.exports = { parseERP, detectColumns };
