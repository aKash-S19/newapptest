import { useAuth } from '@/contexts/AuthContext';
import { useAppTheme } from '@/hooks/use-app-theme';
import { useLayout } from '@/lib/responsive';
import { callAuthFunction } from '@/lib/supabase';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, Modal, Pressable, RefreshControl, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

interface GroupWithMeta {
  id: string;
  name: string;
  description: string | null;
  avatar_url: string | null;
  last_activity: string | null;
  last_message: {
    text: string;
    created_at: string;
    username: string;
  } | null;
  member_count: number;
  is_pinned: boolean;
  user_role: 'admin' | 'member' | string;
}

const GroupsScreen = () => {
  const th = useAppTheme();
  const { isTablet } = useLayout();
  const { sessionToken, user } = useAuth();
  const router = useRouter();
  const [groups, setGroups] = useState<GroupWithMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [inviteModalVisible, setInviteModalVisible] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupDescription, setNewGroupDescription] = useState('');
  const [creating, setCreating] = useState(false);

  const fetchGroups = useCallback(async () => {
    if (!sessionToken) return;
    setLoading(true);
    try {
      const res = await callAuthFunction({ action: 'get-groups-overview', sessionToken });
      setGroups((res?.groups ?? []) as GroupWithMeta[]);
    } catch (error) {
      console.error('Error fetching groups:', error);
    } finally {
      setLoading(false);
    }
  }, [sessionToken]);

  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchGroups();
    setRefreshing(false);
  };

  const createGroup = async () => {
    if (!newGroupName.trim() || !sessionToken) return;
    setCreating(true);
    try {
      await callAuthFunction({
        action: 'create-group',
        sessionToken,
        name: newGroupName.trim(),
        description: newGroupDescription.trim() || null,
      });
      setModalVisible(false);
      setNewGroupName('');
      setNewGroupDescription('');
      fetchGroups();
    } catch (error) {
      console.error('Error creating group:', error);
      Alert.alert('Error', 'Could not create group');
    } finally {
      setCreating(false);
    }
  };

  const joinGroupWithCode = async () => {
    if (!inviteCode.trim() || !sessionToken) return;
    try {
      const res = await callAuthFunction({ action: 'join-group-invite', sessionToken, code: inviteCode });
      if (res?.alreadyMember) {
        Alert.alert('Already Joined', 'You are already a member of this group');
        return;
      }
      Alert.alert('Success', `You have joined "${res.groupName || 'the group'}"!`);
      setInviteModalVisible(false);
      setInviteCode('');
      fetchGroups();
    } catch (e: any) {
      const msg = e?.message ?? 'Could not join group';
      if (msg.toLowerCase().includes('expired')) Alert.alert('Expired', 'This invite link has expired');
      else if (msg.toLowerCase().includes('limit')) Alert.alert('Limit Reached', 'This invite link has reached its maximum uses');
      else if (msg.toLowerCase().includes('invalid')) Alert.alert('Invalid Code', 'This invite code is not valid');
      else Alert.alert('Error', msg);
    }
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    
    if (days === 0) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (days === 1) {
      return 'Yesterday';
    } else if (days < 7) {
      return date.toLocaleDateString([], { weekday: 'short' });
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
  };

  const leaveGroupFromList = async (group: GroupWithMeta) => {
    if (!sessionToken || !user?.id) return;
    try {
      await callAuthFunction({
        action: 'remove-group-member',
        sessionToken,
        groupId: group.id,
        targetUserId: user.id,
      });
      Alert.alert('Left Group', `You left "${group.name}".`);
      fetchGroups();
    } catch (error: any) {
      Alert.alert('Error', error?.message ?? 'Could not leave group');
    }
  };

  const deleteGroupFromList = async (group: GroupWithMeta) => {
    if (!sessionToken) return;
    try {
      await callAuthFunction({ action: 'delete-group', sessionToken, groupId: group.id });
      Alert.alert('Group Deleted', `"${group.name}" was archived.`);
      fetchGroups();
    } catch (error: any) {
      Alert.alert('Error', error?.message ?? 'Could not delete group');
    }
  };

  const destroyGroupFromList = async (group: GroupWithMeta) => {
    if (!sessionToken) return;
    try {
      await callAuthFunction({ action: 'destroy-group', sessionToken, groupId: group.id });
      Alert.alert('Group Destroyed', `"${group.name}" was permanently removed.`);
      fetchGroups();
    } catch (error: any) {
      Alert.alert('Error', error?.message ?? 'Could not destroy group');
    }
  };

  const showGroupActions = (group: GroupWithMeta) => {
    const isAdmin = group.user_role === 'admin';
    const buttons: Array<{ text: string; style?: 'default' | 'cancel' | 'destructive'; onPress?: () => void }> = [
      {
        text: 'Leave Group',
        style: 'destructive',
        onPress: () => {
          Alert.alert(
            'Leave Group',
            `Leave "${group.name}"?`,
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Leave', style: 'destructive', onPress: () => { leaveGroupFromList(group); } },
            ],
          );
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ];

    if (isAdmin) {
      buttons.unshift(
        {
          text: 'Destroy Group',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Destroy Group Forever',
              `Permanently destroy "${group.name}" and all its history? This cannot be undone.`,
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Destroy', style: 'destructive', onPress: () => { destroyGroupFromList(group); } },
              ],
            );
          },
        },
        {
          text: 'Delete Group',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Delete Group',
              `Archive "${group.name}"?`,
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Delete', style: 'destructive', onPress: () => { deleteGroupFromList(group); } },
              ],
            );
          },
        },
      );
    }

    Alert.alert(group.name, isAdmin ? 'Choose an action' : 'Manage membership', buttons);
  };

  const renderGroupAvatar = (item: GroupWithMeta) => {
    if (item.avatar_url) {
      return <Image source={{ uri: item.avatar_url }} style={styles.groupAvatar} resizeMode="cover" />;
    }
    const colors = ['#6366F1', '#8B5CF6', '#EC4899', '#F59E0B', '#10B981', '#3B82F6'];
    const colorIndex = item.name.charCodeAt(0) % colors.length;
    return (
      <View style={[styles.groupAvatarPlaceholder, { backgroundColor: colors[colorIndex] + '20' }]}>
        <MaterialCommunityIcons name="account-group" size={24} color={colors[colorIndex]} />
      </View>
    );
  };

  const renderGroupItem = ({ item }: { item: GroupWithMeta }) => {
    const preview = item.last_message
      ? `${item.last_message.username}: ${item.last_message.text}`
      : (item.description?.trim() || 'No messages yet');
    const timeValue = item.last_message?.created_at ?? item.last_activity;

    return (
      <TouchableOpacity
        style={[styles.groupItem, { borderBottomColor: th.divider }]}
        activeOpacity={0.65}
        onPress={() => router.push(`/chat/group/${item.id}`)}
        onLongPress={() => showGroupActions(item)}
        delayLongPress={260}
      >
        <View style={styles.avatarContainer}>
          {renderGroupAvatar(item)}
          {item.is_pinned && (
            <View style={[styles.pinBadge, { backgroundColor: th.accent }]}> 
              <MaterialCommunityIcons name="pin" size={10} color="white" />
            </View>
          )}
        </View>

        <View style={styles.groupInfo}>
          <View style={styles.nameRow}>
            <Text style={[styles.groupName, { color: th.textDark }]} numberOfLines={1}>
              {item.name}
            </Text>
            <Text style={[styles.timestamp, { color: th.textSoft }]}>
              {timeValue ? formatTime(timeValue) : ''}
            </Text>
          </View>

          <View style={styles.previewRow}>
            <Text style={[styles.lastMessage, { color: th.textMed }]} numberOfLines={1}>
              {preview}
            </Text>
            <Text style={[styles.memberMeta, { color: th.textSoft }]}>
              {item.member_count} {item.member_count === 1 ? 'member' : 'members'}
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const renderHeader = () => (
    <View style={[styles.header, { backgroundColor: th.bg }]}>
      <View style={styles.headerTextBlock}>
        <Text style={[styles.headerTitle, { color: th.textDark }]}>Groups</Text>
        <Text style={[styles.headerSubtitle, { color: th.textMed }]}>Private by default. Invite-only.</Text>
      </View>
      <View style={styles.headerActions}>
        <TouchableOpacity
          style={[styles.headerPill, { backgroundColor: th.inputBg }]}
          onPress={() => setInviteModalVisible(true)}
        >
          <MaterialCommunityIcons name="link-variant" size={18} color={th.textMed} />
          <Text style={[styles.headerPillText, { color: th.textMed }]}>Join</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.headerPill, { backgroundColor: th.accent }]}
          onPress={() => setModalVisible(true)}
        >
          <MaterialCommunityIcons name="plus" size={18} color="white" />
          <Text style={styles.headerPillTextLight}>New</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: th.bg }]} edges={['top']}>
      <View style={[isTablet && { maxWidth: 720, alignSelf: 'center', width: '100%' }]}>
        {renderHeader()}
      
      {loading && groups.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={th.accent} />
        </View>
      ) : (
        <FlatList
          data={groups}
          keyExtractor={(item) => item.id}
          renderItem={renderGroupItem}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={th.accent}
              colors={[th.accent]}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <View style={[styles.emptyIconContainer, { backgroundColor: th.accent + '10' }]}>
                <MaterialCommunityIcons name="account-group-outline" size={64} color={th.accent} />
              </View>
              <Text style={[styles.emptyTitle, { color: th.textDark }]}>No Groups Yet</Text>
              <Text style={[styles.emptyText, { color: th.textMed }]}>
                Create a group to start chatting with your friends
              </Text>
              <TouchableOpacity 
                style={[styles.emptyButton, { backgroundColor: th.accent }]} 
                onPress={() => setModalVisible(true)}
              >
                <MaterialCommunityIcons name="plus" size={20} color="white" />
                <Text style={styles.emptyButtonText}>Create Group</Text>
              </TouchableOpacity>
            </View>
          }
          showsVerticalScrollIndicator={false}
        />
      )}

      <Modal
        animationType="slide"
        transparent={true}
        visible={modalVisible}
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <Pressable style={styles.modalBackdrop} onPress={() => setModalVisible(false)} />
          <View style={[styles.modalView, { backgroundColor: th.cardBg }]}>
            <View style={styles.modalHandle} />
            
            <View style={styles.modalHeaderRow}>
              <Text style={[styles.modalTitle, { color: th.textDark }]}>Create New Group</Text>
              <Pressable onPress={() => setModalVisible(false)}>
                <MaterialCommunityIcons name="close" size={24} color={th.textSoft} />
              </Pressable>
            </View>
            
            <View style={styles.inputContainer}>
              <View style={[styles.inputWrapper, { backgroundColor: th.inputBg, borderColor: 'transparent' }]}>
                <MaterialCommunityIcons name="account-group-outline" size={20} color={th.textSoft} style={styles.inputIcon} />
                <TextInput
                  style={[styles.input, { color: th.textDark }]}
                  placeholder="Group Name"
                  placeholderTextColor={th.textSoft}
                  value={newGroupName}
                  onChangeText={setNewGroupName}
                  autoFocus
                  maxLength={50}
                />
              </View>
              
              <View style={[styles.inputWrapper, { backgroundColor: th.inputBg, borderColor: 'transparent', minHeight: 80 }]}>
                <MaterialCommunityIcons name="text-box-outline" size={20} color={th.textSoft} style={styles.inputIcon} />
                <TextInput
                  style={[styles.input, styles.textArea, { color: th.textDark }]}
                  placeholder="Description (optional)"
                  placeholderTextColor={th.textSoft}
                  value={newGroupDescription}
                  onChangeText={setNewGroupDescription}
                  multiline
                  maxLength={200}
                />
              </View>
            </View>
            
            <TouchableOpacity 
              style={[
                styles.createButton, 
                { backgroundColor: th.accent },
                (!newGroupName.trim() || creating) && { opacity: 0.5 }
              ]} 
              onPress={createGroup}
              disabled={!newGroupName.trim() || creating}
            >
              {creating ? (
                <ActivityIndicator color="white" size="small" />
              ) : (
                <>
                  <MaterialCommunityIcons name="check" size={20} color="white" />
                  <Text style={styles.createButtonText}>Create Group</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        animationType="slide"
        transparent={true}
        visible={inviteModalVisible}
        onRequestClose={() => setInviteModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <Pressable style={styles.modalBackdrop} onPress={() => setInviteModalVisible(false)} />
          <View style={[styles.modalView, { backgroundColor: th.cardBg }]}>
            <View style={styles.modalHandle} />
            
            <View style={styles.modalHeaderRow}>
              <Text style={[styles.modalTitle, { color: th.textDark }]}>Join Group</Text>
              <Pressable onPress={() => setInviteModalVisible(false)}>
                <MaterialCommunityIcons name="close" size={24} color={th.textSoft} />
              </Pressable>
            </View>
            
            <View style={styles.inputContainer}>
              <Text style={[styles.inputLabel, { color: th.textMed }]}>Enter invite link or code</Text>
              <View style={[styles.inputWrapper, { backgroundColor: th.inputBg }]}>
                <MaterialCommunityIcons name="link-variant" size={20} color={th.textSoft} style={styles.inputIcon} />
                <TextInput
                  style={[styles.input, { color: th.textDark }]}
                  placeholder="https://... or code"
                  placeholderTextColor={th.textSoft}
                  value={inviteCode}
                  onChangeText={setInviteCode}
                  autoCapitalize="none"
                />
              </View>
            </View>
            
            <TouchableOpacity 
              style={[styles.createButton, { backgroundColor: th.accent }, !inviteCode.trim() && { opacity: 0.5 }]}
              onPress={joinGroupWithCode}
              disabled={!inviteCode.trim()}
            >
              <MaterialCommunityIcons name="login" size={20} color="white" />
              <Text style={styles.createButtonText}>Join Group</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 10,
  },
  headerTextBlock: {
    gap: 6,
    marginBottom: 14,
  },
  headerTitle: {
    fontSize: 30,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  headerSubtitle: {
    fontSize: 14,
    fontWeight: '500',
  },
  headerActions: {
    flexDirection: 'row',
    gap: 10,
  },
  headerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
  },
  headerPillText: {
    fontSize: 13,
    fontWeight: '600',
  },
  headerPillTextLight: {
    color: 'white',
    fontSize: 13,
    fontWeight: '600',
  },
  listContent: {
    paddingHorizontal: 0,
    paddingBottom: 100,
  },
  groupItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  avatarContainer: {
    position: 'relative',
    marginRight: 12,
  },
  groupAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    overflow: 'hidden',
  },
  groupAvatarPlaceholder: {
    width: 52,
    height: 52,
    borderRadius: 26,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pinBadge: {
    position: 'absolute',
    bottom: -4,
    right: -4,
    width: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'white',
  },
  groupInfo: {
    flex: 1,
    minHeight: 52,
    justifyContent: 'space-between',
  },
  nameRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  groupName: {
    fontSize: 17,
    fontWeight: '600',
    flex: 1,
    marginRight: 8,
  },
  timestamp: {
    fontSize: 12,
    fontWeight: '500',
  },
  previewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  lastMessage: {
    fontSize: 13.5,
    flex: 1,
    marginRight: 10,
  },
  memberMeta: {
    fontSize: 12,
    fontWeight: '500',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
    marginTop: 60,
  },
  emptyIconContainer: {
    width: 120,
    height: 120,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 15,
    textAlign: 'center',
    marginBottom: 28,
    lineHeight: 22,
  },
  emptyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 16,
    gap: 8,
  },
  emptyButtonText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 16,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  modalView: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 24,
    paddingTop: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 10,
  },
  modalHandle: {
    width: 40,
    height: 4,
    backgroundColor: 'rgba(0,0,0,0.1)',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 20,
  },
  modalHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: '700',
  },
  inputContainer: {
    gap: 16,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
    marginLeft: 4,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  inputIcon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    height: 50,
    fontSize: 16,
  },
  textArea: {
    height: 80,
    textAlignVertical: 'top',
    paddingTop: 14,
  },
  createButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 54,
    borderRadius: 16,
    marginTop: 24,
    gap: 8,
  },
  createButtonText: {
    color: 'white',
    fontSize: 17,
    fontWeight: '600',
  },
});

export default GroupsScreen;