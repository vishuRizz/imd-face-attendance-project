import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { initMLModels } from '@/lib/ml/FaceMLClient';

export default function RootLayout() {
  useEffect(() => {
    // Initialize ML models on app start (non-blocking)
    initMLModels().catch(console.warn);
  }, []);

  return (
    <>
      <StatusBar style="light" backgroundColor="#0D0D1A" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: '#0D0D1A' },
          headerTintColor: '#FFFFFF',
          headerTitleStyle: { fontWeight: '700', fontSize: 18 },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: '#0D0D1A' },
          animation: 'slide_from_right',
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="class/create" options={{ title: 'New Class', presentation: 'modal' }} />
        <Stack.Screen name="class/[id]" options={{ title: 'Class' }} />
        <Stack.Screen name="student/add" options={{ title: 'Add Student', presentation: 'modal' }} />
        <Stack.Screen name="student/[id]/enroll" options={{ title: 'Enroll Face' }} />
        <Stack.Screen name="attendance/scan/[classId]" options={{ title: 'Scan Attendance', headerShown: false }} />
        <Stack.Screen name="attendance/review/[sessionId]" options={{ title: 'Review Attendance' }} />
      </Stack>
    </>
  );
}
