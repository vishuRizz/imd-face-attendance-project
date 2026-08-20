import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { initMLModels } from '@/lib/ml/FaceMLClient';
import { startCloudSync } from '@/lib/sync/cloud-sync';

export default function RootLayout() {
  useEffect(() => {
    // Initialize ML models on app start (non-blocking)
    initMLModels().catch(console.warn);
    return startCloudSync();
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" backgroundColor="#F6F7F4" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: '#F6F7F4' },
          headerTintColor: '#172019',
          headerTitleStyle: { fontWeight: '800', fontSize: 18 },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: '#F6F7F4' },
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
    </SafeAreaProvider>
  );
}
