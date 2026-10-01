import { Redirect } from "expo-router";

export default function NativeOAuthCallbackScreen() {
  // Expo's native auth-session listener returns the URL to Clerk, which
  // activates the session. Only the web popup needs maybeCompleteAuthSession.
  // Return to the auth-aware entry route without reading or replaying tokens.
  return <Redirect href="/" />;
}
