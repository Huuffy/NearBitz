// Product normalizer — stub. Alias/regex approach removed.
// ERP product name → HSN mapping will be handled via the approach defined later.
module.exports = {
    normalize: async (rawName) => ({ category_id: null, canonical: rawName, method: 'unmatched', confidence: 0.0 }),
};
