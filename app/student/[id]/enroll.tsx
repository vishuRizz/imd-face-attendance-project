import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Alert,
  ActivityIndicator,
  Animated,
  Dimensions,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  getStudentById,
  saveFaceEmbedding,
  markStudentEnrolled,
  deleteEmbeddingsForStudent,
} from '@/lib/database/db';
import { validateCapture } from '@/lib/ml/FaceMLClient';
import type { Student } from '@/lib/database/schema';
import { Colors, Spacing, Radius, Typography } from '@/constants/theme';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

const CAPTURE_ANGLES = [
  { label: 'Look straight', icon: '😐', hint: 'Face the camera directly' },
  { label: 'Slight left', icon: '😶', hint: 'Turn your face slightly left' },
  { label: 'Slight right', icon: '😶', hint: 'Turn your face slightly right' },
  { label: 'Look up/down', icon: '🙂', hint: 'Tilt your head slightly' },
  { label: 'Natural expression', icon: '😊', hint: 'Smile naturally' },
];

export default function EnrollScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const studentId = Number(id);
  const router = useRouter();

  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);

  const [student, setStudent] = useState<Student | null>(null);
  const [captureIndex, setCaptureIndex] = useState(0);
  const [capturing, setCapturing] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [capturedCount, setCapturedCount] = useState(0);
  const [done, setDone] = useState(false);

  // Animation for capture feedback
  const flashAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    getStudentById(studentId).then(setStudent).catch(console.error);
    // Clear any partial enrollments on mount
    deleteEmbeddingsForStudent(studentId).catch(() => {});
  }, [studentId]);

  const flashCapture = useCallback(() => {
    flashAnim.setValue(1);
    Animated.timing(flashAnim, { toValue: 0, duration: 400, useNativeDriver: true }).start();

    scaleAnim.setValue(0.95);
    Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, tension: 200, friction: 8 }).start();
  }, [flashAnim, scaleAnim]);

  const handleCapture = useCallback(async () => {
    if (!cameraRef.current || capturing || processing) return;
    setCapturing(true);
    setErrorMsg(null);

    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.85,
        skipProcessing: false,
      });

      if (!photo) throw new Error('Failed to capture photo');
      setCapturing(false);
      setProcessing(true);

      const result = await validateCapture(photo.uri);

      if (!result.isValid || !result.embedding) {
        setErrorMsg(result.errorMessage ?? 'Invalid photo. Please try again.');
        setProcessing(false);
        return;
      }

      // Save embedding
      await saveFaceEmbedding(studentId, result.embedding, captureIndex);
      flashCapture();

      const nextIndex = captureIndex + 1;
      const newCount = capturedCount + 1;
      setCapturedCount(newCount);

      if (nextIndex >= CAPTURE_ANGLES.length) {
        // All 5 captured
        await markStudentEnrolled(studentId);
        setDone(true);
      } else {
        setCaptureIndex(nextIndex);
      }
    } catch (e: any) {
      setErrorMsg(e.message ?? 'Capture failed. Please try again.');
    } finally {
      setCapturing(false);
      setProcessing(false);
    }
  }, [cameraRef, capturing, processing, captureIndex, capturedCount, studentId, flashCapture]);

  if (!permission) {
    return <View style={styles.container}><ActivityIndicator color={Colors.primary} /></View>;
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.permissionScreen}>
          <Text style={styles.permissionIcon}>📷</Text>
          <Text style={styles.permissionTitle}>Camera Permission Required</Text>
          <Text style={styles.permissionText}>
            Face enrollment requires camera access to capture your face.
          </Text>
          <TouchableOpacity style={styles.permissionButton} onPress={requestPermission}>
            <Text style={styles.permissionButtonText}>Allow Camera</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (done) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.successScreen}>
          <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
            <Text style={styles.successIcon}>✅</Text>
          </Animated.View>
          <Text style={styles.successTitle}>Enrollment Complete!</Text>
          <Text style={styles.successName}>{student?.name}</Text>
          <Text style={styles.successText}>
            5 face captures recorded successfully. This student can now be recognized during attendance scans.
          </Text>
          <TouchableOpacity
            id="btn-done-enrollment"
            style={styles.doneButton}
            onPress={() => router.back()}
          >
            <Text style={styles.doneButtonText}>Done</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const angle = CAPTURE_ANGLES[captureIndex];

  return (
    <View style={styles.container}>
      {/* Camera */}
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing="front"
      />

      {/* Flash overlay */}
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { backgroundColor: 'white', opacity: flashAnim }]}
      />

      {/* Face guide oval */}
      <View style={styles.faceGuideContainer} pointerEvents="none">
        <View style={styles.faceOval} />
      </View>

      {/* Top info bar */}
      <SafeAreaView style={styles.topBar}>
        <View style={styles.studentTag}>
          <Text style={styles.studentTagText}>{student?.name ?? '...'}</Text>
        </View>
        {/* Progress dots */}
        <View style={styles.progressDots}>
          {CAPTURE_ANGLES.map((_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                i < capturedCount && styles.dotDone,
                i === captureIndex && styles.dotActive,
              ]}
            />
          ))}
        </View>
        <Text style={styles.captureCount}>{capturedCount}/{CAPTURE_ANGLES.length}</Text>
      </SafeAreaView>

      {/* Bottom controls */}
      <View style={styles.bottomPanel}>
        {/* Angle instruction */}
        <View style={styles.angleCard}>
          <Text style={styles.angleIcon}>{angle.icon}</Text>
          <View>
            <Text style={styles.angleLabel}>
              Capture {captureIndex + 1} of {CAPTURE_ANGLES.length}: {angle.label}
            </Text>
            <Text style={styles.angleHint}>{angle.hint}</Text>
          </View>
        </View>

        {/* Error message */}
        {errorMsg ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>⚠️ {errorMsg}</Text>
          </View>
        ) : null}

        {/* Capture button */}
        <TouchableOpacity
          id={`btn-capture-${captureIndex}`}
          style={styles.captureButton}
          onPress={handleCapture}
          disabled={capturing || processing}
          activeOpacity={0.8}
        >
          {processing ? (
            <ActivityIndicator color={Colors.primary} size="large" />
          ) : (
            <View style={[styles.captureInner, capturing && styles.captureInnerPressed]} />
          )}
        </TouchableOpacity>

        <Text style={styles.tapHint}>
          {processing ? 'Processing...' : 'Tap to capture'}
        </Text>
      </View>
    </View>
  );
}

const OVAL_W = SCREEN_W * 0.62;
const OVAL_H = OVAL_W * 1.35;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },

  // Permission
  permissionScreen: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, backgroundColor: Colors.bg },
  permissionIcon: { fontSize: 64, marginBottom: Spacing.lg },
  permissionTitle: { ...Typography.heading2, color: Colors.textPrimary, marginBottom: Spacing.sm },
  permissionText: { ...Typography.body, color: Colors.textSecondary, textAlign: 'center', marginBottom: Spacing.xl },
  permissionButton: { backgroundColor: Colors.primary, borderRadius: Radius.lg, paddingVertical: Spacing.md, paddingHorizontal: Spacing.xl },
  permissionButtonText: { ...Typography.heading3, color: Colors.textOnPrimary },

  // Success
  successScreen: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, backgroundColor: Colors.bg },
  successIcon: { fontSize: 80, marginBottom: Spacing.lg },
  successTitle: { ...Typography.heading2, color: Colors.textPrimary, marginBottom: Spacing.xs },
  successName: { ...Typography.heading3, color: Colors.primary, marginBottom: Spacing.md },
  successText: { ...Typography.body, color: Colors.textSecondary, textAlign: 'center', marginBottom: Spacing.xl },
  doneButton: { backgroundColor: Colors.primary, borderRadius: Radius.lg, paddingVertical: Spacing.md, paddingHorizontal: Spacing.xxl },
  doneButtonText: { ...Typography.heading3, color: Colors.textOnPrimary },

  // Camera UI
  faceGuideContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  faceOval: {
    width: OVAL_W,
    height: OVAL_H,
    borderRadius: OVAL_W / 2,
    borderWidth: 3,
    borderColor: Colors.primary,
    marginTop: -SCREEN_H * 0.05,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 12,
  },

  // Top
  topBar: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    alignItems: 'center',
  },
  studentTag: {
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    marginBottom: Spacing.sm,
  },
  studentTagText: { ...Typography.label, color: Colors.textPrimary },
  progressDots: { flexDirection: 'row', gap: Spacing.xs },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  dotDone: { backgroundColor: Colors.accent },
  dotActive: { backgroundColor: Colors.primary, width: 20 },
  captureCount: { ...Typography.body, color: Colors.textPrimary, marginTop: Spacing.xs, fontWeight: '700' },

  // Bottom
  bottomPanel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(13,13,26,0.92)',
    padding: Spacing.lg,
    paddingBottom: 40,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    alignItems: 'center',
  },
  angleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.bgElevated,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    width: '100%',
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  angleIcon: { fontSize: 28 },
  angleLabel: { ...Typography.body, color: Colors.textPrimary, fontWeight: '600' },
  angleHint: { ...Typography.bodySmall, color: Colors.textSecondary, marginTop: 2 },
  errorBanner: {
    backgroundColor: Colors.dangerBg,
    borderRadius: Radius.md,
    padding: Spacing.sm,
    width: '100%',
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.danger + '40',
  },
  errorText: { ...Typography.bodySmall, color: Colors.danger, textAlign: 'center' },
  captureButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: Colors.textPrimary,
    marginBottom: Spacing.sm,
  },
  captureInner: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: Colors.textPrimary,
  },
  captureInnerPressed: { backgroundColor: Colors.textSecondary },
  tapHint: { ...Typography.caption, color: Colors.textSecondary },
});
