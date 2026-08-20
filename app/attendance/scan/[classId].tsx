import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  createAttendanceSession,
  saveAttendanceRecords,
  getAllEmbeddingsForClass,
  getStudentsForClass,
} from '@/lib/database/db';
import { processGroupPhoto } from '@/lib/ml/FaceMLClient';
import { Colors, Spacing, Radius, Typography } from '@/constants/theme';

type ScanState = 'idle' | 'capturing' | 'processing' | 'done' | 'error';

export default function ScanScreen() {
  const { classId } = useLocalSearchParams<{ classId: string }>();
  const router = useRouter();

  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);

  const [state, setState] = useState<ScanState>('idle');
  const [processStatus, setProcessStatus] = useState('');
  const [capturedUri, setCapturedUri] = useState<string | null>(null);

  const handleCapture = async () => {
    if (!cameraRef.current) return;
    setState('capturing');
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.9 });
      if (!photo) throw new Error('Capture failed');
      setCapturedUri(photo.uri);
      await runRecognition(photo.uri);
    } catch (e: any) {
      Alert.alert('Error', e.message);
      setState('error');
    }
  };

  const handleGallery = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 1,
    });
    if (!result.canceled && result.assets[0]) {
      setCapturedUri(result.assets[0].uri);
      await runRecognition(result.assets[0].uri);
    }
  };

  const runRecognition = async (uri: string) => {
    setState('processing');
    try {
      setProcessStatus('Loading enrolled student data...');
      const rawEmbeddings = await getAllEmbeddingsForClass(Number(classId));
      const students = await getStudentsForClass(Number(classId));

      setProcessStatus(`Detecting faces in photo...`);
      const { results } = await processGroupPhoto(uri, rawEmbeddings);

      setProcessStatus('Matching faces to students...');

      // Build attendance records
      const today = new Date().toISOString().split('T')[0];
      const session = await createAttendanceSession(Number(classId), today, uri);

      const presentStudentIds = new Set<number>();
      const attendanceRows: any[] = [];

      // Add records for detected faces (one student can only be matched once)
      const claimedStudentIds = new Set<number>();
      for (const face of results) {
        if (face.match.type === 'confident') {
          if (claimedStudentIds.has(face.match.studentId)) continue;
          claimedStudentIds.add(face.match.studentId);
          presentStudentIds.add(face.match.studentId);
          attendanceRows.push({
            studentId: face.match.studentId,
            status: 'present',
            confidence: face.match.score,
            faceBox: face.box,
          });
        } else if (face.match.type === 'uncertain') {
          if (claimedStudentIds.has(face.match.studentId)) continue;
          claimedStudentIds.add(face.match.studentId);
          attendanceRows.push({
            studentId: face.match.studentId,
            status: 'uncertain',
            confidence: face.match.score,
            faceBox: face.box,
          });
        } else {
          attendanceRows.push({
            status: 'unknown',
            faceBox: face.box,
          });
        }
      }

      // Mark absent students (enrolled but not confidently detected)
      for (const student of students.filter(s => s.isEnrolled)) {
        if (!presentStudentIds.has(student.id)) {
          const uncertainMatch = attendanceRows.find(
            r => r.status === 'uncertain' && r.studentId === student.id
          );
          if (!uncertainMatch) {
            attendanceRows.push({ studentId: student.id, status: 'absent' });
          }
        }
      }

      await saveAttendanceRecords(session.id, attendanceRows);

      setState('done');
      // Navigate to review
      router.replace(`/attendance/review/${session.id}`);
    } catch (e: any) {
      Alert.alert('Recognition Failed', e.message ?? 'Unknown error');
      setState('error');
    }
  };

  if (!permission) return <View style={styles.container}><ActivityIndicator color={Colors.primary} /></View>;

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <View style={styles.permissionIcon}><Ionicons name="camera-outline" size={30} color={Colors.primaryLight} /></View>
          <Text style={styles.permTitle}>Camera Permission Needed</Text>
          <TouchableOpacity style={styles.permBtn} onPress={requestPermission}>
            <Text style={styles.permBtnText}>Allow Camera</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (state === 'processing' || state === 'done') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          {capturedUri && (
            <Image
              source={{ uri: capturedUri }}
              style={styles.previewImage}
              resizeMode="cover"
            />
          )}
          <View style={styles.processingCard}>
            <ActivityIndicator size="large" color={Colors.primary} style={{ marginBottom: Spacing.md }} />
            <Text style={styles.processingTitle}>Processing Attendance</Text>
            <Text style={styles.processingStatus}>{processStatus}</Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" />

      {/* Overlay grid guide */}
      <View style={styles.gridOverlay} pointerEvents="none">
        <View style={styles.gridHLine} />
        <View style={styles.gridVLine} />
      </View>

      {/* Top bar */}
      <SafeAreaView style={styles.topBar}>
        <View style={styles.topBarContent}>
          <TouchableOpacity style={styles.closeButton} onPress={() => router.back()}><Ionicons name="close" size={22} color="#fff" /></TouchableOpacity>
          <View>
            <Text style={styles.topTitle}>Scan attendance</Text>
            <Text style={styles.topHint}>Fit all students in frame</Text>
          </View>
          <View style={styles.liveBadge}><View style={styles.liveDot} /><Text style={styles.liveText}>LIVE</Text></View>
        </View>
      </SafeAreaView>

      {/* Bottom bar */}
      <View style={styles.bottomBar}>
        {/* Gallery button */}
        <TouchableOpacity
          id="btn-pick-gallery"
          style={styles.galleryButton}
          onPress={handleGallery}
          disabled={state === 'capturing'}
        >
          <View style={styles.galleryIcon}><Ionicons name="images-outline" size={23} color={Colors.textPrimary} /></View>
          <Text style={styles.galleryText}>Gallery</Text>
        </TouchableOpacity>

        {/* Capture button */}
        <TouchableOpacity
          id="btn-capture-group"
          style={styles.captureButton}
          onPress={handleCapture}
          disabled={state === 'capturing'}
          activeOpacity={0.8}
        >
          {state === 'capturing' ? (
            <ActivityIndicator color={Colors.primary} size="large" />
          ) : (
            <View style={styles.captureInner} />
          )}
        </TouchableOpacity>

        <View style={styles.galleryButton} />
      </View>

      {state === 'error' && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>Something went wrong. Try again.</Text>
          <TouchableOpacity onPress={() => setState('idle')}>
            <Text style={styles.errorRetry}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.lg, backgroundColor: Colors.bg },

  permissionIcon: { width: 64, height: 64, borderRadius: Radius.xl, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.primary + '18', marginBottom: Spacing.md },
  permTitle: { ...Typography.heading3, color: Colors.textPrimary, marginBottom: Spacing.lg },
  permBtn: { backgroundColor: Colors.primary, borderRadius: Radius.lg, paddingVertical: Spacing.md, paddingHorizontal: Spacing.xl },
  permBtnText: { ...Typography.body, color: Colors.textOnPrimary, fontWeight: '700' },

  previewImage: { width: '100%', height: 250, borderRadius: Radius.lg, marginBottom: Spacing.lg },
  processingCard: {
    backgroundColor: Colors.bgCard,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    alignItems: 'center',
    width: '100%',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  processingTitle: { ...Typography.heading3, color: Colors.textPrimary, marginBottom: Spacing.xs },
  processingStatus: { ...Typography.bodySmall, color: Colors.textSecondary, textAlign: 'center' },

  gridOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center' },
  gridHLine: { position: 'absolute', width: '100%', height: 1, backgroundColor: 'rgba(255,255,255,0.15)' },
  gridVLine: { position: 'absolute', height: '100%', width: 1, backgroundColor: 'rgba(255,255,255,0.15)' },

  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
  },
  topBarContent: { alignItems: 'center', justifyContent: 'space-between', flexDirection: 'row', paddingTop: Spacing.sm },
  closeButton: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.15)', justifyContent: 'center', alignItems: 'center' },
  topTitle: { ...Typography.heading3, color: Colors.textPrimary },
  topHint: { ...Typography.caption, color: Colors.textSecondary, marginTop: 2 },

  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    backgroundColor: 'rgba(13,13,26,0.92)',
    paddingVertical: Spacing.lg,
    paddingBottom: 40,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
  },
  galleryButton: {
    width: 70,
    alignItems: 'center',
    justifyContent: 'center',
  },
  galleryIcon: { width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(255,255,255,0.15)', justifyContent: 'center', alignItems: 'center' },
  galleryText: { ...Typography.caption, color: Colors.textSecondary, marginTop: 4 },
  liveBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: Radius.full, paddingHorizontal: 9, paddingVertical: 6 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.accent },
  liveText: { ...Typography.caption, color: Colors.textPrimary, fontWeight: '700', letterSpacing: 0.5 },
  captureButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: Colors.textPrimary,
  },
  captureInner: { width: 52, height: 52, borderRadius: 26, backgroundColor: Colors.textPrimary },
  errorBanner: {
    position: 'absolute',
    top: 120,
    left: Spacing.lg,
    right: Spacing.lg,
    backgroundColor: Colors.dangerBg,
    borderRadius: Radius.md,
    padding: Spacing.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.danger + '50',
  },
  errorText: { ...Typography.bodySmall, color: Colors.danger },
  errorRetry: { ...Typography.bodySmall, color: Colors.primary, fontWeight: '700' },
});
