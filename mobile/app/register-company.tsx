import { useState, useEffect, useMemo } from 'react';
import {
  View, Text, TextInput, ScrollView, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/Colors';
import { apiClient } from '../services/api';
import { ENDPOINTS } from '../constants/Api';
import { notify } from '../utils/notify';

type Step = 1 | 2 | 3 | 4;

interface Category { id: number; name: string; slug: string; level: number; parent_id: number | null; keywords: string[]; }

const INDUSTRIES = [
  { slug: 'steel-metals',    label: 'Steel & Metals' },
  { slug: 'construction',    label: 'Construction' },
  { slug: 'chemicals',       label: 'Chemicals & Polymers' },
  { slug: 'electrical',      label: 'Electrical & Electronics' },
  { slug: 'textiles',        label: 'Textiles & Apparel' },
  { slug: 'automotive',      label: 'Automotive' },
  { slug: 'pharma',          label: 'Pharmaceuticals' },
  { slug: 'agriculture',     label: 'Agriculture & Agro' },
  { slug: 'packaging',       label: 'Packaging & Printing' },
  { slug: 'machinery',       label: 'Machinery & Equipment' },
  { slug: 'food-beverage',   label: 'Food & Beverages' },
  { slug: 'rubber-plastics', label: 'Rubber & Plastics' },
  { slug: 'paper',           label: 'Paper & Pulp' },
  { slug: 'it-tech',         label: 'IT & Technology' },
  { slug: 'logistics',       label: 'Logistics & Transport' },
];

export default function RegisterCompanyScreen() {
  const [step, setStep]     = useState<Step>(1);
  const [loading, setLoading] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [catLoading, setCatLoading] = useState(false);

  // Step 1
  const [name, setName]         = useState('');
  const [gstin, setGstin]       = useState('');
  const [phone, setPhone]       = useState('');
  const [website, setWebsite]   = useState('');
  const [address, setAddress]   = useState('');
  const [city, setCity]         = useState('');
  const [stateName, setStateName] = useState('');
  const [pincode, setPincode]   = useState('');

  // Step 2
  const [selectedIndustries, setSelectedIndustries] = useState<string[]>([]);
  const [description, setDescription] = useState('');

  // Step 3 — sell
  const [sellSearch, setSellSearch]       = useState('');
  const [selectedSellIds, setSelectedSellIds] = useState<number[]>([]);

  // Step 4 — buy
  const [buySearch, setBuySearch]         = useState('');
  const [selectedBuyIds, setSelectedBuyIds]   = useState<number[]>([]);

  useEffect(() => {
    if (step === 3 || step === 4) loadCategories();
  }, [step]);

  const loadCategories = async () => {
    if (categories.length) return;
    setCatLoading(true);
    try {
      const res = await apiClient.get(ENDPOINTS.companies.categories);
      setCategories(res.data.categories || []);
    } catch {
      // fallback to empty — user can still proceed
    } finally {
      setCatLoading(false);
    }
  };

  // All categories filtered by search term
  const filteredSell = useMemo(() => {
    const q = sellSearch.toLowerCase().trim();
    if (!q) return categories.slice(0, 60);
    return categories.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.keywords?.some(kw => kw.includes(q))
    ).slice(0, 40);
  }, [sellSearch, categories]);

  const filteredBuy = useMemo(() => {
    const q = buySearch.toLowerCase().trim();
    if (!q) return categories.slice(0, 60);
    return categories.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.keywords?.some(kw => kw.includes(q))
    ).slice(0, 40);
  }, [buySearch, categories]);

  const toggleSell = (id: number) =>
    setSelectedSellIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const toggleBuy = (id: number) =>
    setSelectedBuyIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const validateStep1 = () => {
    if (!name.trim())    { notify('Required', 'Company name is required'); return false; }
    if (!address.trim()) { notify('Required', 'Address is required'); return false; }
    if (!city.trim())    { notify('Required', 'City is required'); return false; }
    if (!stateName.trim()) { notify('Required', 'State is required'); return false; }
    if (gstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin)) {
      notify('Invalid GSTIN', 'GSTIN format is not valid'); return false;
    }
    return true;
  };

  const handleNext = () => {
    if (step === 1 && !validateStep1()) return;
    if (step < 4) setStep(s => (s + 1) as Step);
  };

  const handleBack = () => {
    if (step > 1) setStep(s => (s - 1) as Step);
    else router.back();
  };

  const handleSubmit = async () => {
    setLoading(true);
    try {
      await apiClient.post(ENDPOINTS.COMPANIES, {
        name:              name.trim(),
        gstin:             gstin.trim()    || undefined,
        phone:             phone.trim()    || undefined,
        website_url:       website.trim()  || undefined,
        address:           address.trim(),
        city:              city.trim(),
        state:             stateName.trim(),
        pincode:           pincode.trim()  || undefined,
        description:       description.trim() || undefined,
        industry_slugs:    selectedIndustries,
        products_sell_ids: selectedSellIds,
        products_buy_ids:  selectedBuyIds,
      });

      notify('Company registered', 'Your company profile is live. Nearby salesmen can now find you on the map.');
      router.replace('/(tabs)' as any);
    } catch (err: any) {
      notify('Error', err.response?.data?.error || 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const sellNames  = selectedSellIds.map(id => categories.find(c => c.id === id)?.name).filter(Boolean);
  const buyNames   = selectedBuyIds.map(id  => categories.find(c => c.id === id)?.name).filter(Boolean);
  const indLabels  = selectedIndustries.map(s => INDUSTRIES.find(i => i.slug === s)?.label || s);

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBack} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="arrow-back" size={22} color={Colors.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Register Company</Text>
        <Text style={styles.headerStep}>{step}/4</Text>
      </View>

      {/* Progress */}
      <View style={styles.progressBar}>
        <View style={[styles.progressFill, { width: `${(step / 4) * 100}%` as any }]} />
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">

        {/* ── STEP 1: Basic info ── */}
        {step === 1 && (
          <>
            <Text style={styles.stepTitle}>Basic Information</Text>
            <Field label="Company Name *"  value={name}        onChangeText={setName}        placeholder="e.g. Mehta Steel Traders Pvt Ltd" />
            <Field label="GSTIN"           value={gstin}       onChangeText={v => setGstin(v.toUpperCase())} placeholder="22AAAAA0000A1Z5" autoCapitalize="characters" maxLength={15} />
            <Field label="Phone"           value={phone}       onChangeText={setPhone}       placeholder="+91 98765 43210" keyboardType="phone-pad" />
            <Field label="Website"         value={website}     onChangeText={setWebsite}     placeholder="https://yourcompany.com" keyboardType="url" autoCapitalize="none" />
            <Field label="Full Address *"  value={address}     onChangeText={setAddress}     placeholder="Street, area" multiline />
            <Field label="City *"          value={city}        onChangeText={setCity}        placeholder="e.g. Mumbai" />
            <Field label="State *"         value={stateName}   onChangeText={setStateName}   placeholder="e.g. Maharashtra" />
            <Field label="Pincode"         value={pincode}     onChangeText={setPincode}     placeholder="400001" keyboardType="numeric" maxLength={6} />
          </>
        )}

        {/* ── STEP 2: Industry ── */}
        {step === 2 && (
          <>
            <Text style={styles.stepTitle}>Industry</Text>
            <Text style={styles.stepDesc}>Select all industries that apply to your business.</Text>

            <View style={styles.chipGrid}>
              {INDUSTRIES.map(ind => (
                <TouchableOpacity
                  key={ind.slug}
                  style={[styles.chip, selectedIndustries.includes(ind.slug) && styles.chipSelected]}
                  onPress={() => setSelectedIndustries(prev =>
                    prev.includes(ind.slug) ? prev.filter(s => s !== ind.slug) : [...prev, ind.slug]
                  )}
                >
                  <Text style={[styles.chipText, selectedIndustries.includes(ind.slug) && styles.chipTextSelected]}>
                    {ind.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[styles.label, { marginTop: 20 }]}>About your company</Text>
            <TextInput
              style={[styles.input, styles.textarea]}
              value={description}
              onChangeText={setDescription}
              placeholder="Briefly describe your company — key products, customers, specialisation…"
              multiline
              numberOfLines={4}
              placeholderTextColor={Colors.textLight}
            />
          </>
        )}

        {/* ── STEP 3: What do you SELL ── */}
        {step === 3 && (
          <>
            <Text style={styles.stepTitle}>What do you sell?</Text>
            <Text style={styles.stepDesc}>
              Select the products or materials your company sells. Salesmen searching for these will find you on the map.
            </Text>

            <View style={styles.searchRow}>
              <Ionicons name="search-outline" size={16} color={Colors.textSecondary} style={{ marginRight: 6 }} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search — e.g. impeller, tmt bars, pump casing…"
                placeholderTextColor={Colors.textLight}
                value={sellSearch}
                onChangeText={setSellSearch}
              />
              {sellSearch.length > 0 && (
                <TouchableOpacity onPress={() => setSellSearch('')}>
                  <Ionicons name="close-circle" size={16} color={Colors.textLight} />
                </TouchableOpacity>
              )}
            </View>

            {catLoading ? (
              <ActivityIndicator color={Colors.primary} style={{ marginTop: 24 }} />
            ) : (
              <View style={styles.chipGrid}>
                {filteredSell.map(cat => (
                  <TouchableOpacity
                    key={cat.id}
                    style={[styles.chip, cat.level === 2 && styles.chipLeaf, selectedSellIds.includes(cat.id) && styles.chipSelected]}
                    onPress={() => toggleSell(cat.id)}
                  >
                    <Text style={[styles.chipText, selectedSellIds.includes(cat.id) && styles.chipTextSelected]}>
                      {cat.name}
                    </Text>
                    {cat.level === 2 && !selectedSellIds.includes(cat.id) && (
                      <Text style={styles.chipLevel}>specific</Text>
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {selectedSellIds.length > 0 && (
              <View style={styles.selectedSummary}>
                <Text style={styles.selectedSummaryLabel}>Selected ({selectedSellIds.length})</Text>
                <Text style={styles.selectedSummaryText}>{sellNames.join(' · ')}</Text>
              </View>
            )}
          </>
        )}

        {/* ── STEP 4: What do you BUY ── */}
        {step === 4 && (
          <>
            <Text style={styles.stepTitle}>What do you buy?</Text>
            <Text style={styles.stepDesc}>
              Select materials and components your company purchases. Salesmen who sell these will be able to reach you directly.
            </Text>

            <View style={styles.searchRow}>
              <Ionicons name="search-outline" size={16} color={Colors.textSecondary} style={{ marginRight: 6 }} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search — e.g. mechanical seal, TMT bars, hdpe pipe…"
                placeholderTextColor={Colors.textLight}
                value={buySearch}
                onChangeText={setBuySearch}
              />
              {buySearch.length > 0 && (
                <TouchableOpacity onPress={() => setBuySearch('')}>
                  <Ionicons name="close-circle" size={16} color={Colors.textLight} />
                </TouchableOpacity>
              )}
            </View>

            {catLoading ? (
              <ActivityIndicator color={Colors.primary} style={{ marginTop: 24 }} />
            ) : (
              <View style={styles.chipGrid}>
                {filteredBuy.map(cat => (
                  <TouchableOpacity
                    key={cat.id}
                    style={[styles.chip, cat.level === 2 && styles.chipLeaf, selectedBuyIds.includes(cat.id) && styles.chipSelected]}
                    onPress={() => toggleBuy(cat.id)}
                  >
                    <Text style={[styles.chipText, selectedBuyIds.includes(cat.id) && styles.chipTextSelected]}>
                      {cat.name}
                    </Text>
                    {cat.level === 2 && !selectedBuyIds.includes(cat.id) && (
                      <Text style={styles.chipLevel}>specific</Text>
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {selectedBuyIds.length > 0 && (
              <View style={styles.selectedSummary}>
                <Text style={styles.selectedSummaryLabel}>Selected ({selectedBuyIds.length})</Text>
                <Text style={styles.selectedSummaryText}>{buyNames.join(' · ')}</Text>
              </View>
            )}

            {/* Review summary before submit */}
            <View style={styles.reviewCard}>
              <Text style={styles.reviewTitle}>Summary</Text>
              <ReviewRow label="Company"   value={name} />
              {gstin ? <ReviewRow label="GSTIN" value={gstin} /> : null}
              <ReviewRow label="Location"  value={`${city}, ${stateName}`} />
              {indLabels.length  > 0 && <ReviewRow label="Industries" value={indLabels.join(', ')} />}
              {sellNames.length  > 0 && <ReviewRow label="Sells"      value={sellNames.join(', ')} />}
              {buyNames.length   > 0 && <ReviewRow label="Buys"       value={buyNames.join(', ')} />}
            </View>
          </>
        )}

      </ScrollView>

      {/* Footer */}
      <View style={styles.footer}>
        {step < 4 ? (
          <TouchableOpacity style={styles.nextBtn} onPress={handleNext}>
            <Text style={styles.nextBtnText}>Continue →</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.nextBtn, loading && styles.nextBtnDisabled]}
            onPress={handleSubmit}
            disabled={loading}
          >
            {loading
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.nextBtnText}>Register Company</Text>
            }
          </TouchableOpacity>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

function Field({ label, value, onChangeText, placeholder, multiline, keyboardType, autoCapitalize, maxLength }: {
  label: string; value: string; onChangeText: (v: string) => void; placeholder?: string;
  multiline?: boolean; keyboardType?: any; autoCapitalize?: any; maxLength?: number;
}) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, multiline && styles.inputMulti]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={Colors.textLight}
        multiline={multiline}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize || 'sentences'}
        maxLength={maxLength}
      />
    </View>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.reviewRow}>
      <Text style={styles.reviewLabel}>{label}</Text>
      <Text style={styles.reviewValue} numberOfLines={2}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: Colors.bg },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: Platform.OS === 'ios' ? 56 : 16, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: Colors.borderLight,
  },
  headerTitle: { fontSize: 16, fontWeight: '700', color: Colors.text },
  headerStep:  { fontSize: 13, color: Colors.textSecondary, fontWeight: '600' },

  progressBar:  { height: 3, backgroundColor: Colors.borderLight },
  progressFill: { height: 3, backgroundColor: Colors.primary },

  body: { padding: 20, paddingBottom: 48 },

  stepTitle: { fontSize: 20, fontWeight: '700', color: Colors.text, marginBottom: 6 },
  stepDesc:  { fontSize: 14, color: Colors.textSecondary, marginBottom: 20, lineHeight: 20 },

  fieldGroup: { marginBottom: 16 },
  label:  { fontSize: 13, fontWeight: '600', color: Colors.textSecondary, marginBottom: 6 },
  input:  {
    borderWidth: 1, borderColor: Colors.border, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, color: Colors.text, backgroundColor: Colors.bg,
  },
  inputMulti: { minHeight: 80, textAlignVertical: 'top' },
  textarea:   { minHeight: 100, textAlignVertical: 'top' },

  chipGrid:  { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  chip: {
    borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8,
    borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.bg,
    flexDirection: 'row', alignItems: 'center', gap: 4,
  },
  chipLeaf:  { borderStyle: 'dashed' },
  chipSelected: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { fontSize: 13, color: Colors.text, fontWeight: '500' },
  chipTextSelected: { color: '#fff' },
  chipLevel: { fontSize: 10, color: Colors.textLight, marginLeft: 2 },

  searchRow: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderColor: Colors.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, marginBottom: 16,
    backgroundColor: Colors.bg,
  },
  searchInput: { flex: 1, fontSize: 14, color: Colors.text, paddingVertical: 0 },

  selectedSummary: {
    marginTop: 16, padding: 12, borderRadius: 10,
    backgroundColor: `${Colors.primary}12`, borderWidth: 1, borderColor: `${Colors.primary}30`,
  },
  selectedSummaryLabel: { fontSize: 12, fontWeight: '700', color: Colors.primary, marginBottom: 4 },
  selectedSummaryText:  { fontSize: 13, color: Colors.text, lineHeight: 20 },

  reviewCard: {
    marginTop: 24, backgroundColor: Colors.bgSecondary, borderRadius: 12,
    padding: 14, borderWidth: 1, borderColor: Colors.borderLight,
  },
  reviewTitle: { fontSize: 14, fontWeight: '700', color: Colors.text, marginBottom: 10 },
  reviewRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
    paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: Colors.borderLight,
  },
  reviewLabel: { fontSize: 13, color: Colors.textSecondary, flex: 1 },
  reviewValue: { fontSize: 13, color: Colors.text, fontWeight: '500', flex: 2, textAlign: 'right' },

  footer: { padding: 16, borderTopWidth: 1, borderTopColor: Colors.borderLight },
  nextBtn: { backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  nextBtnDisabled: { opacity: 0.6 },
  nextBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
