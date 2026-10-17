import { memo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors, Font, Radius, Space, Type, Numeric } from '../../constants/theme';
import { INDUSTRY_BY_ID } from '../../constants/industries';
import { formatDistance } from '../../utils/geo';
import type { NearbyItem } from '../../stores/mapStore';

export const LIST_ROW_HEIGHT = 68;

interface Props {
  item: NearbyItem;
  distanceKm?: number | null;
  selected?: boolean;
  onPress: () => void;
}

function CompanyListItem({ item, distanceKm, selected, onPress }: Props) {
  const isClient = item.source === 'my_client';
  const ind = item.industry_id ? INDUSTRY_BY_ID.get(item.industry_id) : undefined;
  const tint = isClient ? Colors.myClient : ind?.tint ?? Colors.primary;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed, hovered }: any) => [
        styles.row,
        (pressed || hovered) && { backgroundColor: Colors.bgSecondary },
        selected && styles.rowSelected,
      ]}
    >
      <View style={[styles.icon, { backgroundColor: tint }]}>
        {isClient ? (
          <Ionicons name="briefcase" size={16} color="#fff" />
        ) : (
          <MaterialCommunityIcons name={(ind?.icon ?? 'domain') as any} size={18} color="#fff" />
        )}
      </View>
      <View style={styles.text}>
        <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
        <Text style={styles.sub} numberOfLines={1}>
          {isClient ? 'Your client' : ind?.short ?? 'Company'}
          {item.city ? `, ${item.city}` : ''}
        </Text>
      </View>
      <View style={styles.right}>
        {distanceKm != null && <Text style={[styles.dist, Numeric]}>{formatDistance(distanceKm)}</Text>}
        {item.is_verified && <Ionicons name="shield-checkmark" size={13} color={Colors.verified} />}
      </View>
    </Pressable>
  );
}

export default memo(CompanyListItem);

const styles = StyleSheet.create({
  row: {
    height: LIST_ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingHorizontal: Space.lg,
    borderRadius: Radius.md,
  },
  rowSelected: { backgroundColor: Colors.accentSoft },
  icon: { width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 2 },
  name: { ...Type.bodyStrong, color: Colors.text },
  sub: { ...Type.caption, fontFamily: Font.regular, color: Colors.textSecondary },
  right: { alignItems: 'flex-end', gap: 4 },
  dist: { fontFamily: Font.bold, fontSize: 13, color: Colors.text },
});
