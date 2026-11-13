import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { warmUpEngine } from '@/lib/ml/FaceMLClient';
import { startCloudSync } from '@/lib/sync/cloud-sync';
import { Colors } from '@/constants/theme';

export default function RootLayout() {
  useEffect(() => {
    // Warm the face models in the background so the first scan opens instantly.
    warmUpEngine().catch(console.warn);
    return startCloudSync();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: Colors.bg },
            headerTintColor: Colors.textPrimary,
            headerTitleStyle: { fontWeight: '700', fontSize: 17 },
            headerShadowVisible: false,
            headerBackButtonDisplayMode: 'minimal',
            contentStyle: { backgroundColor: Colors.bg },
            animation: 'slide_from_right',
          }}
        >
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="class/create" options={{ title: '', presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="class/[id]" options={{ title: '' }} />
          <Stack.Screen name="student/add" options={{ title: '', presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="student/[id]/enroll" options={{ headerShown: false, animation: 'fade' }} />
          <Stack.Screen name="attendance/scan/[classId]" options={{ headerShown: false, animation: 'fade' }} />
          <Stack.Screen name="attendance/review/[sessionId]" options={{ title: '' }} />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
