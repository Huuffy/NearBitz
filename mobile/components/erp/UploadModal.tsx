import { useState } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Platform,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/Colors';
import { apiClient } from '../../services/api';
import { ENDPOINTS } from '../../constants/Api';
import { useMapStore } from '../../stores/mapStore';

interface UploadResult {
  id: string;
  status: 'processing' | 'geocoding' | 'done' | 'failed';
  rows_total: number;
  rows_imported: number;
  rows_failed: number;
  error_message?: string | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Props {
  visible: boolean;
  onClose: () => void;
  onSuccess?: (result: UploadResult) => void;
}

type Stage = 'idle' | 'picking' | 'uploading' | 'processing' | 'done' | 'error';

export default function UploadModal({ visible, onClose, onSuccess }: Props) {
  const [stage, setStage] = useState<Stage>('idle');
  const [result, setResult] = useState<UploadResult | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  const pickAndUpload = async () => {
    try {
      setStage('picking');

      const picked = await DocumentPicker.getDocumentAsync({
        type: [
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
          'application/vnd.ms-excel', // xls
          'text/csv',
          'text/comma-separated-values',
        ],
        copyToCacheDirectory: true,
      });

      if (picked.canceled || !picked.assets || picked.assets.length === 0) {
        setStage('idle');
        return;
      }

      const file = picked.assets[0];

      if (file.size && file.size > 10 * 1024 * 1024) {
        setStage('error');
        setErrorMsg('File is too large. Maximum size is 10 MB.');
        return;
      }

      setStage('uploading');

      const form = new FormData();
      if (Platform.OS === 'web' && (file as any).file) {
        // Browsers need the real File object; the {uri,name,type} shape only works on native.
        form.append('file', (file as any).file, file.name);
      } else {
        form.append('file', {
          uri: file.uri,
          name: file.name || 'erp-upload.xlsx',
          type: file.mimeType || 'application/octet-stream',
        } as any);
      }

      const response = await apiClient.post(ENDPOINTS.UPLOAD_ERP, form, {
        headers: Platform.OS === 'web' ? undefined : { 'Content-Type': 'multipart/form-data' },
        timeout: 60000,
      });
      const uploadId: string = response.data.upload_id;

      // The server geocodes in the background; poll until it finishes (up to ~10 minutes).
      setStage('processing');
      for (let i = 0; i < 300; i++) {
        await sleep(2000);
        const s = await apiClient.get(ENDPOINTS.upload.erpStatus(uploadId));
        const up: UploadResult = s.data.upload;
        setResult(up);
        if (up.status === 'done') {
          setStage('done');
          await useMapStore.getState().loadMyClientPins();
          onSuccess?.(up);
          return;
        }
        if (up.status === 'failed') {
          setStage('error');
          setErrorMsg(up.error_message || 'The file could not be processed.');
          return;
        }
      }
      setStage('error');
      setErrorMsg('Processing is taking longer than expected. Your clients will appear on the map when it finishes.');

    } catch (err: any) {
      setStage('error');
      if (err.response?.data?.error) {
        setErrorMsg(err.response.data.error);
      } else if (err.message) {
        setErrorMsg(err.message);
      } else {
        setErrorMsg('Upload failed. Please try again.');
      }
    }
  };

  const reset = () => {
    setStage('idle');
    setResult(null);
    setErrorMsg('');
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Upload ERP Data</Text>
          <TouchableOpacity onPress={handleClose} style={styles.closeBtn}>
            <Ionicons name="close" size={20} color={Colors.textSecondary} />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          {stage === 'idle' && (
            <>
              <View style={styles.infoBox}>
                <Text style={styles.infoTitle}>What this does</Text>
                <Text style={styles.infoText}>
                  Upload your ERP quotation file and your customers appear as red pins on your map.
                  Only you can see them. Customers without a street address are saved but not pinned.
                </Text>
              </View>

              <View style={styles.columnsBox}>
                <Text style={styles.columnsTitle}>Expected columns (auto-detected)</Text>
                {[
                  ['Customer Name', 'Who you sold to'],
                  ['Address / State', 'For map pin placement'],
                  ['Item Name', 'What they bought'],
                  ['Total Amount', 'Order value (₹)'],
                  ['Date', 'Order date'],
                  ['Mobile No', 'Tap-to-call on the card'],
                ].map(([col, desc]) => (
                  <View key={col} style={styles.columnRow}>
                    <Text style={styles.columnName}>{col}</Text>
                    <Text style={styles.columnDesc}>{desc}</Text>
                  </View>
                ))}
              </View>

              <TouchableOpacity style={styles.pickBtn} onPress={pickAndUpload}>
                <Text style={styles.pickBtnText}>Choose Excel / CSV File</Text>
              </TouchableOpacity>
              <Text style={styles.hint}>Supported: .xlsx, .xls, .csv · Max 10 MB</Text>
            </>
          )}

          {(stage === 'picking' || stage === 'uploading' || stage === 'processing') && (
            <View style={styles.progressBox}>
              <ActivityIndicator size="large" color={Colors.primary} />
              <Text style={styles.progressText}>
                {stage === 'picking' ? 'Opening file picker…'
                  : stage === 'uploading' ? 'Uploading file…'
                  : result?.rows_total ? `Finding addresses for ${result.rows_total} customers…`
                  : 'Reading columns…'}
              </Text>
              {stage === 'processing' && (
                <Text style={styles.progressSub}>
                  Each address is located on the map. You can keep this open or close it; pins appear when it finishes.
                </Text>
              )}
            </View>
          )}

          {stage === 'done' && result && (
            <View style={styles.resultBox}>
              <Ionicons name="checkmark-circle" size={64} color={Colors.success} style={styles.resultIcon} />
              <Text style={styles.resultTitle}>Clients imported</Text>

              <View style={styles.resultStats}>
                <View style={styles.statItem}>
                  <Text style={styles.statNumber}>{result.rows_imported - result.rows_failed}</Text>
                  <Text style={styles.statLabel}>Pinned on map</Text>
                </View>
                {result.rows_failed > 0 && (
                  <View style={styles.statItem}>
                    <Text style={[styles.statNumber, { color: Colors.textSecondary }]}>{result.rows_failed}</Text>
                    <Text style={styles.statLabel}>No precise address</Text>
                  </View>
                )}
              </View>

              {result.rows_failed > 0 && (
                <Text style={styles.geocodingNote}>
                  {result.rows_failed} customers were saved without a pin because their address could not be
                  located to a street. Add a full street address in your ERP export and upload again to pin them.
                </Text>
              )}

              <TouchableOpacity style={styles.doneBtn} onPress={handleClose}>
                <Text style={styles.doneBtnText}>View on Map</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.uploadAnotherBtn} onPress={reset}>
                <Text style={styles.uploadAnotherText}>Upload Another File</Text>
              </TouchableOpacity>
            </View>
          )}

          {stage === 'error' && (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={64} color={Colors.warning} style={styles.errorIcon} />
              <Text style={styles.errorTitle}>Upload Failed</Text>
              <Text style={styles.errorMsg}>{errorMsg}</Text>
              <TouchableOpacity style={styles.retryBtn} onPress={reset}>
                <Text style={styles.retryBtnText}>Try Again</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  title: { fontSize: 18, fontWeight: '700', color: Colors.text },
  closeBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  closeBtnText: { fontSize: 18, color: Colors.textSecondary },

  body: { padding: 20, paddingBottom: 60 },

  infoBox: {
    backgroundColor: `${Colors.primary}10`,
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  infoTitle: { fontSize: 14, fontWeight: '700', color: Colors.primary, marginBottom: 6 },
  infoText: { fontSize: 13, color: Colors.text, lineHeight: 19 },

  columnsBox: {
    backgroundColor: Colors.bgSecondary,
    borderRadius: 12,
    padding: 14,
    marginBottom: 24,
  },
  columnsTitle: { fontSize: 13, fontWeight: '700', color: Colors.textSecondary, marginBottom: 10 },
  columnRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  columnName: { fontSize: 13, fontWeight: '600', color: Colors.text },
  columnDesc: { fontSize: 12, color: Colors.textSecondary },

  pickBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 10,
  },
  pickBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  hint: { textAlign: 'center', fontSize: 12, color: Colors.textLight },

  progressBox: { alignItems: 'center', paddingTop: 60, gap: 16 },
  progressText: { fontSize: 16, fontWeight: '600', color: Colors.text },
  progressSub: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center', paddingHorizontal: 32, lineHeight: 19 },

  resultBox: { alignItems: 'center', paddingTop: 20 },
  resultIcon: { marginBottom: 12 },
  resultTitle: { fontSize: 20, fontWeight: '700', color: Colors.text, marginBottom: 20 },

  resultStats: { flexDirection: 'row', gap: 24, marginBottom: 24 },
  statItem: { alignItems: 'center' },
  statNumber: { fontSize: 28, fontWeight: '700', color: Colors.primary },
  statLabel: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },

  productsBox: {
    width: '100%',
    backgroundColor: Colors.bgSecondary,
    borderRadius: 12,
    padding: 14,
    marginBottom: 20,
  },
  productsTitle: { fontSize: 13, fontWeight: '700', color: Colors.textSecondary, marginBottom: 10 },
  productRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  productName: { fontSize: 13, color: Colors.text },
  productCount: { fontSize: 12, color: Colors.textSecondary },

  geocodingNote: {
    fontSize: 13,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 19,
    paddingHorizontal: 20,
    marginBottom: 24,
  },

  doneBtn: {
    width: '100%',
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 12,
  },
  doneBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },

  uploadAnotherBtn: {
    width: '100%',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  uploadAnotherText: { color: Colors.primary, fontSize: 14, fontWeight: '600' },

  errorBox: { alignItems: 'center', paddingTop: 60 },
  errorIcon: { marginBottom: 12 },
  errorTitle: { fontSize: 20, fontWeight: '700', color: Colors.text, marginBottom: 10 },
  errorMsg: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
    paddingHorizontal: 32,
    lineHeight: 20,
    marginBottom: 28,
  },
  retryBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingHorizontal: 40,
    paddingVertical: 14,
  },
  retryBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
