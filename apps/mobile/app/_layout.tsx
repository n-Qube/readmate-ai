import { ClerkProvider, useAuth } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as SplashScreen from "expo-splash-screen";
import { Stack } from "expo-router/stack";
import { useEffect, useMemo } from "react";
import { LogBox, ScrollView, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { PlaybackManagerProvider } from "@/playback/playback-manager";
import { screenshotMode } from "@/utils/screenshot-mode";
import { clearSpeechAudioCache } from "@/api/documents";
import { ApiError } from "@/api/client";
import { isUsableClerkPublishableKey } from "@/config/clerk-publishable-key";
import { clearPremiumPurchasesIdentity, initializePremiumPurchases } from "@/purchases/premium-purchases";
import { AgentActionProvider } from "@/webmcp/agent-action-provider";
import { SharedContentHandler, ShareIntentRoot } from "@/share/share-intent-root";

if (screenshotMode) {
  LogBox.ignoreAllLogs(true);
}

SplashScreen.hideAsync().catch(() => undefined);

// Expo replaces EXPO_PUBLIC_* references while bundling. Keep this at module
// scope so a release bundle never falls back to React Native's runtime process
// shim, and validate before handing the value to Clerk.
const clerkPublishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";

export default function RootLayout() {
  useEffect(() => {
    SplashScreen.hideAsync().catch(() => undefined);
  }, []);

  if (!isUsableClerkPublishableKey(clerkPublishableKey)) {
    return <MissingConfigScreen />;
  }

  return (
    <ShareIntentRoot>
      <ClerkProvider publishableKey={clerkPublishableKey} tokenCache={tokenCache}>
        <PrincipalScopedApp />
      </ClerkProvider>
    </ShareIntentRoot>
  );
}

function PrincipalScopedApp() {
  const { isLoaded, userId } = useAuth();
  const principalKey = isLoaded ? userId ?? "signed-out" : "auth-loading";
  const queryClient = useMemo(
    () => new QueryClient({
      defaultOptions: {
        queries: {
          retry: shouldRetryQuery,
          retryDelay: (attempt) => Math.min(4_000, 600 * 2 ** attempt),
          staleTime: 30_000
        }
      }
    }),
    [principalKey]
  );

  useEffect(() => {
    clearSpeechAudioCache();
    return () => queryClient.clear();
  }, [principalKey, queryClient]);

  useEffect(() => {
    if (!isLoaded) return;
    if (userId) {
      void initializePremiumPurchases(userId).catch(() => undefined);
      return;
    }
    void clearPremiumPurchasesIdentity().catch(() => undefined);
  }, [isLoaded, userId]);

  return (
    <QueryClientProvider client={queryClient} key={principalKey}>
      <PlaybackManagerProvider key={principalKey}>
        <AgentActionProvider>
          <StatusBar style="auto" />
          <Stack>
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="document/[id]" options={{ headerShown: false }} />
            <Stack.Screen name="player" options={{ headerShown: false, presentation: "modal" }} />
            <Stack.Screen name="add-content" options={{ headerShown: false }} />
            <Stack.Screen name="sources" options={{ headerShown: false }} />
            <Stack.Screen name="premium" options={{ headerShown: false, presentation: "modal" }} />
            <Stack.Screen name="settings" options={{ headerShown: false }} />
            <Stack.Screen name="listening-history" options={{ headerShown: false }} />
            <Stack.Screen name="about" options={{ headerShown: false }} />
          </Stack>
          <SharedContentHandler />
        </AgentActionProvider>
      </PlaybackManagerProvider>
    </QueryClientProvider>
  );
}

function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (failureCount >= 2) return false;
  if (error instanceof ApiError) {
    if ([401, 403, 404].includes(error.status)) return false;
    return error.status === 429 || error.status >= 500;
  }
  const message = error instanceof Error ? error.message : "";
  return /network|fetch|connection|timeout|temporar/i.test(message);
}

function MissingConfigScreen() {
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ flexGrow: 1, padding: 24, justifyContent: "center", backgroundColor: "#f6f7fb" }}>
      <View style={{ gap: 12, padding: 20, borderRadius: 20, borderCurve: "continuous", backgroundColor: "#ffffff", boxShadow: "0 8px 30px rgba(20, 33, 61, 0.08)" }}>
        <Text selectable style={{ fontSize: 24, fontWeight: "700", color: "#172033" }}>
          ReadMate
        </Text>
        <Text selectable style={{ fontSize: 16, lineHeight: 23, color: "#536179" }}>
          This build is missing a valid sign-in configuration. Install the latest ReadMate build and try again.
        </Text>
      </View>
    </ScrollView>
  );
}
