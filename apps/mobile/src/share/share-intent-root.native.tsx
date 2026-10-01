import { useAuth } from "@clerk/expo";
import { useRouter } from "expo-router";
import { ShareIntentProvider, useShareIntentContext } from "expo-share-intent";
import { useEffect, type PropsWithChildren } from "react";
import { Alert } from "react-native";
import { extractSharedUrl } from "./shared-url";

/** Receives links shared into ReadMate from other apps (Android share sheet). */
export function ShareIntentRoot({ children }: PropsWithChildren) {
  return <ShareIntentProvider options={{ resetOnBackground: true }}>{children}</ShareIntentProvider>;
}

/**
 * Opens Add content pre-filled with the shared link. Nothing is saved until
 * the user reviews it and taps Add, per the explicit-save privacy rule.
 */
export function SharedContentHandler() {
  const router = useRouter();
  const { isLoaded, isSignedIn } = useAuth();
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();

  useEffect(() => {
    // Keep the share pending until sign-in completes.
    if (!hasShareIntent || !isLoaded || !isSignedIn) return;
    const sharedUrl = extractSharedUrl({ webUrl: shareIntent.webUrl, text: shareIntent.text });
    resetShareIntent();
    if (!sharedUrl) {
      Alert.alert("Share a link", "ReadMate can save web links shared from other apps. To add a PDF, use Add content.");
      return;
    }
    router.push({ pathname: "/add-content", params: { sharedUrl } });
  }, [hasShareIntent, isLoaded, isSignedIn, shareIntent, resetShareIntent, router]);

  return null;
}
