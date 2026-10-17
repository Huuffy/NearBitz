import { useState, useCallback } from 'react';
import {
  View, Text, FlatList, RefreshControl,
  StyleSheet, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../services/api';
import { ENDPOINTS } from '../../constants/Api';
import { Colors } from '../../constants/Colors';
import { Ionicons } from '@expo/vector-icons';

interface Post {
  id: string;
  company_id: string;
  title: string | null;
  content: string;
  post_type: string;
  like_count: number;
  comment_count: number;
  published_at: string;
  company_name?: string;
  company_logo?: string;
}

function timeAgo(dateStr: string) {
  const d = new Date(dateStr);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

const POST_TYPE_COLORS: Record<string, string> = {
  product_launch: '#4285f4',
  innovation: '#9c27b0',
  case_study: '#00897b',
  news: '#f57c00',
  event: '#e91e63',
  offer: '#43a047',
  update: '#5f6368',
};

function PostCard({ post }: { post: Post }) {
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(post.like_count);

  const toggleLike = async () => {
    // Optimistic update
    setLiked((v) => !v);
    setLikeCount((c) => liked ? c - 1 : c + 1);
    try {
      if (!liked) {
        await apiClient.post(`${ENDPOINTS.feed}/${post.id}/like`);
      } else {
        await apiClient.delete(`${ENDPOINTS.feed}/${post.id}/like`);
      }
    } catch {
      // Roll back on error
      setLiked((v) => !v);
      setLikeCount((c) => liked ? c - 1 : c + 1);
    }
  };

  const typeColor = POST_TYPE_COLORS[post.post_type] || Colors.textSecondary;

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.companyAvatar}>
          <Text style={styles.companyAvatarText}>
            {(post.company_name || 'C').charAt(0).toUpperCase()}
          </Text>
        </View>
        <View style={styles.cardHeaderText}>
          <Text style={styles.companyName}>{post.company_name || 'Company'}</Text>
          <Text style={styles.postTime}>{timeAgo(post.published_at)}</Text>
        </View>
        <View style={[styles.typeBadge, { backgroundColor: typeColor + '20' }]}>
          <Text style={[styles.typeBadgeText, { color: typeColor }]}>
            {post.post_type.replace('_', ' ')}
          </Text>
        </View>
      </View>

      {post.title && <Text style={styles.postTitle}>{post.title}</Text>}
      <Text style={styles.postContent} numberOfLines={4}>{post.content}</Text>

      <View style={styles.cardActions}>
        <TouchableOpacity style={styles.actionBtn} onPress={toggleLike}>
          <Ionicons
            name={liked ? 'heart' : 'heart-outline'}
            size={16}
            color={liked ? Colors.danger : Colors.textLight}
          />
          <Text style={[styles.actionCount, liked && styles.actionCountActive]}>
            {likeCount}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionBtn}>
          <Ionicons name="chatbubble-outline" size={15} color={Colors.textLight} />
          <Text style={styles.actionCount}>{post.comment_count}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function FeedScreen() {
  const [cursor, setCursor] = useState<string | null>(null);
  const [allPosts, setAllPosts] = useState<Post[]>([]);

  const { isLoading, isRefetching, refetch } = useQuery({
    queryKey: ['feed'],
    queryFn: async () => {
      const res = await apiClient.get(ENDPOINTS.feed);
      const posts = res.data.data || [];
      setAllPosts(posts);
      return posts;
    },
  });

  const onRefresh = useCallback(async () => {
    setCursor(null);
    setAllPosts([]);
    await refetch();
  }, [refetch]);

  if (isLoading && !allPosts.length) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={Colors.primary} size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Feed</Text>
      </View>

      <FlatList
        data={allPosts}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <PostCard post={item} />}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={onRefresh}
            tintColor={Colors.primary}
          />
        }
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="newspaper-outline" size={48} color={Colors.textLight} style={{ marginBottom: 12 }} />
            <Text style={styles.emptyTitle}>Nothing in your feed yet</Text>
            <Text style={styles.emptySubtitle}>Follow companies on the map to see their updates here</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bgSecondary },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    backgroundColor: Colors.bg,
    paddingTop: 56,
    paddingBottom: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerTitle: { fontSize: 20, fontWeight: '700', color: Colors.navyDark },
  listContent: { paddingVertical: 8 },
  card: {
    backgroundColor: Colors.bg,
    marginHorizontal: 12,
    marginVertical: 6,
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 10, gap: 10 },
  companyAvatar: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center',
  },
  companyAvatarText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  cardHeaderText: { flex: 1 },
  companyName: { fontSize: 14, fontWeight: '600', color: Colors.text },
  postTime: { fontSize: 12, color: Colors.textLight, marginTop: 1 },
  typeBadge: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  typeBadgeText: { fontSize: 11, fontWeight: '600', textTransform: 'capitalize' },
  postTitle: { fontSize: 15, fontWeight: '700', color: Colors.text, marginBottom: 6 },
  postContent: { fontSize: 14, color: Colors.textSecondary, lineHeight: 20 },
  cardActions: {
    flexDirection: 'row', marginTop: 12, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: Colors.borderLight, gap: 16,
  },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  actionIcon: { fontSize: 16, color: Colors.textSecondary },
  actionIconActive: { color: Colors.danger },
  actionCount: { fontSize: 13, color: Colors.textSecondary },
  actionCountActive: { color: Colors.danger },
  empty: { alignItems: 'center', paddingTop: 80, paddingHorizontal: 32 },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: Colors.text, marginBottom: 8 },
  emptySubtitle: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20 },
});
