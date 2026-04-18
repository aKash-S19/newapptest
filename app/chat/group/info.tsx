import { useAuth } from '@/contexts/AuthContext';
import { useAppTheme } from '@/hooks/use-app-theme';
import { useLayout } from '@/lib/responsive';
import { callAuthFunction } from '@/lib/supabase';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, Modal, Pressable, ScrollView, Share, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

interface Member {
  role: string;
  user: {
    id: string;
    username: string;
    avatar_url: string | null;
  };
}

interface GroupData {
  id: string;
  name: string;
  description: string | null;
  avatar_url: string | null;
  banner_url?: string | null;
  created_by: string;
  created_at: string;
  is_archived: boolean;
  mute_notifications: boolean;
  is_public: boolean;
}

interface InviteLink {
  id: string;
  code: string;
  expires_at: string | null;
  uses_count: number;
  max_uses: number | null;
}

const GroupInfoScreen = () => {
  const { isTablet } = useLayout();
  const { id: groupId } = useLocalSearchParams<{ id: string }>();
  const { user, sessionToken } = useAuth();
  const th = useAppTheme();
  const router = useRouter();
  
  const [group, setGroup] = useState<GroupData | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [allMembers, setAllMembers] = useState<Member[]>([]);
  const [friends, setFriends] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState<'admin' | 'member' | null>(null);
  const [usernameHistory, setUsernameHistory] = useState<Record<string, string[]>>({});
  const [showAllMembers, setShowAllMembers] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteLink, setInviteLink] = useState<InviteLink | null>(null);
  const [inviteCode, setInviteCode] = useState('');
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addUsername, setAddUsername] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [avatarLoading, setAvatarLoading] = useState(false);
  const [bannerLoading, setBannerLoading] = useState(false);
  const [groupActionBusy, setGroupActionBusy] = useState<'delete' | 'destroy' | null>(null);

  const fetchGroupData = useCallback(async () => {
    if (!groupId || !user || !sessionToken) return;
    setLoading(true);
    try {
      const res = await callAuthFunction({ action: 'get-group-detail', sessionToken, groupId });
      const nextGroup = (res?.group ?? null) as GroupData | null;
      const nextMembers = (res?.members ?? []) as Member[];

      setGroup(nextGroup);
      setAllMembers(nextMembers);
      setMembers(nextMembers.slice(0, 3));
      setUserRole((res?.userRole ?? 'member') as 'admin' | 'member');
      setFriends((res?.friends ?? []) as any[]);

      const userIds = nextMembers.map((m) => m.user.id);
      if (userIds.length > 0) {
        try {
          const hist = await callAuthFunction({ action: 'get-username-history', sessionToken, userIds });
          setUsernameHistory(hist.history ?? {});
        } catch {
          setUsernameHistory({});
        }
      } else {
        setUsernameHistory({});
      }

      try {
        const inviteRes = await callAuthFunction({ action: 'get-group-invite', sessionToken, groupId });
        if (inviteRes?.invite) setInviteLink(inviteRes.invite);
        else setInviteLink(null);
      } catch {
        setInviteLink(null);
      }
    } catch (error) {
      console.error('Error fetching group data:', error);
    } finally {
      setLoading(false);
    }
  }, [groupId, user, sessionToken]);

  useEffect(() => {
    fetchGroupData();
  }, [fetchGroupData]);

  const addMember = async (friendId: string) => {
    if (!sessionToken || !groupId) return;
    try {
      const res = await callAuthFunction({ action: 'add-group-member', sessionToken, groupId, targetUserId: friendId });
      if (res?.alreadyMember) {
        Alert.alert('Already Member', 'This user is already in the group');
      }
      fetchGroupData();
    } catch {
      Alert.alert('Error', 'Could not add member');
    }
  };

  const searchUsersByUsername = async (query: string) => {
    if (!sessionToken || !groupId) return;
    if (query.length < 2) {
      setSearchResults([]);
      return;
    }
    setSearching(true);

    try {
      const res = await callAuthFunction({
        action: 'get-group-search-candidates',
        sessionToken,
        groupId,
        query,
      });
      setSearchResults((res?.users ?? []) as any[]);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  const addByUsername = async (targetUserId: string, username: string) => {
    if (!sessionToken || !groupId) return;
    try {
      const res = await callAuthFunction({
        action: 'add-group-member',
        sessionToken,
        groupId,
        targetUserId,
      });

      if (res?.alreadyMember) {
        Alert.alert('Already Member', `${username} is already in this group`);
        return;
      }

      Alert.alert('Success', `${username} has been added to the group!`);
      setShowAddModal(false);
      setAddUsername('');
      setSearchResults([]);
      fetchGroupData();
    } catch (error: any) {
      console.error('Add error:', error);
      Alert.alert('Error', error?.message ?? 'Could not add user to group');
    }
  };

  const removeMember = async (memberUserId: string) => {
    if (memberUserId === user?.id) {
        Alert.alert('Error', 'Use "Leave Group" instead');
        return;
    }

    Alert.alert(
      'Remove Member',
      'Are you sure you want to remove this member from the group?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            if (!sessionToken || !groupId) return;
            try {
              await callAuthFunction({
                action: 'remove-group-member',
                sessionToken,
                groupId,
                targetUserId: memberUserId,
              });
              fetchGroupData();
            } catch (error: any) {
              Alert.alert('Error', error?.message ?? 'Could not remove member');
            }
          }
        }
      ]
    );
  };

  const promoteToAdmin = async (memberUserId: string) => {
    if (!sessionToken || !groupId) return;
    try {
      await callAuthFunction({
        action: 'update-group-member-role',
        sessionToken,
        groupId,
        targetUserId: memberUserId,
        role: 'admin',
      });
      fetchGroupData();
    } catch (error: any) {
      Alert.alert('Error', error?.message ?? 'Could not promote member');
    }
  };

  const demoteToMember = async (memberUserId: string) => {
    if (!sessionToken || !groupId) return;
    try {
      await callAuthFunction({
        action: 'update-group-member-role',
        sessionToken,
        groupId,
        targetUserId: memberUserId,
        role: 'member',
      });
      fetchGroupData();
    } catch (error: any) {
      Alert.alert('Error', error?.message ?? 'Could not change role');
    }
  };

  const generateInviteLink = async () => {
    if (!user || !groupId || !sessionToken) return;
    try {
      const res = await callAuthFunction({ action: 'create-group-invite', sessionToken, groupId });
      if (res?.invite) {
        setInviteLink(res.invite);
        setShowInviteModal(true);
      }
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Could not generate invite link');
    }
  };

  const uploadGroupImage = useCallback(async (kind: 'avatar' | 'banner') => {
    if (!groupId || !sessionToken) return;
    const pickFromGallery = async () => {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') { Alert.alert('Permission needed', 'Allow photo library access.'); return; }
      return ImagePicker.launchImageLibraryAsync({ allowsEditing: true, aspect: kind === 'banner' ? [3, 1] : [1, 1], quality: 0.85 });
    };
    const pickFromCamera = async () => {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') { Alert.alert('Permission needed', 'Allow camera access.'); return; }
      return ImagePicker.launchCameraAsync({ allowsEditing: true, aspect: kind === 'banner' ? [3, 1] : [1, 1], quality: 0.85 });
    };

    Alert.alert(
      kind === 'banner' ? 'Change Group Banner' : 'Change Group Photo',
      'Choose a source',
      [
        { text: 'Camera', onPress: async () => handlePick(await pickFromCamera()) },
        { text: 'Gallery', onPress: async () => handlePick(await pickFromGallery()) },
        { text: 'Cancel', style: 'cancel' },
      ],
    );

    async function handlePick(result?: ImagePicker.ImagePickerResult) {
      if (!result || result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      const targetSize = kind === 'banner' ? { width: 1200, height: 400 } : { width: 400, height: 400 };
      const manip = await ImageManipulator.manipulateAsync(
        asset.uri,
        [{ resize: targetSize }],
        { compress: 0.78, format: ImageManipulator.SaveFormat.JPEG },
      );

      if (kind === 'banner') setBannerLoading(true);
      else setAvatarLoading(true);
      try {
        const res = await callAuthFunction({ action: 'get-group-upload-url', sessionToken, groupId, kind });
        const imageRes = await fetch(manip.uri);
        const blob = await imageRes.blob();
        const uploadRes = await fetch(res.signedUrl, {
          method: 'PUT',
          headers: { 'Content-Type': 'image/jpeg', 'x-upsert': 'true' },
          body: blob,
        });
        if (!uploadRes.ok) throw new Error('Upload failed');

        const cacheBusted = `${res.publicUrl}?t=${Date.now()}`;
        const updatePayload = kind === 'banner' ? { bannerUrl: cacheBusted } : { avatarUrl: cacheBusted };
        const updated = await callAuthFunction({ action: 'update-group-media', sessionToken, groupId, ...updatePayload });
        setGroup(prev => prev ? { ...prev, ...updated.group } : prev);
      } catch (e: any) {
        Alert.alert('Error', e.message ?? 'Could not update image');
      } finally {
        if (kind === 'banner') setBannerLoading(false);
        else setAvatarLoading(false);
      }
    }
  }, [groupId, sessionToken]);

  const shareInviteLink = async () => {
    if (!inviteLink) return;
    
    const link = `myapp://join-group/${inviteLink.code}`;
    try {
      await Share.share({
        message: `Join my group "${group?.name}"! Use code: ${inviteLink.code} or click: ${link}`,
      });
    } catch (error) {
      console.error('Error sharing:', error);
    }
  };

  const copyInviteCode = async () => {
    if (!inviteLink) return;
    await Clipboard.setStringAsync(inviteLink.code);
    Alert.alert('Copied!', 'Invite code copied to clipboard');
  };

  const joinGroupWithCode = async () => {
    if (!inviteCode.trim() || !user || !sessionToken) return;
    try {
      const res = await callAuthFunction({ action: 'join-group-invite', sessionToken, code: inviteCode });
      if (res?.alreadyMember) {
        Alert.alert('Already Joined', 'You are already a member of this group');
        return;
      }
      setShowJoinModal(false);
      setInviteCode('');
      router.replace(`/chat/group/${res.groupId}`);
    } catch (e: any) {
      const msg = e?.message ?? 'Could not join group';
      if (msg.toLowerCase().includes('expired')) Alert.alert('Expired', 'This invite link has expired');
      else if (msg.toLowerCase().includes('limit')) Alert.alert('Limit Reached', 'This invite link has reached its maximum uses');
      else if (msg.toLowerCase().includes('invalid')) Alert.alert('Invalid Code', 'This invite code is not valid');
      else Alert.alert('Error', msg);
    }
  };

  const leaveGroup = () => {
    Alert.alert(
      'Leave Group',
      'Are you sure you want to leave this group? You will no longer receive messages from this group.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: async () => {
            if (!sessionToken || !groupId || !user?.id) return;
            try {
              await callAuthFunction({
                action: 'remove-group-member',
                sessionToken,
                groupId,
                targetUserId: user.id,
              });
              router.replace('/(tabs)/groups');
            } catch (error: any) {
              Alert.alert('Error', error?.message ?? 'Could not leave group');
            }
          }
        }
      ]
    );
  };

  const deleteGroup = () => {
    Alert.alert(
      'Delete Group',
      'This will archive the group and hide it from members. You can still destroy it later if needed.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            if (!sessionToken || !groupId) return;
            setGroupActionBusy('delete');
            try {
              await callAuthFunction({ action: 'delete-group', sessionToken, groupId });
              Alert.alert('Group Deleted', 'The group has been archived.');
              router.replace('/(tabs)/groups');
            } catch (error: any) {
              Alert.alert('Error', error?.message ?? 'Could not delete group');
            } finally {
              setGroupActionBusy(null);
            }
          },
        },
      ],
    );
  };

  const destroyGroup = () => {
    Alert.alert(
      'Destroy Group Forever',
      'This permanently removes the group and its history. This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Destroy',
          style: 'destructive',
          onPress: async () => {
            if (!sessionToken || !groupId) return;
            setGroupActionBusy('destroy');
            try {
              await callAuthFunction({ action: 'destroy-group', sessionToken, groupId });
              Alert.alert('Group Destroyed', 'The group was permanently removed.');
              router.replace('/(tabs)/groups');
            } catch (error: any) {
              Alert.alert('Error', error?.message ?? 'Could not destroy group');
            } finally {
              setGroupActionBusy(null);
            }
          },
        },
      ],
    );
  };

  const toggleNotifications = async (value: boolean) => {
    if (!sessionToken || !groupId) return;
    try {
      const res = await callAuthFunction({
        action: 'update-group-settings',
        sessionToken,
        groupId,
        muteNotifications: !value,
      });
      if (res?.group) setGroup(res.group as GroupData);
      else setGroup(prev => prev ? { ...prev, mute_notifications: !value } : null);
    } catch {
      // no-op
    }
  };

  const togglePrivacy = async () => {
    if (!sessionToken || !groupId) return;
    const newValue = !(group?.is_public !== false);
    try {
      const res = await callAuthFunction({
        action: 'update-group-settings',
        sessionToken,
        groupId,
        isPublic: newValue,
      });

      if (res?.group) setGroup(res.group as GroupData);
      else setGroup(prev => prev ? { ...prev, is_public: newValue } : null);
      Alert.alert(
        'Group Privacy Updated',
        newValue
          ? 'Anyone can now join without approval'
          : 'New members will need approval to join'
      );
    } catch {
      // no-op
    }
  };

  const getAvatarColor = (userId: string) => {
    const colors = ['#6366F1', '#8B5CF6', '#EC4899', '#F59E0B', '#10B981', '#3B82F6'];
    const index = userId.charCodeAt(0) % colors.length;
    return colors[index];
  };

  const renderMember = (item: Member, showActions: boolean = false) => (
    <View key={item.user.id} style={[styles.memberItem, { backgroundColor: th.cardBg, borderBottomColor: th.divider }]}> 
      <View style={styles.memberInfo}>
        {item.user.avatar_url ? (
          <Image source={{ uri: item.user.avatar_url }} style={styles.memberAvatar} />
        ) : (
          <View style={[styles.memberAvatarPlaceholder, { backgroundColor: getAvatarColor(item.user.id) + '15' }]}>
            <Text style={{ color: getAvatarColor(item.user.id), fontWeight: '600', fontSize: 16 }}>
              {item.user.username[0].toUpperCase()}
            </Text>
          </View>
        )}
        <View style={styles.memberTextContainer}>
          <Text style={[styles.memberName, { color: th.textDark }]}> 
            {item.user.username}
            {item.user.id === user?.id && (
              <Text style={{ color: th.textSoft }}> (You)</Text>
            )}
          </Text>
          {usernameHistory[item.user.id]?.length ? (
            <Text style={[styles.memberFormer, { color: th.textSoft }]}> 
              Previously: {usernameHistory[item.user.id].join(', ')}
            </Text>
          ) : null}
          {item.role === 'admin' && (
            <View style={[styles.roleBadge, { backgroundColor: th.accent + '15' }]}>
              <Text style={[styles.roleText, { color: th.accent }]}>Admin</Text>
            </View>
          )}
        </View>
      </View>
      
      {showActions && userRole === 'admin' && item.user.id !== user?.id && (
        <View style={styles.memberActions}>
          <TouchableOpacity 
            style={styles.actionButton}
            onPress={() => item.role === 'admin' ? demoteToMember(item.user.id) : promoteToAdmin(item.user.id)}
          >
            <MaterialCommunityIcons 
              name={item.role === 'admin' ? 'arrow-down' : 'arrow-up'} 
              size={20} 
              color={th.textMed} 
            />
          </TouchableOpacity>
          <TouchableOpacity 
            style={styles.actionButton}
            onPress={() => removeMember(item.user.id)}
          >
            <MaterialCommunityIcons name="account-remove" size={20} color="#EF4444" />
          </TouchableOpacity>
        </View>
      )}
    </View>
  );

  const renderFriend = (item: any) => (
    <View key={item.id} style={[styles.memberItem, { backgroundColor: th.cardBg, borderBottomColor: th.divider }]}> 
      <View style={styles.memberInfo}>
        {item.avatar_url ? (
          <Image source={{ uri: item.avatar_url }} style={styles.memberAvatar} />
        ) : (
          <View style={[styles.memberAvatarPlaceholder, { backgroundColor: getAvatarColor(item.id) + '15' }]}>
            <Text style={{ color: getAvatarColor(item.id), fontWeight: '600', fontSize: 16 }}>
              {item.username[0].toUpperCase()}
            </Text>
          </View>
        )}
        <Text style={[styles.memberName, { color: th.textDark }]}>{item.username}</Text>
      </View>
      <TouchableOpacity 
        style={[styles.addButton, { backgroundColor: th.accent }]} 
        onPress={() => addMember(item.id)}
      >
        <MaterialCommunityIcons name="plus" size={20} color="white" />
      </TouchableOpacity>
    </View>
  );

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: th.bg }]}>
        <ActivityIndicator size="large" color={th.accent} />
      </View>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: th.bg }} edges={['top']}>
      <Stack.Screen 
        options={{ 
          title: 'Group Info',
          headerTransparent: false,
          headerStyle: { backgroundColor: th.cardBg },
          headerTintColor: th.textDark,
        }} 
      />
      
      <ScrollView style={[styles.container, { backgroundColor: th.bg }]} contentContainerStyle={isTablet ? { maxWidth: 720, alignSelf: 'center', width: '100%' } : undefined}>
        <View style={[styles.profileSection, { backgroundColor: th.cardBg }]}> 
          <Pressable style={styles.bannerWrap} onPress={() => userRole === 'admin' && uploadGroupImage('banner')}>
            {group?.banner_url ? (
              <Image source={{ uri: group.banner_url }} style={styles.bannerImage} />
            ) : (
              <View style={[styles.bannerPlaceholder, { backgroundColor: th.accent + '10' }]}>
                <MaterialCommunityIcons name="image-outline" size={28} color={th.accent} />
                <Text style={[styles.bannerText, { color: th.textSoft }]}>Add banner</Text>
              </View>
            )}
            {bannerLoading && (
              <View style={styles.bannerLoading}><ActivityIndicator color={th.accent} /></View>
            )}
          </Pressable>

          <Pressable style={[styles.groupAvatar, { backgroundColor: th.accent + '15' }]} onPress={() => userRole === 'admin' && uploadGroupImage('avatar')}>
            {group?.avatar_url ? (
              <Image source={{ uri: group.avatar_url }} style={styles.groupAvatarImage} />
            ) : (
              <MaterialCommunityIcons name="account-group" size={40} color={th.accent} />
            )}
            {avatarLoading && (
              <View style={styles.avatarLoading}><ActivityIndicator color={th.accent} /></View>
            )}
          </Pressable>
          <Text style={[styles.groupName, { color: th.textDark }]}>{group?.name}</Text>
          <Text style={[styles.groupDesc, { color: th.textMed }]}>
          {group?.description || 'No description'}
        </Text>
        <Text style={[styles.memberCountText, { color: th.textSoft }]}>
          {allMembers.length} member{allMembers.length !== 1 ? 's' : ''}
        </Text>
      </View>

      {userRole === 'admin' && (
        <TouchableOpacity 
          style={[styles.inviteButton, { backgroundColor: th.accent + '55' }]}
          onPress={generateInviteLink}
          activeOpacity={0.7}
        >
          <MaterialCommunityIcons name="link-variant" size={20} color="white" />
          <Text style={styles.inviteButtonText}>
            Generate Invite Link
          </Text>
        </TouchableOpacity>
      )}

      {userRole !== 'admin' && (
        <TouchableOpacity 
          style={[styles.inviteButton, { backgroundColor: th.accent + '20' }]}
          onPress={() => setShowJoinModal(true)}
        >
          <MaterialCommunityIcons name="link-variant-plus" size={20} color={th.accent} />
          <Text style={[styles.inviteButtonText, { color: th.accent }]}>Join with Code</Text>
        </TouchableOpacity>
      )}

      <View style={[styles.settingsSection, { backgroundColor: th.cardBg }]}>
        <View style={[styles.settingItem, { borderBottomColor: th.divider }]}>
          <View style={styles.settingLeft}>
            <MaterialCommunityIcons name="bell-off-outline" size={22} color={th.textMed} />
            <Text style={[styles.settingText, { color: th.textDark }]}>Mute Notifications</Text>
          </View>
          <Switch
            value={!group?.mute_notifications}
            onValueChange={toggleNotifications}
            trackColor={{ false: th.divider, true: th.accent + '50' }}
            thumbColor={group?.mute_notifications ? th.textSoft : th.accent}
          />
        </View>
        
        {userRole === 'admin' && (
          <View style={[styles.settingItem, { borderBottomColor: th.divider }]}>
            <View style={styles.settingLeft}>
              <MaterialCommunityIcons name={group?.is_public !== false ? "earth" : "lock"} size={22} color={th.textMed} />
              <View>
                <Text style={[styles.settingText, { color: th.textDark }]}>Group Privacy</Text>
                <Text style={[styles.settingSubtext, { color: th.textSoft }]}>
                  {group?.is_public !== false ? 'Public - Anyone can join' : 'Private - Approval required'}
                </Text>
              </View>
            </View>
            <Switch
              value={group?.is_public !== false}
              onValueChange={togglePrivacy}
              trackColor={{ false: th.divider, true: th.accent + '50' }}
              thumbColor={group?.is_public === false ? th.textSoft : th.accent}
            />
          </View>
        )}

        {userRole === 'admin' && (
          <TouchableOpacity style={[styles.settingItem, { borderBottomColor: th.divider }]} onPress={() => setShowAddModal(true)}>
            <View style={styles.settingLeft}>
              <MaterialCommunityIcons name="account-plus" size={22} color={th.accent} />
              <Text style={[styles.settingText, { color: th.accent }]}>Add by Username</Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={22} color={th.textSoft} />
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: th.textSoft }]}>MEMBERS</Text>
      </View>

      <View style={[styles.membersList, { backgroundColor: th.cardBg }]}>
        {(showAllMembers ? allMembers : members).map((item) => renderMember(item, userRole === 'admin'))}
        
        {!showAllMembers && allMembers.length > 3 && (
          <TouchableOpacity 
            style={styles.showMoreButton}
            onPress={() => setShowAllMembers(true)}
          >
            <Text style={[styles.showMoreText, { color: th.accent }]}>
              Show all {allMembers.length} members
            </Text>
          </TouchableOpacity>
        )}
        
        {showAllMembers && allMembers.length > 3 && (
          <TouchableOpacity 
            style={styles.showMoreButton}
            onPress={() => setShowAllMembers(false)}
          >
            <Text style={[styles.showMoreText, { color: th.accent }]}>Show less</Text>
          </TouchableOpacity>
        )}
      </View>

      {userRole === 'admin' && friends.length > 0 && (
        <>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: th.textSoft }]}>ADD MEMBERS</Text>
          </View>

          <View style={[styles.membersList, { backgroundColor: th.cardBg }]}>
            {friends.map(renderFriend)}
          </View>
        </>
      )}

      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: th.textSoft }]}>GROUP INFO</Text>
      </View>

      <View style={[styles.infoSection, { backgroundColor: th.cardBg }]}>
        <View style={[styles.infoItem, { borderBottomColor: th.divider }]}>
          <Text style={[styles.infoLabel, { color: th.textSoft }]}>Created</Text>
          <Text style={[styles.infoValue, { color: th.textDark }]}>
            {new Date(group?.created_at || '').toLocaleDateString()}
          </Text>
        </View>
        <View style={[styles.infoItem, { borderBottomColor: th.divider }]}>
          <Text style={[styles.infoLabel, { color: th.textSoft }]}>Created by</Text>
          <Text style={[styles.infoValue, { color: th.textDark }]}>
            {group?.created_by === user?.id ? 'You' : 'Unknown'}
          </Text>
        </View>
      </View>

      {userRole === 'admin' && (
        <View style={styles.adminDangerWrap}>
          <TouchableOpacity
            style={[styles.dangerButton, { backgroundColor: th.cardBg }, groupActionBusy ? { opacity: 0.65 } : null]}
            onPress={deleteGroup}
            disabled={!!groupActionBusy}
          >
            {groupActionBusy === 'delete'
              ? <ActivityIndicator size="small" color="#F97316" />
              : <MaterialCommunityIcons name="archive-arrow-down-outline" size={22} color="#F97316" />}
            <Text style={styles.deleteText}>Delete Group</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.dangerButton, { backgroundColor: th.cardBg }, groupActionBusy ? { opacity: 0.65 } : null]}
            onPress={destroyGroup}
            disabled={!!groupActionBusy}
          >
            {groupActionBusy === 'destroy'
              ? <ActivityIndicator size="small" color="#DC2626" />
              : <MaterialCommunityIcons name="delete-forever" size={22} color="#DC2626" />}
            <Text style={styles.destroyText}>Destroy Group</Text>
          </TouchableOpacity>
        </View>
      )}

      <TouchableOpacity 
        style={[styles.leaveButton, { backgroundColor: th.cardBg }]} 
        onPress={leaveGroup}
      >
        <MaterialCommunityIcons name="logout" size={22} color="#EF4444" />
        <Text style={styles.leaveText}>Leave Group</Text>
      </TouchableOpacity>
      
      <View style={{ height: 40 }} />

      {/* Invite Link Modal */}
      <Modal visible={showInviteModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <Pressable style={styles.modalBackdrop} onPress={() => setShowInviteModal(false)} />
          <View style={[styles.modalView, { backgroundColor: th.cardBg }]}>
            <Text style={[styles.modalTitle, { color: th.textDark }]}>Invite Link</Text>
            
            <View style={[styles.codeContainer, { backgroundColor: th.inputBg }]}>
              <Text style={[styles.codeText, { color: th.textDark }]}>{inviteLink?.code}</Text>
            </View>
            
            <View style={styles.modalButtons}>
              <TouchableOpacity 
                style={[styles.modalButton, { backgroundColor: th.inputBg }]}
                onPress={copyInviteCode}
              >
                <MaterialCommunityIcons name="content-copy" size={20} color={th.textDark} />
                <Text style={[styles.modalButtonText, { color: th.textDark }]}>Copy</Text>
              </TouchableOpacity>
              
              <TouchableOpacity 
                style={[styles.modalButton, { backgroundColor: th.accent }]}
                onPress={shareInviteLink}
              >
                <MaterialCommunityIcons name="share" size={20} color="white" />
                <Text style={[styles.modalButtonText, { color: 'white' }]}>Share</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Join Group Modal */}
      <Modal visible={showJoinModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <Pressable style={styles.modalBackdrop} onPress={() => setShowJoinModal(false)} />
          <View style={[styles.modalView, { backgroundColor: th.cardBg }]}>
            <Text style={[styles.modalTitle, { color: th.textDark }]}>Join Group</Text>
            
            <TextInput
              style={[styles.input, { backgroundColor: th.inputBg, color: th.textDark }]}
              placeholder="Enter invite code"
              placeholderTextColor={th.textSoft}
              value={inviteCode}
              onChangeText={setInviteCode}
              autoCapitalize="characters"
            />
            
            <TouchableOpacity 
              style={[styles.modalButton, { backgroundColor: th.accent }, !inviteCode.trim() && { opacity: 0.5 }]}
              onPress={joinGroupWithCode}
              disabled={!inviteCode.trim()}
            >
              <Text style={[styles.modalButtonText, { color: 'white' }]}>Join Group</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Add by Username Modal */}
      <Modal visible={showAddModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <Pressable style={styles.modalBackdrop} onPress={() => { setShowAddModal(false); setSearchResults([]); }} />
          <View style={[styles.modalView, { backgroundColor: th.cardBg }]}>
            <Text style={[styles.modalTitle, { color: th.textDark }]}>Add by Username</Text>
            
            <TextInput
              style={[styles.input, { backgroundColor: th.inputBg, color: th.textDark }]}
              placeholder="Enter username"
              placeholderTextColor={th.textSoft}
              value={addUsername}
              onChangeText={(text) => { setAddUsername(text); searchUsersByUsername(text); }}
              autoCapitalize="none"
            />

            {searching && <ActivityIndicator size="small" color={th.accent} style={{ marginVertical: 10 }} />}
            
            {searchResults.length > 0 && (
              <View style={styles.searchResults}>
                <Text style={[styles.searchResultsLabel, { color: th.textSoft }]}>Select a user to add:</Text>
                {searchResults.map((result) => (
                  <View 
                    key={result.id} 
                    style={[styles.searchResultItem, { borderBottomColor: th.divider }]}
                  >
                    <View style={styles.searchUserInfo}>
                      <View style={[styles.searchAvatar, { backgroundColor: th.accent + '20' }]}>
                        <Text style={{ color: th.accent, fontWeight: '600' }}>{result.username[0].toUpperCase()}</Text>
                      </View>
                      <Text style={[styles.searchUsername, { color: th.textDark }]}>{result.username}</Text>
                    </View>
                    <TouchableOpacity 
                      style={[styles.addUserButton, { backgroundColor: th.accent }]}
                      onPress={() => addByUsername(result.id, result.username)}
                    >
                      <Text style={styles.addUserButtonText}>Add</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}

            {addUsername.length >= 2 && !searching && searchResults.length === 0 && (
              <Text style={[styles.noResults, { color: th.textSoft }]}>No users found</Text>
            )}

            <TouchableOpacity 
              style={[styles.modalButton, { backgroundColor: th.accent, marginTop: 16 }]}
              onPress={() => { setShowAddModal(false); setSearchResults([]); }}
            >
              <Text style={[styles.modalButtonText, { color: 'white' }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  profileSection: { alignItems: 'center', padding: 24 },
  bannerWrap: { width: '100%', height: 140, borderRadius: 16, overflow: 'hidden', marginBottom: 16 },
  bannerImage: { width: '100%', height: '100%' },
  bannerPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6 },
  bannerText: { fontSize: 12 },
  bannerLoading: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.15)' },
  groupAvatar: { width: 90, height: 90, borderRadius: 28, justifyContent: 'center', alignItems: 'center', marginBottom: 16, overflow: 'hidden' },
  groupAvatarImage: { width: 90, height: 90, borderRadius: 28 },
  avatarLoading: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.15)' },
  groupName: { fontSize: 24, fontWeight: '700', marginBottom: 8, textAlign: 'center' },
  groupDesc: { fontSize: 15, textAlign: 'center', marginBottom: 12, paddingHorizontal: 20, lineHeight: 22 },
  memberCountText: { fontSize: 14 },
  inviteButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginHorizontal: 16, marginTop: 16, padding: 14, borderRadius: 14, gap: 8 },
  inviteButtonText: { color: 'white', fontSize: 16, fontWeight: '600' },
  settingsSection: { marginTop: 16 },
  settingItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 0.5 },
  settingLeft: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  settingText: { fontSize: 16 },
  settingSubtext: { fontSize: 12, marginTop: 2 },
  sectionHeader: { paddingHorizontal: 18, paddingTop: 24, paddingBottom: 10 },
  sectionTitle: { fontSize: 13, fontWeight: '600', letterSpacing: 0.5 },
  membersList: { marginTop: 0 },
  memberItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, borderBottomWidth: 0.5 },
  memberInfo: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  memberAvatar: { width: 44, height: 44, borderRadius: 22, marginRight: 14 },
  memberAvatarPlaceholder: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center', marginRight: 14 },
  memberTextContainer: { flexDirection: 'column', alignItems: 'flex-start', gap: 2 },
  memberName: { fontSize: 16, fontWeight: '500' },
  memberFormer: { fontSize: 12, lineHeight: 16 },
  roleBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  roleText: { fontSize: 11, fontWeight: '600' },
  memberActions: { flexDirection: 'row', gap: 4 },
  actionButton: { padding: 8, borderRadius: 10 },
  addButton: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
  showMoreButton: { padding: 16, alignItems: 'center' },
  showMoreText: { fontSize: 15, fontWeight: '600' },
  infoSection: { marginTop: 0 },
  infoItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 0.5 },
  infoLabel: { fontSize: 15 },
  infoValue: { fontSize: 15, fontWeight: '500' },
  adminDangerWrap: { marginTop: 14, gap: 10 },
  dangerButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginHorizontal: 16, padding: 14, borderRadius: 14, gap: 10 },
  deleteText: { color: '#F97316', fontSize: 16, fontWeight: '600' },
  destroyText: { color: '#DC2626', fontSize: 16, fontWeight: '700' },
  leaveButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 24, marginHorizontal: 16, padding: 16, borderRadius: 14, gap: 10 },
  leaveText: { color: '#EF4444', fontSize: 16, fontWeight: '600' },
  modalOverlay: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  modalView: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, marginTop: 40 },
  modalTitle: { fontSize: 22, fontWeight: '700', textAlign: 'center', marginBottom: 20 },
  codeContainer: { padding: 20, borderRadius: 14, alignItems: 'center', marginBottom: 20 },
  codeText: { fontSize: 28, fontWeight: '700', letterSpacing: 4 },
  modalButtons: { flexDirection: 'row', gap: 12 },
  modalButton: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 14, borderRadius: 12, gap: 8 },
  modalButtonText: { fontSize: 16, fontWeight: '600' },
  input: { height: 50, borderRadius: 12, paddingHorizontal: 16, fontSize: 16, marginBottom: 16 },
  searchResults: { maxHeight: 250 },
  searchResultsLabel: { fontSize: 13, fontWeight: '600', marginBottom: 8, marginLeft: 4 },
  searchResultItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12, borderBottomWidth: 0.5 },
  searchUserInfo: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  searchAvatar: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  searchUsername: { fontSize: 16, fontWeight: '500' },
  addUserButton: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 16 },
  addUserButtonText: { color: 'white', fontSize: 14, fontWeight: '600' },
  noResults: { textAlign: 'center', marginTop: 10 },
});

export default GroupInfoScreen;