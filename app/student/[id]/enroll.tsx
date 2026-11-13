/**
 * Hands-free face setup. The camera captures automatically when the face is
 * sharp, close enough and in the requested pose — no shutter button. Five
 * varied captures (straight, both sides, chin tilt, natural) make the stored
 * templates robust to how students actually sit in class.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { useKeepAwake } from 'expo-keep-awake';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { getAllEmbeddingsForClass, getStudentById, getStudentsForClass, saveEnrollment } from '@/lib/database/db';
import type { Student } from '@/lib/database/schema';
import { analyzeEnrollmentCapture, initMLModels } from '@/lib/ml/FaceMLClient';
import { averageEmbeddings, buildEnrolledTemplates, cosineSimilarity } from '@/lib/ml/matcher';
import { deleteFiles, persistFaceImage } from '@/lib/files';
import { Colors, Radius, Spacing, Typography } from '@/constants/theme';
import { Avatar, Button, IconButton } from '@/components/kit';
import type { Landmark } from '@/modules/face-ml/index';

type Pose = { yaw: number; pitch: number };
type Capture = { embedding: number[]; quality?: number; thumbUri?: string; pose: Pose };

const STEPS = [
  { title: 'Look straight at the camera', icon: 'scan-outline' as const },
  { title: 'Turn head slightly to one side', icon: 'arrow-back-outline' as const },
  { title: 'Now slightly to the other side', icon: 'arrow-forward-outline' as const },
  { title: 'Tilt chin a little up or down', icon: 'swap-vertical-outline' as const },
  { title: 'Relax — natural expression', icon: 'happy-outline' as const },
];
const STEP_TIMEOUT_MS = 3500;
const SAME_PERSON_MIN = 0.32;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function poseOf(lm?: Landmark[]): Pose | null {
  if (!lm || lm.length < 3) return null;
  const [le, re, nose] = lm;
  const mx = (le.x + re.x) / 2;
  const my = (le.y + re.y) / 2;
  const d = Math.hypot(re.x - le.x, re.y - le.y);
  if (d < 1) return null;
  return { yaw: (nose.x - mx) / d, pitch: (nose.y - my) / d };
}

function poseOk(step: number, pose: Pose, caps: Capture[]): string | null {
  switch (step) {
    case 0: return Math.abs(pose.yaw) < 0.15 ? null : 'Face the camera directly';
    case 1: return Math.abs(pose.yaw) >= 0.12 ? null : 'Turn a little more';
    case 2: {
      const first = caps[1]?.pose.yaw ?? 0;
      return pose.yaw * Math.sign(first || 1) <= -0.12 ? null : 'Other side, please';
    }
    case 3: {
      const base = caps[0]?.pose.pitch ?? pose.pitch;
      return Math.abs(pose.pitch - base) >= 0.07 ? null : 'Tilt chin a bit more';
    }
    default: return null;
  }
}

const HINTS: Record<string, string> = {
  no_face: 'Looking for a face…',
  multiple: 'Only one person in frame, please',
  too_small: 'Move a little closer',
  blurry: 'Hold steady…',
};

export default function EnrollScreen() {
  useKeepAwake();
  const { id, queue } = useLocalSearchParams<{ id: string; queue?: string }>();
  const studentId = Number(id);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);

  const [student, setStudent] = useState<Student | null>(null);
  const [ready, setReady] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [facing, setFacing] = useState<'back' | 'front'>('back');
  const [step, setStep] = useState(0);
  const [hint, setHint] = useState('Getting ready…');
  const [good, setGood] = useState(false);
  const [done, setDone] = useState<{ photoUri?: string; lookalike?: string } | null>(null);
  const [next, setNext] = useState<{ id: number; name: string } | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);

  const caps = useRef<Capture[]>([]);
  const active = useRef(false);
  const forceRef = useRef(false);
  const flash = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    let cancelled = false;
    Promise.all([getStudentById(studentId), initMLModels()])
      .then(([s]) => { if (!cancelled) { setStudent(s); setReady(true); } })
      .catch(e => setHint(e?.message ?? 'Could not load face engine'));
    return () => { cancelled = true; active.current = false; };
  }, [studentId]);

  const accept = useCallback((c: Capture) => {
    caps.current.push(c);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    flash.setValue(0.85);
    Animated.timing(flash, { toValue: 0, duration: 380, useNativeDriver: true }).start();
    pulse.setValue(0.94);
    Animated.spring(pulse, { toValue: 1, useNativeDriver: true, speed: 14, bounciness: 12 }).start();
  }, [flash, pulse]);

  const complete = useCallback(async () => {
    const all = caps.current;
    const photoUri = await persistFaceImage(all[0]?.thumbUri, `student-${studentId}`);
    deleteFiles(all.map(c => c.thumbUri));
    await saveEnrollment(studentId, all.map(c => ({ embedding: c.embedding, quality: c.quality })), photoUri);

    // Lookalike / duplicate check against the rest of the class.
    let lookalike: string | undefined;
    let upcoming: { id: number; name: string } | null = null;
    try {
      const s = await getStudentById(studentId);
      const [others, classmates] = await Promise.all([getAllEmbeddingsForClass(s.classId), getStudentsForClass(s.classId)]);
      const mine = averageEmbeddings(all.map(c => c.embedding));
      const templates = buildEnrolledTemplates(others.filter(o => o.studentId !== studentId && o.source === 'enroll' && o.embedding.length === mine.length));
      let best = { id: -1, score: 0 };
      for (const t of templates) {
        const sc = cosineSimilarity(mine, t.centroid);
        if (sc > best.score) best = { id: t.studentId, score: sc };
      }
      if (best.score > 0.45) lookalike = classmates.find(c => c.id === best.id)?.name;
      if (queue) {
        const n = classmates.find(c => !c.isEnrolled && c.id !== studentId);
        if (n) upcoming = { id: n.id, name: n.name };
      }
    } catch {}
    setNext(upcoming);
    setDone({ photoUri, lookalike });
    if (upcoming && !lookalike) setCountdown(3);
  }, [queue, studentId]);

  const runLoop = useCallback(async () => {
    let stepStartedValidAt: number | null = null;
    let current = caps.current.length;
    while (active.current && current < STEPS.length) {
      const cam = cameraRef.current;
      if (!cam) break;
      try {
        const photo = await cam.takePictureAsync({ quality: 0.75, shutterSound: false });
        if (!photo?.uri || !active.current) break;
        const r = await analyzeEnrollmentCapture(photo.uri);
        if (r.reason !== 'ok' || !r.embedding) {
          setGood(false);
          setHint(HINTS[r.reason] ?? 'Adjusting…');
          if (r.thumbUri) deleteFiles([r.thumbUri]);
          continue;
        }
        const lmPose = poseOf(r.landmarks) ?? { yaw: 0, pitch: 0.5 };
        const pose = { yaw: r.yaw ?? lmPose.yaw, pitch: lmPose.pitch };
        if (caps.current.length) {
          const centroid = averageEmbeddings(caps.current.map(c => c.embedding));
          if (cosineSimilarity(r.embedding, centroid) < SAME_PERSON_MIN) {
            setGood(false);
            setHint(`Keep ${student?.name.split(' ')[0] ?? 'the same student'} in frame`);
            deleteFiles([r.thumbUri]);
            continue;
          }
        }
        stepStartedValidAt ??= Date.now();
        const problem = poseOk(current, pose, caps.current);
        const timedOut = Date.now() - stepStartedValidAt > STEP_TIMEOUT_MS;
        if (problem && !timedOut && !forceRef.current) {
          setGood(true);
          setHint(problem);
          deleteFiles([r.thumbUri]);
          continue;
        }
        forceRef.current = false;
        accept({ embedding: r.embedding, quality: r.quality, thumbUri: r.thumbUri, pose });
        current = caps.current.length;
        stepStartedValidAt = null;
        setStep(current);
        setHint(current < STEPS.length ? 'Got it' : 'Saving…');
        await sleep(450);
      } catch (e: any) {
        setHint(e?.message ?? 'Retrying…');
        await sleep(400);
      }
    }
    if (active.current && caps.current.length >= STEPS.length) {
      active.current = false;
      await complete();
    }
  }, [accept, complete, student]);

  useEffect(() => {
    const run = ready && cameraReady && !!permission?.granted && !done;
    if (run && !active.current) {
      active.current = true;
      runLoop();
    }
    if (!run) active.current = false;
  }, [ready, cameraReady, permission?.granted, done, runLoop]);

  // Auto-advance to the next student in the queue.
  useEffect(() => {
    if (countdown == null || !next) return;
    if (countdown === 0) {
      router.replace({ pathname: '/student/[id]/enroll', params: { id: String(next.id), queue: '1' } });
      return;
    }
    const t = setTimeout(() => setCountdown(c => (c == null ? c : c - 1)), 1000);
    return () => clearTimeout(t);
  }, [countdown, next, router]);

  if (!permission) return <View style={styles.black} />;
  if (!permission.granted) {
    return (
      <View style={[styles.black, styles.center]}>
        <Text style={styles.permTitle}>Camera access needed</Text>
        <Text style={styles.permBody}>Face setup takes 5 quick automatic captures. Everything stays on this phone.</Text>
        <Button title="Allow camera" variant="inverse" onPress={requestPermission} style={{ alignSelf: 'stretch' }} />
        <Button title="Not now" variant="ghost" onPress={() => router.back()} style={{ alignSelf: 'stretch' }} />
      </View>
    );
  }

  if (done) {
    return (
      <View style={[styles.white, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 20 }]}>
        <View style={styles.doneBody}>
          <View>
            <Avatar name={student?.name} uri={done.photoUri} size={132} seed={studentId} ring={Colors.accent} />
            <View style={styles.doneCheck}><Ionicons name="checkmark" size={22} color="#fff" /></View>
          </View>
          <Text style={styles.doneTitle}>{student?.name}</Text>
          <Text style={styles.doneSub}>Face setup complete. They’ll be recognised automatically in scans.</Text>
          {done.lookalike && (
            <View style={styles.warn}>
              <Ionicons name="alert-circle" size={18} color={Colors.warning} />
              <Text style={styles.warnText}>Looks very similar to {done.lookalike}. If it’s the same person, remove the duplicate; otherwise you’re fine.</Text>
            </View>
          )}
        </View>
        <View style={{ paddingHorizontal: Spacing.lg, gap: 6 }}>
          {next ? (
            <>
              <Button
                title={countdown != null && countdown > 0 ? `Next: ${next.name} (${countdown})` : `Next: ${next.name}`}
                iconRight="arrow-forward"
                onPress={() => router.replace({ pathname: '/student/[id]/enroll', params: { id: String(next.id), queue: '1' } })}
              />
              <Button title="Stop here" variant="ghost" size="md" onPress={() => { setCountdown(null); router.back(); }} />
            </>
          ) : (
            <Button title="Done" onPress={() => router.back()} />
          )}
        </View>
      </View>
    );
  }

  const ovalW = width * 0.66;
  const ovalH = ovalW * 1.3;
  const s = STEPS[Math.min(step, STEPS.length - 1)];

  return (
    <View style={styles.black}>
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing={facing}
        animateShutter={false}
        onCameraReady={() => setCameraReady(true)}
      />
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#fff', opacity: flash }]} />

      <View style={styles.ovalWrap} pointerEvents="none">
        <Animated.View
          style={{
            width: ovalW, height: ovalH, borderRadius: ovalW / 2, borderWidth: 4,
            borderColor: good ? Colors.accent : 'rgba(255,255,255,0.85)',
            transform: [{ scale: pulse }],
          }}
        />
      </View>

      <View style={[styles.top, { paddingTop: insets.top + 8 }]}>
        <IconButton icon="close" variant="glass" accessibilityLabel="Close" onPress={() => router.back()} />
        <View style={styles.namePill}><Text style={styles.nameText} numberOfLines={1}>{student?.name ?? ''}</Text></View>
        <IconButton icon="camera-reverse-outline" variant="glass" accessibilityLabel="Flip camera" onPress={() => setFacing(f => (f === 'back' ? 'front' : 'back'))} />
      </View>

      <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.segments}>
          {STEPS.map((_, i) => (
            <View key={i} style={[styles.segment, i < step && { backgroundColor: Colors.accent }, i === step && { backgroundColor: '#000' }]} />
          ))}
        </View>
        <View style={styles.stepRow}>
          <View style={styles.stepIcon}><Ionicons name={s.icon} size={22} color="#000" /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.stepCount}>Step {Math.min(step + 1, STEPS.length)} of {STEPS.length}</Text>
            <Text style={styles.stepTitle}>{s.title}</Text>
          </View>
        </View>
        <View style={styles.hintRow}>
          {!ready || !cameraReady ? <ActivityIndicator size="small" color={Colors.textSecondary} /> : <Ionicons name={good ? 'checkmark-circle' : 'ellipse-outline'} size={16} color={good ? Colors.success : Colors.textMuted} />}
          <Text style={styles.hintText}>{hint}</Text>
          <Text style={styles.capture} onPress={() => { forceRef.current = true; Haptics.selectionAsync().catch(() => {}); }}>Capture now</Text>
        </View>
        <Text style={styles.auto}>Captures automatically — just hold the phone towards the student.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  black: { flex: 1, backgroundColor: '#000' },
  white: { flex: 1, backgroundColor: '#fff', justifyContent: 'space-between' },
  center: { alignItems: 'center', justifyContent: 'center', padding: Spacing.lg },
  permTitle: { ...Typography.heading1, color: '#fff', textAlign: 'center' },
  permBody: { ...Typography.body, color: 'rgba(255,255,255,0.7)', textAlign: 'center', marginTop: 8, marginBottom: Spacing.xl },
  ovalWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', paddingBottom: 170 },
  top: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: Spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  namePill: { backgroundColor: Colors.glass, borderRadius: Radius.full, paddingHorizontal: 14, height: 36, justifyContent: 'center', maxWidth: '55%' },
  nameText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: '#fff', borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: Spacing.lg, paddingTop: 18 },
  segments: { flexDirection: 'row', gap: 6, marginBottom: 16 },
  segment: { flex: 1, height: 5, borderRadius: 3, backgroundColor: Colors.bgSubtle },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: Colors.bgSubtle, alignItems: 'center', justifyContent: 'center' },
  stepCount: { ...Typography.caption, color: Colors.textSecondary },
  stepTitle: { ...Typography.heading3, color: '#000', marginTop: 1 },
  hintRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16, backgroundColor: Colors.bgElevated, borderRadius: Radius.md, paddingHorizontal: 12, height: 44 },
  hintText: { ...Typography.bodySmall, color: Colors.textPrimary, fontWeight: '600', flex: 1 },
  capture: { fontSize: 13, fontWeight: '700', color: Colors.textPrimary, textDecorationLine: 'underline' },
  auto: { ...Typography.caption, color: Colors.textMuted, marginTop: 10, textAlign: 'center' },
  doneBody: { alignItems: 'center', paddingHorizontal: Spacing.lg },
  doneCheck: { position: 'absolute', right: 4, bottom: 4, width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.accent, borderWidth: 3, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  doneTitle: { ...Typography.heading1, color: '#000', marginTop: Spacing.lg, textAlign: 'center' },
  doneSub: { ...Typography.body, color: Colors.textSecondary, textAlign: 'center', marginTop: 6 },
  warn: { flexDirection: 'row', gap: 8, backgroundColor: Colors.warningBg, borderRadius: Radius.md, padding: 12, marginTop: Spacing.lg },
  warnText: { ...Typography.bodySmall, color: Colors.textPrimary, flex: 1 },
});
