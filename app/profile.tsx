import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import * as LocalAuthentication from 'expo-local-authentication';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, Modal, Platform, Pressable,
  ScrollView, Share, StyleSheet, Switch, Text,
  TextInput, TouchableOpacity, View,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/contexts/AuthContext';
import { useSettings } from '@/contexts/SettingsContext';
import { callAuthFunction, supabaseClient } from '@/lib/supabase';

// ─── Theme ───────────────────────────────────────────────────────────────────
const BG        = '#F4F6F8';
const CARD_BG   = '#FFFFFF';
const TEXT_DARK = '#1A2332';
const TEXT_MED  = '#5A7182';
const TEXT_SOFT = '#8FA3B1';
const ERROR     = '#FF5F6D';

// Dark mode colors
const DK_BG        = '#111827';
const DK_CARD_BG   = '#1F2937';
const DK_TEXT_DARK = '#F9FAFB';
const DK_TEXT_SOFT = '#9CA3AF';
const DK_DIVIDER   = 'rgba(255,255,255,0.07)';

const FONT_SIZES: Record<string, number> = { sm: 13, md: 15, lg: 17, xl: 19 };

const ACCENT_COLORS = ['#4CAF82','#3B82F6','#F59E0B','#EF4444','#8B5CF6','#EC4899'];

// ─── Helpers ─────────────────────────────────────────────────────────────────
function timeAgoFull(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

// ─── Main screen ─────────────────────────────────────────────────────────────
export default function ProfileScreen() {
  const { user, sessionToken, signOut, updateUser } = useAuth();
  const { settings, update } = useSettings();

  // ── Dynamic theme from settings ──────────────────────────────────────────
  const dk   = settings.darkMode;
  const ACC  = settings.accentColor;
  const FS   = FONT_SIZES[settings.fontSize] ?? 15;
  const bg   = dk ? DK_BG : BG;
  const cardBg   = dk ? DK_CARD_BG : CARD_BG;
  const textDark = dk ? DK_TEXT_DARK : TEXT_DARK;
  const textSoft = dk ? DK_TEXT_SOFT : TEXT_SOFT;
  const dividerC = dk ? DK_DIVIDER : 'rgba(0,0,0,0.04)';

  // Dynamic style objects (depend on settings)
  const dynSafe    = { flex: 1, backgroundColor: bg } as const;
  const dynContent = { paddingHorizontal: 18, paddingTop: 16, paddingBottom: 40, gap: 10 } as const;
  const dynCard    = { backgroundColor: cardBg, borderRadius: 18, overflow: 'hidden' as const, borderWidth: 1, borderColor: dk ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' };
  const dynRow     = { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, paddingHorizontal: 16, paddingVertical: 14 };
  const dynRowLabel   = { fontSize: FS, fontWeight: '500' as const, color: textDark };
  const dynRowValue   = { fontSize: FS - 2, color: textSoft };
  const dynDivider    = { height: 1, backgroundColor: dividerC, marginLeft: 54 };
  const dynSectionTitle = { fontSize: 12, fontWeight: '700' as const, color: textSoft, textTransform: 'uppercase' as const, letterSpacing: 1.2, marginLeft: 6, marginBottom: 4, marginTop: 10 };

  // Local state for modals
  const [editUsernameVisible, setEditUsernameVisible]     = useState(false);
  const [newUsername, setNewUsername]                     = useState('');
  const [usernameLoading, setUsernameLoading]             = useState(false);
  const [qrVisible, setQrVisible]                        = useState(false);
  const [devicesVisible, setDevicesVisible]               = useState(false);
  const [sessions, setSessions]                           = useState<any[]>([]);
  const [sessionsLoading, setSessionsLoading]             = useState(false);
  const [colorPickerVisible, setColorPickerVisible]       = useState(false);
  const [whoMsgVisible, setWhoMsgVisible]                 = useState(false);
  const [disappearVisible, setDisappearVisible]           = useState(false);
  const [avatarLoading, setAvatarLoading]                 = useState(false);

  const joinDate = user ? new Date(user.created_at).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  }) : '—';

  // ── 1a. Change Profile Picture (signed URL upload) ────────────────────────
  const handleChangePicture = useCallback(() => {
    Alert.alert(
      'Change Profile Picture',
      'Choose a source',
      [
        { text: 'Camera', onPress: () => pickImage('camera') },
        { text: 'Gallery', onPress: () => pickImage('gallery') },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  }, []);

  const pickImage = async (source: 'camera' | 'gallery') => {
    try {
      let result: ImagePicker.ImagePickerResult;
      if (source === 'camera') {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== 'granted') { Alert.alert('Permission needed', 'Camera access is required.'); return; }
        result = await ImagePicker.launchCameraAsync({ allowsEditing: true, aspect: [1, 1], quality: 0.8 });
      } else {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') { Alert.alert('Permission needed', 'Gallery access is required.'); return; }
        result = await ImagePicker.launchImageLibraryAsync({ allowsEditing: true, aspect: [1, 1], quality: 0.8 });
      }
      if (result.canceled || !result.assets?.[0]) return;

      setAvatarLoading(true);
      const asset = result.assets[0];

      // Resize to 400x400 and compress
      const manipResult = await ImageManipulator.manipulateAsync(
        asset.uri,
        [{ resize: { width: 400, height: 400 } }],
        { compress: 0.75, format: ImageManipulator.SaveFormat.JPEG },
      );

      // Step 1: get signed upload URL from Edge Function (avoids anon key limitations)
      const uploadInfo = await callAuthFunction({ action: 'get-upload-url', sessionToken });
      const { signedUrl, publicUrl } = uploadInfo;

      // Step 2: upload image blob directly to the signed URL
      const imageRes = await fetch(manipResult.uri);
      const blob = await imageRes.blob();
      const uploadRes = await fetch(signedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/jpeg', 'x-upsert': 'true' },
        body: blob,
      });
      if (!uploadRes.ok) {
        const txt = await uploadRes.text();
        throw new Error(`Upload failed: ${txt}`);
      }

      // Step 3: save the public URL to the user record
      const cachebustedUrl = `${publicUrl}?t=${Date.now()}`;
      const res = await callAuthFunction({ action: 'update-avatar', sessionToken, avatarUrl: cachebustedUrl });
      updateUser(res.user);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      Alert.alert('Upload Failed', e.message ?? 'Could not update profile picture. Make sure the "avatars" Storage bucket exists in Supabase (public, enabled).');
    } finally { setAvatarLoading(false); }
  };

  // ── 1b. Edit Username ────────────────────────────────────────────────────
  const handleUpdateUsername = useCallback(async () => {
    if (!newUsername.trim()) return;
    setUsernameLoading(true);
    try {
      const res = await callAuthFunction({ action: 'update-username', sessionToken, newUsername: newUsername.trim() });
      updateUser(res.user);
      setEditUsernameVisible(false);
      setNewUsername('');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Failed to update username');
    } finally { setUsernameLoading(false); }
  }, [newUsername, sessionToken]);

  // ── 1c. Copy ID ──────────────────────────────────────────────────────────
  const handleCopyId = useCallback(async () => {
    await Clipboard.setStringAsync(user?.username ?? '');
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert('Copied!', 'Your Privy ID has been copied to the clipboard.');
  }, [user?.username]);

  // ── 1d. Share ID ─────────────────────────────────────────────────────────
  const handleShareId = useCallback(async () => {
    try {
      await Share.share({ message: `Add me on Privy! My ID is: ${user?.username}` });
    } catch {}
  }, [user?.username]);

  // ── 4a. Biometric Lock ───────────────────────────────────────────────────
  const handleBiometricToggle = useCallback(async (v: boolean) => {
    if (v) {
      const compatible = await LocalAuthentication.hasHardwareAsync();
      if (!compatible) { Alert.alert('Not Supported', 'Your device does not support biometric authentication.'); return; }
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      if (!enrolled) { Alert.alert('No Biometrics', 'Please set up fingerprint or face authentication in your device settings first.'); return; }
      const auth = await LocalAuthentication.authenticateAsync({ promptMessage: 'Verify identity to enable lock' });
      if (!auth.success) { Alert.alert('Authentication Failed', 'Could not verify your biometrics.'); return; }
    }
    update('biometricLock', v);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [update]);

  // ── 4d. Active Devices ───────────────────────────────────────────────────
  const openDevices = useCallback(async () => {
    setDevicesVisible(true);
    setSessionsLoading(true);
    try {
      const res = await callAuthFunction({ action: 'get-sessions', sessionToken });
      setSessions(res.sessions ?? []);
    } catch { Alert.alert('Error', 'Could not load devices.'); }
    finally { setSessionsLoading(false); }
  }, [sessionToken]);

  const revokeSession = useCallback(async (id: string, isCurrent: boolean) => {
    if (isCurrent) { Alert.alert('Info', 'This is your current session. Use Sign Out instead.'); return; }
    Alert.alert('Revoke Session', 'Log out this device?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Revoke', style: 'destructive', onPress: async () => {
        try {
          await callAuthFunction({ action: 'revoke-session', sessionToken, revokeId: id });
          setSessions(prev => prev.filter(s => s.id !== id));
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } catch (e: any) { Alert.alert('Error', e.message); }
      }},
    ]);
  }, [sessionToken]);

  // ── 6. Sign Out / Delete ─────────────────────────────────────────────────
  const handleSignOut = useCallback(async () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: async () => {
        try { await signOut(); router.dismissAll(); router.replace('/auth'); } catch {}
      }},
    ]);
  }, [signOut]);

  const handleDeleteAccount = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    Alert.alert(
      '⚠️ Delete Account',
      'This will permanently delete your account and all data. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Continue', style: 'destructive', onPress: () => {
          Alert.alert('Confirm', 'Type DELETE to confirm account deletion.\n\n(Emoji key verification will be required)', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'I understand, delete my account', style: 'destructive', onPress: async () => {
              Alert.alert('Coming Soon', 'Emoji key re-authentication for account deletion is coming in the next update.');
            }},
          ]);
        }},
      ],
    );
  }, []);

  const avatarSource = user?.avatar_url ? { uri: user.avatar_url } : null;

  return (
    <SafeAreaView style={dynSafe}>
      <ScrollView contentContainerStyle={dynContent} showsVerticalScrollIndicator={false}>

        {/* ── Avatar + name ── */}
        <Pressable style={[styles.idCard, { backgroundColor: cardBg, borderColor: `${ACC}33` }]} onPress={handleChangePicture}>
          <View style={styles.idAvatarWrap}>
            {avatarLoading ? (
              <View style={[styles.idAvatarImg, { alignItems: 'center', justifyContent: 'center' }]}>
                <ActivityIndicator color={ACC} />
              </View>
            ) : avatarSource ? (
              <Image source={avatarSource} style={styles.idAvatarImg} contentFit="cover" />
            ) : (
              <View style={[styles.idAvatarImg, { alignItems: 'center', justifyContent: 'center', backgroundColor: `${ACC}25` }]}>
                <Text style={{ fontSize: 36 }}>👤</Text>
              </View>
            )}
            <View style={[styles.cameraTag, { backgroundColor: ACC }]}><Text style={styles.cameraIcon}>📷</Text></View>
          </View>
          <View style={styles.idInfo}>
            <Text style={[styles.idName, { color: textDark, fontSize: FS + 3 }]}>{user?.username ?? '—'}</Text>
            <Text style={[styles.idSince, { color: textSoft }]}>Member since {joinDate}</Text>
            <Text style={{ color: ACC, fontSize: 11, marginTop: 2 }}>Tap to change photo</Text>
          </View>
          <View style={[styles.idBadge, { backgroundColor: `${ACC}1A`, borderColor: `${ACC}33` }]}><Text style={styles.idBadgeText}>🛡️</Text></View>
        </Pressable>

        {/* ─── 1. Profile ─────────────────────────────────────────────── */}
        <Text style={dynSectionTitle}>Profile</Text>
        <View style={dynCard}>
          <Pressable style={({ pressed }) => [dynRow, pressed && { opacity: 0.75 }]} onPress={handleChangePicture}>
            <View style={styles.rowLeft}><Text style={styles.rowIcon}>👤</Text><Text style={[dynRowLabel]}>Change Profile Picture</Text></View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
          <View style={[dynDivider]} />
          <Pressable style={({ pressed }) => [dynRow, pressed && { opacity: 0.75 }]} onPress={() => { setNewUsername(user?.username ?? ''); setEditUsernameVisible(true); }}>
            <View style={styles.rowLeft}><Text style={styles.rowIcon}>✏️</Text><Text style={dynRowLabel}>Edit Username</Text></View>
            <View style={styles.rowRight}><Text style={dynRowValue}>{user?.username}</Text><Text style={styles.chevron}>›</Text></View>
          </Pressable>
          <View style={[dynDivider]} />
          <Pressable style={({ pressed }) => [dynRow, pressed && { opacity: 0.75 }]} onPress={handleCopyId}>
            <View style={styles.rowLeft}><Text style={styles.rowIcon}>🆔</Text><Text style={dynRowLabel}>Copy Privy ID</Text></View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
          <View style={[dynDivider]} />
          <Pressable style={({ pressed }) => [dynRow, pressed && { opacity: 0.75 }]} onPress={handleShareId}>
            <View style={styles.rowLeft}><Text style={styles.rowIcon}>🔗</Text><Text style={dynRowLabel}>Share Privy ID</Text></View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
          <View style={[dynDivider]} />
          <Pressable style={({ pressed }) => [dynRow, pressed && { opacity: 0.75 }]} onPress={() => setQrVisible(true)}>
            <View style={styles.rowLeft}><Text style={styles.rowIcon}>📷</Text><Text style={dynRowLabel}>QR Code for Adding Friends</Text></View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        </View>

        {/* ─── 2. Personalization ─────────────────────────────────────── */}
        <Text style={dynSectionTitle}>Personalization</Text>
        <View style={dynCard}>
          <Pressable style={({ pressed }) => [dynRow, pressed && { opacity: 0.75 }]} onPress={() => setColorPickerVisible(true)}>
            <View style={styles.rowLeft}><Text style={styles.rowIcon}>🎨</Text><Text style={dynRowLabel}>Theme Color</Text></View>
            <View style={styles.rowRight}>
              <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: ACC, marginRight: 4 }} />
              <Text style={styles.chevron}>›</Text>
            </View>
          </Pressable>
          <View style={dynDivider} />
          <View style={dynRow}>
            <View style={styles.rowLeft}><Text style={styles.rowIcon}>🌙</Text><Text style={dynRowLabel}>Dark Mode</Text></View>
            <Switch value={settings.darkMode} onValueChange={v => { Haptics.selectionAsync(); update('darkMode', v); }}
              trackColor={{ false: '#D0DAE4', true: ACC }} thumbColor="#fff" />
          </View>
          <View style={dynDivider} />
          <Pressable style={({ pressed }) => [dynRow, pressed && { opacity: 0.75 }]}
            onPress={() => { update('bubbleStyle', settings.bubbleStyle === 'rounded' ? 'square' : 'rounded'); Haptics.selectionAsync(); }}>
            <View style={styles.rowLeft}><Text style={styles.rowIcon}>💬</Text><Text style={dynRowLabel}>Chat Bubble Style</Text></View>
            <View style={styles.rowRight}><Text style={dynRowValue}>{settings.bubbleStyle === 'rounded' ? 'Rounded' : 'Square'}</Text><Text style={styles.chevron}>›</Text></View>
          </Pressable>
          <View style={dynDivider} />
          <Pressable style={({ pressed }) => [dynRow, pressed && { opacity: 0.75 }]}
            onPress={() => { const s = ['sm','md','lg','xl'] as const; update('fontSize', s[(s.indexOf(settings.fontSize)+1)%4]); Haptics.selectionAsync(); }}>
            <View style={styles.rowLeft}><Text style={styles.rowIcon}>🔤</Text><Text style={dynRowLabel}>Font Size</Text></View>
            <View style={styles.rowRight}><Text style={dynRowValue}>{settings.fontSize.toUpperCase()}</Text><Text style={styles.chevron}>›</Text></View>
          </Pressable>
        </View>

        {/* ─── 3. Chat Preferences ────────────────────────────────────── */}
        <Text style={dynSectionTitle}>Chat Preferences</Text>
        <View style={dynCard}>
          {[
            { icon:'✔️', label:'Read Receipts',       key:'readReceipts'    as const },
            { icon:'✏️', label:'Typing Indicators',   key:'typingIndicator' as const },
          ].map((item, i, arr) => (
            <React.Fragment key={item.key}>
              <View style={dynRow}>
                <View style={styles.rowLeft}><Text style={styles.rowIcon}>{item.icon}</Text><Text style={dynRowLabel}>{item.label}</Text></View>
                <Switch value={settings[item.key] as boolean}
                  onValueChange={v => { Haptics.selectionAsync(); update(item.key, v); }}
                  trackColor={{ false: '#D0DAE4', true: ACC }} thumbColor="#fff" />
              </View>
              {i < arr.length - 1 && <View style={dynDivider} />}
            </React.Fragment>
          ))}
          <View style={dynDivider} />
          <Pressable style={({ pressed }) => [dynRow, pressed && { opacity: 0.75 }]} onPress={() => setDisappearVisible(true)}>
            <View style={styles.rowLeft}><Text style={styles.rowIcon}>⏳</Text><Text style={dynRowLabel}>Disappearing Messages</Text></View>
            <View style={styles.rowRight}><Text style={dynRowValue}>{({off:'Off','24h':'24h','7d':'7d','30d':'30d'})[settings.disappearDefault]}</Text><Text style={styles.chevron}>›</Text></View>
          </Pressable>
          <View style={dynDivider} />
          <View style={dynRow}>
            <View style={styles.rowLeft}><Text style={styles.rowIcon}>📥</Text><Text style={dynRowLabel}>Auto Download Media</Text></View>
            <Switch value={settings.autoDownload} onValueChange={v => { Haptics.selectionAsync(); update('autoDownload', v); }}
              trackColor={{ false: '#D0DAE4', true: ACC }} thumbColor="#fff" />
          </View>
        </View>

        {/* ─── 4. Privacy & Security ──────────────────────────────────── */}
        <Text style={dynSectionTitle}>Privacy & Security</Text>
        <View style={dynCard}>
          <View style={dynRow}>
            <View style={styles.rowLeft}><Text style={styles.rowIcon}>🔐</Text><Text style={dynRowLabel}>Biometric Lock</Text></View>
            <Switch value={settings.biometricLock} onValueChange={handleBiometricToggle}
              trackColor={{ false: '#D0DAE4', true: ACC }} thumbColor="#fff" />
          </View>
          <View style={dynDivider} />
          <Pressable style={({ pressed }) => [dynRow, pressed && { opacity: 0.75 }]} onPress={() => setWhoMsgVisible(true)}>
            <View style={styles.rowLeft}><Text style={styles.rowIcon}>👁</Text><Text style={dynRowLabel}>Who Can Message Me</Text></View>
            <View style={styles.rowRight}><Text style={dynRowValue}>{{everyone:'Everyone',friends:'Friends Only',nobody:'Nobody'}[settings.whoCanMessage]}</Text><Text style={styles.chevron}>›</Text></View>
          </Pressable>
          <View style={dynDivider} />
          <Pressable style={({ pressed }) => [dynRow, pressed && { opacity: 0.75 }]} onPress={() => Alert.alert('Blocked Users', 'No blocked users yet.')}>
            <View style={styles.rowLeft}><Text style={styles.rowIcon}>🚫</Text><Text style={dynRowLabel}>Blocked Users</Text></View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
          <View style={dynDivider} />
          <Pressable style={({ pressed }) => [dynRow, pressed && { opacity: 0.75 }]} onPress={() => Alert.alert('Change Emoji Key','Coming soon!')}>
            <View style={styles.rowLeft}><Text style={styles.rowIcon}>🔑</Text><Text style={dynRowLabel}>Change Emoji Key</Text></View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
          <View style={dynDivider} />
          <Pressable style={({ pressed }) => [dynRow, pressed && { opacity: 0.75 }]} onPress={openDevices}>
            <View style={styles.rowLeft}><Text style={styles.rowIcon}>📱</Text><Text style={dynRowLabel}>Active Devices</Text></View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        </View>

        {/* ─── 5. Notifications ───────────────────────────────────────── */}
        <Text style={dynSectionTitle}>Notifications</Text>
        <View style={dynCard}>
          {[
            { icon:'🔔', label:'Message Notifications', key:'msgNotifs'  as const },
            { icon:'🔕', label:'Mute Groups',           key:'muteGroups' as const },
            { icon:'🌙', label:'Do Not Disturb',        key:'dnd'        as const },
          ].map((item, i, arr) => (
            <React.Fragment key={item.key}>
              <View style={dynRow}>
                <View style={styles.rowLeft}><Text style={styles.rowIcon}>{item.icon}</Text><Text style={dynRowLabel}>{item.label}</Text></View>
                <Switch value={settings[item.key] as boolean}
                  onValueChange={v => { Haptics.selectionAsync(); update(item.key, v); }}
                  trackColor={{ false: '#D0DAE4', true: ACC }} thumbColor="#fff" />
              </View>
              {i < arr.length - 1 && <View style={dynDivider} />}
            </React.Fragment>
          ))}
        </View>

        {/* ─── 6. Account ─────────────────────────────────────────────── */}
        <Text style={dynSectionTitle}>Account</Text>
        <View style={dynCard}>
          <Pressable style={({ pressed }) => [dynRow, pressed && { opacity: 0.75 }]} onPress={handleSignOut}>
            <View style={styles.rowLeft}><Text style={styles.rowIcon}>🔓</Text><Text style={[dynRowLabel, { color: ERROR }]}>Sign Out</Text></View>
          </Pressable>
          <View style={dynDivider} />
          <Pressable style={({ pressed }) => [dynRow, pressed && { opacity: 0.75 }]} onPress={handleDeleteAccount}>
            <View style={styles.rowLeft}><Text style={styles.rowIcon}>🗑</Text><Text style={[dynRowLabel, { color: ERROR }]}>Delete Account</Text></View>
          </Pressable>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* ── Edit Username Modal ── */}
      <Modal visible={editUsernameVisible} transparent animationType="slide" onRequestClose={() => setEditUsernameVisible(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setEditUsernameVisible(false)}>
          <Pressable style={styles.modalSheet} onPress={() => {}}>
            <Text style={styles.modalTitle}>Edit Username</Text>
            <Text style={styles.modalSub}>3–20 characters. Letters, numbers, underscores.</Text>
            <TextInput
              style={styles.modalInput}
              value={newUsername}
              onChangeText={setNewUsername}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="new_username"
              placeholderTextColor={TEXT_SOFT}
              maxLength={20}
            />
            <Pressable style={[styles.modalBtn, usernameLoading && { opacity: 0.6 }]} onPress={handleUpdateUsername} disabled={usernameLoading}>
              {usernameLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalBtnText}>Save Username</Text>}
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── QR Code Modal ── */}
      <Modal visible={qrVisible} transparent animationType="fade" onRequestClose={() => setQrVisible(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setQrVisible(false)}>
          <Pressable style={[styles.modalSheet, { alignItems: 'center', gap: 20 }]} onPress={() => {}}>
            <Text style={styles.modalTitle}>Your QR Code</Text>
            <View style={styles.qrWrap}>
              <QRCode value={`privy:${user?.username}`} size={220} color={TEXT_DARK} backgroundColor="white" />
            </View>
            <Text style={styles.modalSub}>Friends can scan this to add you on Privy</Text>
            <Pressable style={styles.modalBtn} onPress={handleShareId}>
              <Text style={styles.modalBtnText}>Share ID Instead</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Color Picker Modal ── */}
      <Modal visible={colorPickerVisible} transparent animationType="slide" onRequestClose={() => setColorPickerVisible(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setColorPickerVisible(false)}>
          <Pressable style={styles.modalSheet} onPress={() => {}}>
            <Text style={styles.modalTitle}>Theme Color</Text>
            <View style={styles.colorRow}>
              {ACCENT_COLORS.map(c => (
                <Pressable key={c} style={[styles.colorDot, { backgroundColor: c, borderColor: settings.accentColor === c ? TEXT_DARK : 'transparent', transform: [{ scale: settings.accentColor === c ? 1.15 : 1 }] }]}
                  onPress={() => { update('accentColor', c); Haptics.selectionAsync(); setColorPickerVisible(false); }} />
              ))}
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Who Can Message Modal ── */}
      <Modal visible={whoMsgVisible} transparent animationType="slide" onRequestClose={() => setWhoMsgVisible(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setWhoMsgVisible(false)}>
          <Pressable style={styles.modalSheet} onPress={() => {}}>
            <Text style={styles.modalTitle}>Who Can Message Me</Text>
            {([['everyone','Everyone'],['friends','Friends Only'],['nobody','Nobody']] as const).map(([val, label]) => (
              <Pressable key={val} style={[styles.optionRow, settings.whoCanMessage === val && { backgroundColor: `${ACC}1A`, borderWidth: 1, borderColor: `${ACC}4D` }]}
                onPress={() => { update('whoCanMessage', val); Haptics.selectionAsync(); setWhoMsgVisible(false); }}>
                <Text style={[styles.optionText, settings.whoCanMessage === val && { color: ACC, fontWeight: '700' }]}>{label}</Text>
                {settings.whoCanMessage === val && <Text style={{ color: ACC }}>✓</Text>}
              </Pressable>
            ))}
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Disappearing Messages Modal ── */}
      <Modal visible={disappearVisible} transparent animationType="slide" onRequestClose={() => setDisappearVisible(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setDisappearVisible(false)}>
          <Pressable style={styles.modalSheet} onPress={() => {}}>
            <Text style={styles.modalTitle}>Default Disappearing Messages</Text>
            {([['off','Off'],['24h','24 Hours'],['7d','7 Days'],['30d','30 Days']] as const).map(([val, label]) => (
              <Pressable key={val} style={[styles.optionRow, settings.disappearDefault === val && { backgroundColor: `${ACC}1A`, borderWidth: 1, borderColor: `${ACC}4D` }]}
                onPress={() => { update('disappearDefault', val); Haptics.selectionAsync(); setDisappearVisible(false); }}>
                <Text style={[styles.optionText, settings.disappearDefault === val && { color: ACC, fontWeight: '700' }]}>{label}</Text>
                {settings.disappearDefault === val && <Text style={{ color: ACC }}>✓</Text>}
              </Pressable>
            ))}
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Active Devices Modal ── */}
      <Modal visible={devicesVisible} transparent animationType="slide" onRequestClose={() => setDevicesVisible(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setDevicesVisible(false)}>
          <Pressable style={[styles.modalSheet, { maxHeight: '75%' }]} onPress={() => {}}>
            <Text style={styles.modalTitle}>Active Devices</Text>
            {sessionsLoading ? (
              <ActivityIndicator color={ACC} style={{ marginVertical: 24 }} />
            ) : sessions.length === 0 ? (
              <Text style={[styles.modalSub, { textAlign: 'center', padding: 20 }]}>No active sessions found.</Text>
            ) : (
              <ScrollView style={{ width: '100%' }} contentContainerStyle={{ gap: 10, paddingTop: 4 }}>
                {sessions.map((s, i) => (
                  <View key={s.id} style={styles.deviceRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.deviceLabel}>{i === 0 ? '📱 This device' : `📱 Device ${i + 1}`}</Text>
                      <Text style={styles.deviceSub}>Logged in {timeAgoFull(s.created_at)}</Text>
                    </View>
                    <Pressable
                      style={[styles.revokeBtn, i === 0 && { opacity: 0.35 }]}
                      onPress={() => revokeSession(s.id, i === 0)}
                    >
                      <Text style={styles.revokeBtnText}>{i === 0 ? 'Current' : 'Revoke'}</Text>
                    </Pressable>
                  </View>
                ))}
              </ScrollView>
            )}
          </Pressable>
        </Pressable>
      </Modal>

    </SafeAreaView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: BG },
  content: { paddingHorizontal: 18, paddingTop: 16, paddingBottom: 40, gap: 10 },

  idCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: CARD_BG, borderRadius: 20, padding: 16,
    borderWidth: 1.5, borderColor: 'rgba(76,175,130,0.18)', marginBottom: 8,
    ...Platform.select({
      web:     { boxShadow: '0px 4px 16px rgba(76,175,130,0.12)' } as any,
      default: { shadowColor: '#4CAF82', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.12, shadowRadius: 16, elevation: 4 },
    }),
  },
  idAvatarWrap:  { position: 'relative' },
  idAvatarImg:   { width: 64, height: 64, borderRadius: 32, overflow: 'hidden' },
  cameraTag:     { position: 'absolute', bottom: -2, right: -2, borderRadius: 10, width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
  cameraIcon:    { fontSize: 12 },
  idInfo:        { flex: 1, gap: 3 },
  idName:        { fontSize: 18, fontWeight: '800', color: TEXT_DARK },
  idSince:       { fontSize: 12, color: TEXT_SOFT },
  idBadge:       { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(76,175,130,0.10)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(76,175,130,0.2)' },
  idBadgeText:   { fontSize: 20 },

  sectionTitle:  { fontSize: 12, fontWeight: '700', color: TEXT_SOFT, textTransform: 'uppercase', letterSpacing: 1.2, marginLeft: 6, marginBottom: 4, marginTop: 10 },
  card:          { backgroundColor: CARD_BG, borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(0,0,0,0.05)' },
  divider:       { height: 1, backgroundColor: 'rgba(0,0,0,0.04)', marginLeft: 54 },

  row:           { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14 },
  rowLeft:       { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  rowRight:      { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowIcon:       { fontSize: 18, width: 26, textAlign: 'center' },
  rowLabel:      { fontSize: 15, fontWeight: '500', color: TEXT_DARK },
  rowValue:      { fontSize: 13, color: TEXT_SOFT },
  chevron:       { fontSize: 20, color: TEXT_SOFT, fontWeight: '400', marginLeft: 2 },

  // Modals
  modalOverlay:  { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  modalSheet:    { backgroundColor: CARD_BG, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40, gap: 16 },
  modalTitle:    { fontSize: 18, fontWeight: '800', color: TEXT_DARK },
  modalSub:      { fontSize: 13, color: TEXT_SOFT },
  modalInput:    { borderWidth: 1.5, borderColor: 'rgba(0,0,0,0.1)', borderRadius: 12, padding: 14, fontSize: 15, color: TEXT_DARK, backgroundColor: BG },
  modalBtn:      { borderRadius: 14, padding: 15, alignItems: 'center' },
  modalBtnText:  { color: '#fff', fontSize: 15, fontWeight: '700' },

  qrWrap:        { backgroundColor: '#fff', padding: 16, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(0,0,0,0.07)' },

  colorRow:      { flexDirection: 'row', gap: 14, flexWrap: 'wrap', justifyContent: 'center', paddingVertical: 8 },
  colorDot:      { width: 46, height: 46, borderRadius: 23, borderWidth: 2, borderColor: 'transparent' },
  colorDotActive:{ borderColor: TEXT_DARK, transform: [{ scale: 1.1 }] },

  optionRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, paddingHorizontal: 16, backgroundColor: '#F4F6F8', borderRadius: 12 },
  optionRowActive:{ borderWidth: 1 },
  optionText:    { fontSize: 15, fontWeight: '500', color: TEXT_DARK },
  optionTextActive:{ fontWeight: '700' },

  deviceRow:     { flexDirection: 'row', alignItems: 'center', backgroundColor: BG, borderRadius: 12, padding: 14, gap: 12 },
  deviceLabel:   { fontSize: 14, fontWeight: '600', color: TEXT_DARK },
  deviceSub:     { fontSize: 12, color: TEXT_SOFT, marginTop: 2 },
  revokeBtn:     { backgroundColor: '#FEF0F1', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8 },
  revokeBtnText: { color: ERROR, fontSize: 13, fontWeight: '700' },
});
