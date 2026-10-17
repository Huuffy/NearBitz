import { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/Colors';
import { useAuthStore } from '../../stores/authStore';
import UploadModal from '../../components/erp/UploadModal';
import { confirmAction } from '../../utils/notify';

export default function ProfileScreen() {
  const { user, logout } = useAuthStore();
  const [uploadVisible, setUploadVisible] = useState(false);

  const handleLogout = async () => {
    if (!(await confirmAction('Sign out', 'Are you sure you want to sign out?', 'Sign out'))) return;
    await logout();
    router.replace('/(auth)/login');
  };

  if (!user) {
    return (
      <View style={styles.center}>
        <Text style={styles.centerText}>Loading...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Avatar + name */}
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {user.full_name ? user.full_name[0].toUpperCase() : '?'}
          </Text>
        </View>
        <Text style={styles.name}>{user.full_name}</Text>
        <Text style={styles.email}>{user.email}</Text>
        <View style={styles.roleBadge}>
          <Text style={styles.roleBadgeText}>
            {user.role === 'salesman' ? 'Field Salesman' :
             user.role === 'company_admin' ? 'Company Admin' :
             user.role === 'company_member' ? 'Company Member' : user.role}
          </Text>
        </View>
      </View>

      {/* ERP Upload section — salesmen only */}
      {(user.role === 'salesman' || user.role === 'company_member') && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>My Client Data</Text>
          <Text style={styles.sectionDesc}>
            Upload your ERP Quotation Excel file to see your clients as private red pins on the map.
          </Text>
          <TouchableOpacity
            style={styles.uploadBtn}
            onPress={() => setUploadVisible(true)}
          >
            <View style={styles.uploadBtnInner}>
              <Ionicons name="cloud-upload-outline" size={18} color="#fff" />
              <Text style={styles.uploadBtnText}> Upload ERP File</Text>
            </View>
          </TouchableOpacity>
          <Text style={styles.uploadHint}>
            Supported: .xlsx, .xls, .csv (max 10 MB)
          </Text>
        </View>
      )}

      {/* Account section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Account</Text>

        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Email</Text>
          <Text style={styles.infoValue}>{user.email}</Text>
        </View>

        {user.phone && (
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Phone</Text>
            <Text style={styles.infoValue}>{user.phone}</Text>
          </View>
        )}

        {user.company_id && (
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Company</Text>
            <TouchableOpacity onPress={() => router.push(`/company/${user.company_id}`)}>
              <Text style={[styles.infoValue, styles.link]}>View my company →</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Sign out */}
      <TouchableOpacity style={styles.signOutBtn} onPress={handleLogout}>
        <Text style={styles.signOutText}>Sign Out</Text>
      </TouchableOpacity>

      <Text style={styles.version}>GeoSales.ai · v1.0.0</Text>

      {/* ERP Upload Modal */}
      <UploadModal
        visible={uploadVisible}
        onClose={() => setUploadVisible(false)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bgSecondary },
  content: { paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  centerText: { color: Colors.textSecondary },

  header: {
    backgroundColor: Colors.bg,
    alignItems: 'center',
    paddingTop: 40,
    paddingBottom: 28,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
    marginBottom: 16,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  avatarText: { color: '#fff', fontSize: 32, fontWeight: '700' },
  name: { fontSize: 22, fontWeight: '700', color: Colors.text, marginBottom: 4 },
  email: { fontSize: 14, color: Colors.textSecondary, marginBottom: 10 },
  roleBadge: {
    backgroundColor: `${Colors.primary}18`,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  roleBadgeText: { fontSize: 12, fontWeight: '600', color: Colors.primary },

  section: {
    backgroundColor: Colors.bg,
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: Colors.text, marginBottom: 8 },
  sectionDesc: { fontSize: 13, color: Colors.textSecondary, lineHeight: 19, marginBottom: 14 },

  uploadBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 8,
  },
  uploadBtnInner: { flexDirection: 'row', alignItems: 'center' },
  uploadBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  uploadHint: { fontSize: 11, color: Colors.textLight, textAlign: 'center' },

  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  infoLabel: { fontSize: 14, color: Colors.textSecondary },
  infoValue: { fontSize: 14, color: Colors.text, fontWeight: '500', maxWidth: '60%', textAlign: 'right' },
  link: { color: Colors.primary },

  signOutBtn: {
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 8,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: Colors.danger,
  },
  signOutText: { color: Colors.danger, fontSize: 15, fontWeight: '600' },

  version: { textAlign: 'center', fontSize: 11, color: Colors.textLight, marginTop: 8 },
});
