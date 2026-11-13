/**
 * Hands-free attendance.
 *
 * LIVE (default): sweep the camera across the room. Frames are captured and
 * analysed back-to-back (the next capture overlaps the current analysis);
 * students are marked the moment the engine is sure — no buttons.
 *
 * PHOTOS: one or more high-resolution group shots and/or gallery images,
 * analysed with tiled detection + flip-fused embeddings and merged into the
 * same session as anything already seen live.
 *
 * A status bar is always visible: recognised · to check · left · in view.
 * Tap it for the roster to see who's missing and mark anyone by hand.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  FlatList,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions, type CameraCapturedPicture } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { useKeepAwake } from 'expo-keep-awake';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  createAttendanceSession,
  getAllEmbeddingsForClass,
  getClassById,
  getStudentsForClass,
  localDateKey,
  saveAttendanceRecords,
  type StudentWithEmbeddings,
} from '@/lib/database/db';
import type { AttendanceStatus } from '@/lib/database/schema';
import { analyzeGroupPhotoRaw, analyzeLiveFrame, buildGallery, initMLModels } from '@/lib/ml/FaceMLClient';
import { LiveAttendanceEngine, type FaceMarker } from '@/lib/ml/liveSession';
import { deleteFiles, persistFaceImage } from '@/lib/files';
import { Colors, Radius, Spacing, Typography } from '@/constants/theme';
import { Avatar, Button, IconButton, ProgressBar, Segmented, Sheet } from '@/components/kit';

type Mode = 'live' | 'photo';
type Phase = 'loading' | 'ready' | 'saving' | 'error';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const LIVE_CAPTURE = { quality: 0.7, shutterSound: false } as const;

function pickPictureSize(sizes: string[], target: number): string | undefined {
  const parsed = sizes
    .map(s => { const [w, h] = s.split('x').map(Number); return { s, long: Math.max(w, h), short: Math.min(w, h) }; })
    .filter(p => p.long > 0 && p.short > 0);
  const fourThree = parsed.filter(p => Math.abs(p.long / p.short - 4 / 3) < 0.04);
  const pool = fourThree.length ? fourThree : parsed;
  if (!pool.length) return undefined;
  if (!Number.isFinite(target)) return [...pool].sort((a, b) => b.long - a.long)[0].s;
  const above = pool.filter(p => p.long >= target).sort((a, b) => a.long - b.long);
  return (above[0] ?? [...pool].sort((a, b) => b.long - a.long)[0]).s;
}

export default function ScanScreen() {
  useKeepAwake();
  const { classId: classIdParam } = useLocalSearchParams<{ classId: string }>();
  const classId = Number(classIdParam);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: VW, height: VH } = useWindowDimensions();
  const [permission, requestPermission] = useCameraPermissions();

  const cameraRef = useRef<CameraView>(null);
  const engineRef = useRef<LiveAttendanceEngine | null>(null);
  const activeRef = useRef(false);
  const loopPromise = useRef<Promise<void> | null>(null);
  const thumbsSeen = useRef(new Set<string>());
  const finishedRef = useRef(false);
  const errorStreak = useRef(0);
  const photoUris = useRef<string[]>([]);

  const [phase, setPhase] = useState<Phase>('loading');
  const [errorText, setErrorText] = useState('');
  const [mode, setMode] = useState<Mode>('live');
  const [paused, setPaused] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [sizes, setSizes] = useState<string[]>([]);
  const [facing, setFacing] = useState<'back' | 'front'>('back');
  const [torch, setTorch] = useState(false);
  const [className, setClassName] = useState('');
  const [students, setStudents] = useState<StudentWithEmbeddings[]>([]);
  const [version, setVersion] = useState(0); // bump to re-read engine state
  const [frame, setFrame] = useState<{ id: number; markers: FaceMarker[]; W: number; H: number } | null>(null);
  const [facesInView, setFacesInView] = useState(0);
  const [lastSeenFaceAt, setLastSeenFaceAt] = useState(Date.now());
  const [latency, setLatency] = useState(0);
  const [toast, setToast] = useState<{ key: number; id: number } | null>(null);
  const [photoJob, setPhotoJob] = useState<{ index: number; total: number } | null>(null);
  const [photosDone, setPhotosDone] = useState(0);
  const [unknownCount, setUnknownCount] = useState(0);
  const [rosterOpen, setRosterOpen] = useState(false);

  const byId = useMemo(() => new Map(students.map(s => [s.id, s])), [students]);
  const bump = useCallback(() => setVersion(v => v + 1), []);

  // Derived counts (re-evaluated whenever the engine changes → `version`).
  const engine = engineRef.current;
  const presentIds = useMemo(() => engine?.presentIds ?? [], [engine, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const reviewIds = useMemo(() => engine?.reviewIds ?? [], [engine, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = students.length;
  const left = Math.max(0, total - presentIds.length);

  // ── Setup ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [cls, studs, raw] = await Promise.all([
          getClassById(classId), getStudentsForClass(classId), getAllEmbeddingsForClass(classId), initMLModels(),
        ]);
        if (cancelled) return;
        engineRef.current = new LiveAttendanceEngine(buildGallery(raw), new Map(studs.map(s => [s.id, s.name])));
        setClassName(cls.name);
        setStudents(studs);
        setPhase('ready');
      } catch (e: any) {
        if (cancelled) return;
        setErrorText(e?.message ?? 'Could not prepare face recognition.');
        setPhase('error');
      }
    })();
    return () => { cancelled = true; };
  }, [classId]);

  useEffect(() => () => {
    activeRef.current = false;
    if (!finishedRef.current) deleteFiles(thumbsSeen.current);
  }, []);

  const onCameraReady = useCallback(async () => {
    setCameraReady(true);
    try {
      const available = await cameraRef.current?.getAvailablePictureSizesAsync();
      if (available?.length) setSizes(available);
    } catch {}
  }, []);

  const pictureSize = useMemo(
    () => (sizes.length ? pickPictureSize(sizes, mode === 'live' ? 1440 : Infinity) : undefined),
    [sizes, mode]
  );

  const celebrate = useCallback((ids: number[]) => {
    if (!ids.length) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setToast({ key: Date.now(), id: ids[ids.length - 1] });
  }, []);

  // ── Live loop (capture N+1 overlaps analysis of N) ───────────────────────────
  const runLoop = useCallback(async () => {
    const cam = cameraRef.current;
    const eng = engineRef.current;
    if (!cam || !eng) return;
    let frameNo = 0;
    let pending: Promise<CameraCapturedPicture | undefined> | null = cam.takePictureAsync(LIVE_CAPTURE).catch(() => undefined);
    while (activeRef.current) {
      const t0 = Date.now();
      const photo = await pending;
      pending = activeRef.current && cameraRef.current
        ? cameraRef.current.takePictureAsync(LIVE_CAPTURE).catch(() => undefined)
        : null;
      if (!photo?.uri) {
        errorStreak.current++;
        await sleep(Math.min(1200, 150 * errorStreak.current));
        if (!pending && activeRef.current && cameraRef.current) pending = cameraRef.current.takePictureAsync(LIVE_CAPTURE).catch(() => undefined);
        continue;
      }
      if (!activeRef.current) { deleteFiles([photo.uri]); break; }
      try {
        const res = await analyzeLiveFrame(photo.uri, eng.nextSkipBoxes());
        res.faces.forEach(f => f.thumbUri && thumbsSeen.current.add(f.thumbUri));
        const out = eng.ingest(res);
        errorStreak.current = 0;
        frameNo++;
        setFrame({ id: frameNo, markers: out.markers, W: res.imageWidth, H: res.imageHeight });
        setFacesInView(out.faceCount);
        if (out.faceCount > 0) setLastSeenFaceAt(Date.now());
        setLatency(Date.now() - t0);
        celebrate(out.newlyPresent);
        bump();
      } catch (e) {
        errorStreak.current++;
        if (__DEV__) console.warn('[LiveScan] frame failed', e);
        await sleep(Math.min(1500, 200 * errorStreak.current));
      }
    }
    const leftover = await pending;
    if (leftover?.uri) deleteFiles([leftover.uri]);
  }, [bump, celebrate]);

  const stopLoop = useCallback(async () => {
    activeRef.current = false;
    await loopPromise.current;
    loopPromise.current = null;
  }, []);

  const shouldRun = phase === 'ready' && mode === 'live' && !paused && cameraReady && !!permission?.granted && !rosterOpen;
  useEffect(() => {
    if (shouldRun && !activeRef.current) {
      activeRef.current = true;
      loopPromise.current = runLoop();
    } else if (!shouldRun && activeRef.current) {
      stopLoop();
    }
  }, [shouldRun, runLoop, stopLoop]);

  // ── Manual marks ───────────────────────────────────────────────────────────
  const markPresent = (id: number) => {
    engineRef.current?.forcePresent(id);
    Haptics.selectionAsync().catch(() => {});
    bump();
  };
  const unmark = (id: number) => {
    engineRef.current?.unmark(id);
    Haptics.selectionAsync().catch(() => {});
    bump();
  };

  // ── Finish / save ──────────────────────────────────────────────────────────
  const finish = useCallback(async () => {
    if (finishedRef.current) return;
    const eng = engineRef.current;
    if (!eng) return;
    finishedRef.current = true;
    await stopLoop();
    setPhase('saving');
    try {
      type Row = {
        studentId?: number; status: AttendanceStatus; confidence?: number; faceBox?: object;
        faceImageUri?: string; embedding?: number[]; quality?: number; manual?: boolean;
      };
      const rows: Row[] = [];
      const keep = new Set<string>();
      for (const s of students) {
        const ev = eng.evidence.get(s.id);
        if (!ev || (ev.status === 'pending' && ev.confidentHits === 0)) {
          rows.push({ studentId: s.id, status: 'absent' });
          continue;
        }
        const status: AttendanceStatus = ev.status === 'present' ? 'present' : 'uncertain';
        const faceImageUri = await persistFaceImage(ev.bestThumbUri, `s${s.id}`);
        if (faceImageUri) keep.add(faceImageUri);
        rows.push({
          studentId: s.id, status, confidence: ev.bestScore || undefined, faceBox: ev.bestBox,
          faceImageUri, embedding: ev.bestEmbedding, quality: ev.bestQuality, manual: ev.manual,
        });
      }
      for (const u of eng.unknowns) {
        const faceImageUri = await persistFaceImage(u.thumbUri, 'unknown');
        rows.push({ status: 'unknown', faceBox: u.box, faceImageUri, embedding: u.embedding, quality: u.quality });
      }
      const session = await createAttendanceSession(classId, localDateKey(), photoUris.current[0]);
      await saveAttendanceRecords(session.id, rows);
      deleteFiles([...thumbsSeen.current].filter(u => !keep.has(u)));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      router.replace(`/attendance/review/${session.id}`);
    } catch (e: any) {
      finishedRef.current = false;
      setPhase('ready');
      Alert.alert('Could not save attendance', e?.message ?? 'Please try again.');
    }
  }, [classId, router, stopLoop, students]);

  const onFinishPress = () => {
    if (presentIds.length === 0 && reviewIds.length === 0) {
      Alert.alert('No one marked yet', 'Save everyone as absent, or keep scanning?', [
        { text: 'Keep scanning', style: 'cancel' },
        { text: 'Save anyway', onPress: () => finish() },
      ]);
      return;
    }
    finish();
  };

  const everyoneHere = total > 0 && presentIds.length >= total;
  useEffect(() => {
    if (!everyoneHere || finishedRef.current || rosterOpen) return;
    const t = setTimeout(() => finish(), 1400);
    return () => clearTimeout(t);
  }, [everyoneHere, finish, rosterOpen]);

  // ── Photos ─────────────────────────────────────────────────────────────────
  const processPhotos = async (uris: string[]) => {
    const eng = engineRef.current;
    if (!eng || !uris.length) return;
    for (let i = 0; i < uris.length; i++) {
      setPhotoJob({ index: i + 1, total: uris.length });
      try {
        const res = await analyzeGroupPhotoRaw(uris[i]);
        res.faces.forEach(f => f.thumbUri && thumbsSeen.current.add(f.thumbUri));
        const out = eng.ingestPhoto(res);
        photoUris.current.push(uris[i]);
        setPhotosDone(n => n + 1);
        setUnknownCount(eng.unknowns.length);
        celebrate(out.newlyPresent);
        bump();
      } catch (e: any) {
        Alert.alert(`Couldn't read photo ${i + 1}`, e?.message ?? 'Please try another photo.');
      }
    }
    setPhotoJob(null);
  };

  const capturePhoto = async () => {
    if (!cameraRef.current || phase !== 'ready' || photoJob) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.95 });
      if (photo?.uri) processPhotos([photo.uri]);
    } catch (e: any) {
      Alert.alert('Capture failed', e?.message ?? 'Please try again.');
    }
  };

  const pickFromGallery = async () => {
    if (photoJob) return;
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1, allowsMultipleSelection: true, selectionLimit: 10 });
    if (!r.canceled && r.assets.length) processPhotos(r.assets.map(a => a.uri));
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  if (!permission) return <View style={styles.black} />;
  if (!permission.granted) {
    return (
      <View style={[styles.black, styles.centerPad]}>
        <View style={styles.permIcon}><Ionicons name="camera" size={30} color="#000" /></View>
        <Text style={styles.permTitle}>Camera access needed</Text>
        <Text style={styles.permBody}>FaceScan recognises students on-device. Nothing leaves your phone.</Text>
        <Button title="Allow camera" variant="inverse" onPress={requestPermission} style={{ alignSelf: 'stretch' }} />
        <Button title="Not now" variant="ghost" onPress={() => router.back()} style={{ alignSelf: 'stretch' }} />
      </View>
    );
  }

  const recent = presentIds.slice(0, 14);
  const searching = mode === 'live' && phase === 'ready' && !paused && Date.now() - lastSeenFaceAt > 2500;
  const scanning = mode === 'live' && !paused && phase === 'ready' && cameraReady && !rosterOpen;

  return (
    <View style={styles.black}>
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing={facing}
        enableTorch={torch}
        animateShutter={mode === 'photo'}
        pictureSize={pictureSize}
        onCameraReady={onCameraReady}
        onMountError={e => { setErrorText(e.message); setPhase('error'); }}
      />

      {frame && mode === 'live' && (
        <MarkerLayer key={frame.id} markers={frame.markers} W={frame.W} H={frame.H} VW={VW} VH={VH} mirror={facing === 'front'} />
      )}

      {/* Top bar */}
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <IconButton icon="close" variant="glass" accessibilityLabel="Close" onPress={() => router.back()} />
        <View style={styles.classPill}><Text style={styles.classPillText} numberOfLines={1}>{className || 'Attendance'}</Text></View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <IconButton icon={torch ? 'flash' : 'flash-off'} variant="glass" accessibilityLabel="Toggle torch" onPress={() => setTorch(t => !t)} />
          <IconButton icon="camera-reverse-outline" variant="glass" accessibilityLabel="Flip camera" onPress={() => setFacing(f => (f === 'back' ? 'front' : 'back'))} />
        </View>
      </View>

      {/* Always-on status bar */}
      <Pressable style={[styles.hud, { top: insets.top + 62 }]} onPress={() => setRosterOpen(true)} accessibilityRole="button" accessibilityLabel="Open class roster">
        <HudStat icon="checkmark-circle" color={Colors.accent} value={presentIds.length} label="recognised" />
        <View style={styles.hudDivider} />
        <HudStat icon="help-circle" color={Colors.uncertain} value={reviewIds.length} label="to check" />
        <View style={styles.hudDivider} />
        <HudStat icon="person-outline" color="#fff" value={left} label="left" />
        {mode === 'live' ? (
          <>
            <View style={styles.hudDivider} />
            <HudStat icon="scan-outline" color="#fff" value={facesInView} label="in view" />
          </>
        ) : unknownCount > 0 ? (
          <>
            <View style={styles.hudDivider} />
            <HudStat icon="person-add-outline" color="#fff" value={unknownCount} label="unknown" />
          </>
        ) : null}
        <Ionicons name="chevron-down" size={16} color="rgba(255,255,255,0.7)" style={{ marginLeft: 4 }} />
      </Pressable>

      <View style={[styles.modeSwitch, { top: insets.top + 124 }]}>
        <Segmented<Mode> dark value={mode} onChange={setMode} options={[{ value: 'live', label: 'Live scan' }, { value: 'photo', label: 'Photos' }]} />
      </View>

      {toast && <PresentToast key={toast.key} student={byId.get(toast.id)} top={insets.top + 176} />}

      {searching && (
        <View style={styles.hintPill} pointerEvents="none">
          <Ionicons name="scan-outline" size={16} color="#fff" />
          <Text style={styles.hintText}>Point at students and sweep slowly</Text>
        </View>
      )}

      {/* Bottom sheet */}
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.statusRow}>
          <StatusDot active={scanning || !!photoJob} />
          <Text style={styles.statusText} numberOfLines={1}>
            {phase === 'loading' ? 'Getting ready…'
              : mode === 'photo'
                ? photoJob ? `Analysing photo ${photoJob.index} of ${photoJob.total}…` : photosDone ? `${photosDone} photo${photosDone > 1 ? 's' : ''} analysed — add more or finish` : 'Take or choose group photos'
                : paused ? 'Paused' : everyoneHere ? 'Everyone’s here!' : 'Scanning — keep moving slowly'}
            {mode === 'live' && latency > 0 && !paused ? <Text style={styles.statusMuted}>  ·  {(latency / 1000).toFixed(1)}s/frame</Text> : null}
          </Text>
          {mode === 'live' && (
            <Pressable onPress={() => setPaused(p => !p)} hitSlop={10} style={styles.pauseBtn}>
              <Ionicons name={paused ? 'play' : 'pause'} size={16} color="#000" />
              <Text style={styles.pauseText}>{paused ? 'Resume' : 'Pause'}</Text>
            </Pressable>
          )}
        </View>

        <View style={styles.countRow}>
          <Text style={styles.count}>{presentIds.length}</Text>
          <Text style={styles.countOf}> / {total} present</Text>
        </View>
        <ProgressBar value={total ? presentIds.length / total : 0} height={8} />

        {recent.length > 0 ? (
          <FlatList
            horizontal
            data={recent}
            keyExtractor={id => String(id)}
            showsHorizontalScrollIndicator={false}
            style={{ marginTop: 14, flexGrow: 0 }}
            contentContainerStyle={{ gap: 12 }}
            renderItem={({ item }) => {
              const s = byId.get(item);
              const ev = engineRef.current?.evidence.get(item);
              return (
                <View style={styles.recentItem}>
                  <Avatar name={s?.name} uri={ev?.bestThumbUri ?? s?.photoUri} seed={item} size={48} ring={ev?.manual ? Colors.textMuted : Colors.accent} />
                  <Text style={styles.recentName} numberOfLines={1}>{s?.name.split(' ')[0]}</Text>
                </View>
              );
            }}
          />
        ) : (
          <Text style={styles.emptyHint}>
            {mode === 'live' ? 'No buttons needed — students are marked as soon as they’re recognised.' : 'Tip: take 2–3 photos from different sides for big classes.'}
          </Text>
        )}

        {mode === 'photo' && (
          <View style={styles.shutterRow}>
            <IconButton icon="images-outline" accessibilityLabel="Choose photos from gallery" onPress={pickFromGallery} size={52} />
            <Pressable onPress={capturePhoto} disabled={phase !== 'ready' || !cameraReady || !!photoJob} style={({ pressed }) => [styles.shutter, pressed && { transform: [{ scale: 0.94 }] }]}>
              {photoJob ? <ActivityIndicator color="#000" /> : <View style={styles.shutterInner} />}
            </Pressable>
            <View style={{ width: 52 }} />
          </View>
        )}

        <Button
          title={phase === 'saving' ? 'Saving…' : `Done · Review${reviewIds.length ? ` (${reviewIds.length} to check)` : ''}`}
          iconRight="arrow-forward"
          onPress={onFinishPress}
          loading={phase === 'saving'}
          disabled={phase !== 'ready' || !!photoJob}
          style={{ marginTop: 14 }}
        />
      </View>

      <RosterSheet
        visible={rosterOpen}
        onClose={() => setRosterOpen(false)}
        students={students}
        engine={engineRef.current}
        version={version}
        onMark={markPresent}
        onUnmark={unmark}
      />

      {(phase === 'loading' || phase === 'saving' || phase === 'error') && (
        <View style={styles.overlay}>
          <View style={styles.overlayCard}>
            {phase === 'error' ? (
              <>
                <Ionicons name="warning-outline" size={30} color={Colors.danger} />
                <Text style={styles.overlayTitle}>Can’t start scanning</Text>
                <Text style={styles.overlayBody}>{errorText}</Text>
                <Button title="Go back" onPress={() => router.back()} style={{ alignSelf: 'stretch', marginTop: 16 }} />
              </>
            ) : (
              <>
                <ActivityIndicator color="#000" size="large" />
                <Text style={styles.overlayTitle}>{phase === 'loading' ? 'Warming up face engine' : 'Saving attendance'}</Text>
                <Text style={styles.overlayBody}>Everything runs on this phone.</Text>
              </>
            )}
          </View>
        </View>
      )}
    </View>
  );
}

// ─── Pieces ──────────────────────────────────────────────────────────────────

function HudStat({ icon, color, value, label }: { icon: React.ComponentProps<typeof Ionicons>['name']; color: string; value: number; label: string }) {
  return (
    <View style={styles.hudStat}>
      <Ionicons name={icon} size={15} color={color} />
      <Text style={styles.hudValue}>{value}</Text>
      <Text style={styles.hudLabel}>{label}</Text>
    </View>
  );
}

function RosterSheet({
  visible, onClose, students, engine, version, onMark, onUnmark,
}: {
  visible: boolean;
  onClose: () => void;
  students: StudentWithEmbeddings[];
  engine: LiveAttendanceEngine | null;
  version: number;
  onMark: (id: number) => void;
  onUnmark: (id: number) => void;
}) {
  const sections = useMemo(() => {
    const check: StudentWithEmbeddings[] = [];
    const notSeen: StudentWithEmbeddings[] = [];
    const noFace: StudentWithEmbeddings[] = [];
    const present: StudentWithEmbeddings[] = [];
    for (const s of students) {
      const st = engine?.evidence.get(s.id)?.status;
      if (st === 'present') present.push(s);
      else if (st === 'review') check.push(s);
      else if (!s.isEnrolled) noFace.push(s);
      else notSeen.push(s);
    }
    return [
      { key: 'check', title: `To check · ${check.length}`, data: check },
      { key: 'notSeen', title: `Not seen yet · ${notSeen.length}`, data: notSeen },
      { key: 'noFace', title: `No face setup · ${noFace.length}`, data: noFace },
      { key: 'present', title: `Present · ${present.length}`, data: present },
    ].filter(s => s.data.length);
  }, [students, engine, version]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Sheet visible={visible} onClose={onClose} title="Class roster">
      <SectionList
        sections={sections}
        keyExtractor={s => String(s.id)}
        style={{ maxHeight: 460 }}
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) => <Text style={styles.rosterHeader}>{section.title}</Text>}
        renderItem={({ item, section }) => {
          const ev = engine?.evidence.get(item.id);
          const isPresent = section.key === 'present';
          return (
            <View style={styles.rosterRow}>
              <Avatar name={item.name} uri={ev?.bestThumbUri ?? item.photoUri} seed={item.id} size={40} ring={isPresent ? Colors.accent : section.key === 'check' ? Colors.uncertain : undefined} />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.rosterName} numberOfLines={1}>{item.name}</Text>
                <Text style={styles.rosterSub}>
                  Roll {item.rollNumber}{isPresent ? (ev?.manual ? ' · marked by you' : ' · recognised') : section.key === 'noFace' ? ' · can’t be scanned' : ''}
                </Text>
              </View>
              {isPresent ? (
                <Button size="sm" variant="secondary" title="Undo" onPress={() => onUnmark(item.id)} />
              ) : (
                <Button size="sm" title={section.key === 'check' ? 'Confirm' : 'Present'} icon="checkmark" onPress={() => onMark(item.id)} />
              )}
            </View>
          );
        }}
      />
      <Button title="Back to scanning" variant="secondary" onPress={onClose} style={{ marginTop: 12 }} />
    </Sheet>
  );
}

function StatusDot({ active }: { active: boolean }) {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!active) return;
    const loop = Animated.loop(Animated.timing(pulse, { toValue: 1, duration: 1200, easing: Easing.out(Easing.quad), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [active, pulse]);
  const color = active ? Colors.accent : Colors.textMuted;
  return (
    <View style={{ width: 14, height: 14, alignItems: 'center', justifyContent: 'center', marginRight: 8 }}>
      {active && (
        <Animated.View
          style={{
            position: 'absolute', width: 14, height: 14, borderRadius: 7, backgroundColor: color,
            opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }),
            transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 2.2] }) }],
          }}
        />
      )}
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
    </View>
  );
}

function MarkerLayer({ markers, W, H, VW, VH, mirror }: { markers: FaceMarker[]; W: number; H: number; VW: number; VH: number; mirror: boolean }) {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.timing(opacity, { toValue: 0, duration: 900, delay: 700, useNativeDriver: true }).start();
  }, [opacity]);
  if (!W || !H) return null;
  const s = Math.max(VW / W, VH / H);
  const offX = (W * s - VW) / 2;
  const offY = (H * s - VH) / 2;
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity }]}>
      {markers.map(m => {
        const w = m.box.w * W * s;
        const h = m.box.h * H * s;
        let left = m.box.x * W * s - offX;
        const top = m.box.y * H * s - offY;
        if (mirror) left = VW - left - w;
        const color = m.kind === 'present' ? Colors.accent : m.kind === 'matching' ? Colors.uncertain : 'rgba(255,255,255,0.7)';
        const dashed = m.kind === 'far' || m.kind === 'blurry' || m.kind === 'turned';
        return (
          <View key={m.id} style={{ position: 'absolute', left, top, width: w, height: h }}>
            <View style={[styles.marker, { borderColor: color, borderStyle: dashed ? 'dashed' : 'solid' }]} />
            {m.label ? (
              <View style={[styles.markerLabel, { backgroundColor: color }]}>
                <Ionicons name="checkmark" size={12} color="#000" />
                <Text style={styles.markerLabelText} numberOfLines={1}>{m.label}</Text>
              </View>
            ) : m.kind === 'turned' || m.kind === 'far' ? (
              <View style={[styles.markerLabel, { backgroundColor: 'rgba(0,0,0,0.6)' }]}>
                <Text style={[styles.markerLabelText, { color: '#fff' }]}>{m.kind === 'turned' ? 'Face camera' : 'Move closer'}</Text>
              </View>
            ) : null}
          </View>
        );
      })}
    </Animated.View>
  );
}

function PresentToast({ student, top }: { student?: StudentWithEmbeddings; top: number }) {
  const y = useRef(new Animated.Value(-20)).current;
  const o = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.spring(y, { toValue: 0, useNativeDriver: true, speed: 20, bounciness: 8 }),
      Animated.timing(o, { toValue: 1, duration: 160, useNativeDriver: true }),
    ]).start();
    const t = setTimeout(() => Animated.timing(o, { toValue: 0, duration: 260, useNativeDriver: true }).start(), 1800);
    return () => clearTimeout(t);
  }, [o, y]);
  if (!student) return null;
  return (
    <Animated.View pointerEvents="none" style={[styles.toast, { top, opacity: o, transform: [{ translateY: y }] }]}>
      <Avatar name={student.name} uri={student.photoUri} seed={student.id} size={34} />
      <View style={{ marginLeft: 10, flexShrink: 1 }}>
        <Text style={styles.toastName} numberOfLines={1}>{student.name}</Text>
        <Text style={styles.toastSub}>Marked present · Roll {student.rollNumber}</Text>
      </View>
      <View style={styles.toastCheck}><Ionicons name="checkmark" size={16} color="#000" /></View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  black: { flex: 1, backgroundColor: '#000' },
  centerPad: { alignItems: 'center', justifyContent: 'center', padding: Spacing.lg },
  permIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.lg },
  permTitle: { ...Typography.heading1, color: '#fff', textAlign: 'center' },
  permBody: { ...Typography.body, color: 'rgba(255,255,255,0.7)', textAlign: 'center', marginTop: 8, marginBottom: Spacing.xl },

  topBar: { position: 'absolute', left: 0, right: 0, top: 0, paddingHorizontal: Spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  classPill: { backgroundColor: Colors.glass, borderRadius: Radius.full, paddingHorizontal: 14, height: 36, justifyContent: 'center', maxWidth: '40%' },
  classPillText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  hud: { position: 'absolute', alignSelf: 'center', flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.72)', borderRadius: Radius.full, paddingHorizontal: 14, height: 48 },
  hudStat: { alignItems: 'center', flexDirection: 'row', gap: 4 },
  hudValue: { color: '#fff', fontWeight: '800', fontSize: 16 },
  hudLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: '600' },
  hudDivider: { width: StyleSheet.hairlineWidth, height: 20, backgroundColor: 'rgba(255,255,255,0.3)', marginHorizontal: 10 },
  modeSwitch: { position: 'absolute', alignSelf: 'center', width: 240 },

  hintPill: { position: 'absolute', alignSelf: 'center', top: '42%', flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.glass, paddingHorizontal: 16, paddingVertical: 10, borderRadius: Radius.full },
  hintText: { color: '#fff', fontWeight: '600', fontSize: 14 },

  marker: { ...StyleSheet.absoluteFillObject, borderWidth: 2.5, borderRadius: 14 },
  markerLabel: { position: 'absolute', bottom: '100%', marginBottom: 6, left: 0, flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingVertical: 3, borderRadius: Radius.full, maxWidth: 160 },
  markerLabelText: { color: '#000', fontWeight: '800', fontSize: 12 },

  toast: { position: 'absolute', left: Spacing.md, right: Spacing.md, flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: Radius.lg, padding: 10, paddingRight: 14, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 10 },
  toastName: { ...Typography.bodyStrong, color: '#000' },
  toastSub: { ...Typography.caption, color: Colors.textSecondary },
  toastCheck: { marginLeft: 'auto', width: 28, height: 28, borderRadius: 14, backgroundColor: Colors.accent, alignItems: 'center', justifyContent: 'center' },

  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: '#fff', borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: Spacing.lg, paddingTop: 18 },
  statusRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  statusText: { ...Typography.bodySmall, color: Colors.textPrimary, fontWeight: '600', flex: 1 },
  statusMuted: { color: Colors.textMuted, fontWeight: '500' },
  pauseBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.bgSubtle, borderRadius: Radius.full, paddingHorizontal: 12, height: 32 },
  pauseText: { fontSize: 13, fontWeight: '700', color: '#000' },
  countRow: { flexDirection: 'row', alignItems: 'baseline', marginBottom: 10 },
  count: { fontSize: 44, fontWeight: '800', color: '#000', letterSpacing: -1.5 },
  countOf: { ...Typography.heading3, color: Colors.textSecondary },
  recentItem: { alignItems: 'center', width: 56 },
  recentName: { ...Typography.caption, color: Colors.textPrimary, marginTop: 4, fontWeight: '600' },
  emptyHint: { ...Typography.bodySmall, color: Colors.textSecondary, marginTop: 14 },

  shutterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, paddingHorizontal: Spacing.md },
  shutter: { width: 74, height: 74, borderRadius: 37, borderWidth: 4, borderColor: '#000', alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#000' },

  rosterHeader: { ...Typography.label, color: Colors.textSecondary, marginTop: 14, marginBottom: 6, textTransform: 'uppercase' },
  rosterRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  rosterName: { ...Typography.bodyStrong, color: Colors.textPrimary },
  rosterSub: { ...Typography.caption, color: Colors.textSecondary, marginTop: 1 },

  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: Spacing.lg },
  overlayCard: { backgroundColor: '#fff', borderRadius: Radius.xl, padding: Spacing.lg, alignItems: 'center', width: '100%', maxWidth: 360 },
  overlayTitle: { ...Typography.heading3, color: '#000', marginTop: 14, textAlign: 'center' },
  overlayBody: { ...Typography.bodySmall, color: Colors.textSecondary, marginTop: 4, textAlign: 'center' },
});
