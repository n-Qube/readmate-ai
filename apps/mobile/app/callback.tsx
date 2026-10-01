import { useEffect, useRef, useState } from "react";
import { Link } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { Text, View } from "react-native";

export default function OAuthCallbackScreen() {
  const [completed, setCompleted] = useState<boolean | null>(null);
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;
    try {
      // The opener's Expo/Clerk flow activates the session. Preserve Expo's
      // origin, pending-session and redirect checks; never replay URL tokens.
      setCompleted(WebBrowser.maybeCompleteAuthSession().type === "success");
    } catch {
      // SDK errors can contain the callback URL. Keep recovery text generic.
      setCompleted(false);
    }
  }, []);

  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 24, gap: 16 }}>
      <Text accessibilityRole="header" style={{ fontSize: 22, fontWeight: "600" }}>
        {completed === false ? "Sign-in could not be completed" : "Completing sign-in…"}
      </Text>
      <Text>
        {completed === false
          ? "Return to ReadMate and start sign-in again."
          : "You can return to your original ReadMate tab."}
      </Text>
      {completed === false && <Link href="/">Return to ReadMate</Link>}
    </View>
  );
}
