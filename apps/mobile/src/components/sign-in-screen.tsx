import { useOAuth } from "@clerk/expo";
import { useSignInWithApple } from "@clerk/expo/apple";
import { useSignIn, useSignUp } from "@clerk/expo/legacy";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useState } from "react";
import { BrandLockup, SectionCard, colors } from "@/components/mobile-design";
import { isPhoneOtpEnabled, parseAuthIdentifier, type OtpAuthMethod } from "@/config/otp-policy";

WebBrowser.maybeCompleteAuthSession();

type OtpAuthStep = "identifier" | "code";
type OtpAuthFlow = "sign-in" | "sign-up";
type OAuthProvider = "google" | "apple";

// ReadMate's production Clerk instance intentionally uses email authentication
// without the paid phone OTP feature. Keep phone OTP available for development
// instances, where Clerk exposes it for testing.
const phoneOtpEnabled = isPhoneOtpEnabled(process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY);

export function SignInScreen() {
  const googleOAuth = useOAuth({ strategy: "oauth_google" });
  const appleOAuth = useOAuth({ strategy: "oauth_apple" });
  const { startAppleAuthenticationFlow } = useSignInWithApple();
  const signInState = useSignIn();
  const signUpState = useSignUp();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<OtpAuthStep>("identifier");
  const [flow, setFlow] = useState<OtpAuthFlow>("sign-in");
  const [method, setMethod] = useState<OtpAuthMethod>("email");
  const [busy, setBusy] = useState(false);
  const [oauthBusy, setOauthBusy] = useState<OAuthProvider | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function signInWith(provider: OAuthProvider) {
    setOauthBusy(provider);
    setError(null);
    setMessage(null);
    try {
      const result = provider === "apple" && Platform.OS === "ios"
        ? await startAppleAuthenticationFlow()
        : await (provider === "google" ? googleOAuth : appleOAuth).startOAuthFlow({
            redirectUrl: Linking.createURL("callback")
          });
      if (result.createdSessionId && result.setActive) {
        await result.setActive({ session: result.createdSessionId });
        return;
      }
      setError(`${provider === "google" ? "Google" : "Apple"} sign-in was cancelled before a session was created.`);
    } catch (caught) {
      setError(readClerkError(caught) ?? `${provider === "google" ? "Google" : "Apple"} sign-in could not be completed.`);
    } finally {
      setOauthBusy(null);
    }
  }

  async function sendOtpCode() {
    if (!signInState.isLoaded || !signUpState.isLoaded) return;
    const credential = parseAuthIdentifier(identifier, phoneOtpEnabled);
    if (!credential) {
      setError(phoneOtpEnabled
        ? "Enter a valid email address or a phone number with country code, for example +1 555 123 4567."
        : "Enter a valid email address.");
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);
    setMethod(credential.type);
    try {
      const signInAttempt = await signInState.signIn.create({ identifier: credential.value });
      const firstFactor = signInAttempt.supportedFirstFactors?.find((factor) => factor.strategy === (credential.type === "email" ? "email_code" : "phone_code"));
      if (firstFactor?.strategy === "email_code") {
        await signInAttempt.prepareFirstFactor({ strategy: "email_code", emailAddressId: firstFactor.emailAddressId });
        setFlow("sign-in");
        setStep("code");
        setMessage("We sent a one-time code to your email.");
        return;
      }
      if (firstFactor?.strategy === "phone_code") {
        await signInAttempt.prepareFirstFactor({ strategy: "phone_code", phoneNumberId: firstFactor.phoneNumberId, channel: "sms" });
        setFlow("sign-in");
        setStep("code");
        setMessage("We sent a one-time code to your phone.");
        return;
      }
      if (signInAttempt.status === "complete" && signInAttempt.createdSessionId) {
        await signInState.setActive({ session: signInAttempt.createdSessionId });
        return;
      }
      throw new Error("OTP is not available for this account.");
    } catch (signInError) {
      try {
        const signUpAttempt = await signUpState.signUp.create(credential.type === "email" ? { emailAddress: credential.value } : { phoneNumber: credential.value });
        if (credential.type === "email") {
          await signUpAttempt.prepareEmailAddressVerification({ strategy: "email_code" });
        } else {
          await signUpAttempt.preparePhoneNumberVerification({ strategy: "phone_code", channel: "sms" });
        }
        setFlow("sign-up");
        setStep("code");
        setMessage(`We sent a one-time code to your ${credential.type === "email" ? "email" : "phone"}.`);
      } catch (signUpError) {
        setError(readClerkError(signUpError) ?? readClerkError(signInError) ?? "Could not send a verification code.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function signInWithPassword() {
    if (!signInState.isLoaded) return;
    const credential = parseAuthIdentifier(identifier, phoneOtpEnabled);
    const trimmedPassword = password.trim();
    if (!credential) {
      setError(phoneOtpEnabled ? "Enter the reviewer email address or phone number." : "Enter the reviewer email address.");
      return;
    }
    if (!trimmedPassword) {
      setError("Enter the account password.");
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await signInState.signIn.create({ identifier: credential.value, password: trimmedPassword });
      if (result.status === "complete" && result.createdSessionId) {
        await signInState.setActive({ session: result.createdSessionId });
        return;
      }
      setError("This account needs another verification step. Use one-time code, Google, or Apple sign-in.");
    } catch (caught) {
      setError(readClerkError(caught) ?? "Password sign-in could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtpCode() {
    if (!signInState.isLoaded || !signUpState.isLoaded) return;
    const trimmedCode = code.trim();
    if (!trimmedCode) {
      setError(`Enter the one-time code sent to your ${method === "email" ? "email" : "phone"}.`);
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (flow === "sign-in") {
        const result = await signInState.signIn.attemptFirstFactor({ strategy: method === "email" ? "email_code" : "phone_code", code: trimmedCode });
        if (result.status === "complete" && result.createdSessionId) {
          await signInState.setActive({ session: result.createdSessionId });
          return;
        }
        if (result.status === "needs_second_factor") {
          setError("This account needs another verification step. Use Google, Apple, or the secure account sign-in page.");
          return;
        }
      } else {
        const result = method === "email"
          ? await signUpState.signUp.attemptEmailAddressVerification({ code: trimmedCode })
          : await signUpState.signUp.attemptPhoneNumberVerification({ code: trimmedCode });
        if (result.status === "complete" && result.createdSessionId) {
          await signUpState.setActive({ session: result.createdSessionId });
          return;
        }
      }
      setError("Could not complete phone verification. Please try again.");
    } catch (caught) {
      setError(readClerkError(caught) ?? "The code could not be verified.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ flexGrow: 1, padding: 24, gap: 18, backgroundColor: colors.bg }}>
      <View style={{ gap: 18, paddingTop: 18 }}>
        <BrandLockup large />
        <View style={{ gap: 8 }}>
          <Text selectable style={{ fontSize: 30, lineHeight: 33, fontWeight: "800", color: colors.ink, letterSpacing: 0 }}>
            Listen everywhere you read
          </Text>
          <Text selectable style={{ fontSize: 14, lineHeight: 22, color: colors.muted }}>
            Sign in to sync saved pages, PDFs, feeds, reading progress, and voice preferences.
          </Text>
        </View>
      </View>

      <SectionCard elevated>
        <View style={{ gap: 5 }}>
          <Text selectable style={{ color: colors.muted, fontSize: 11, fontWeight: "700", letterSpacing: 0, textTransform: "uppercase" }}>
            {phoneOtpEnabled ? "Email or phone" : "Email"}
          </Text>
        </View>
        {step === "identifier" ? (
          <>
            <TextInput
              value={identifier}
              onChangeText={setIdentifier}
              placeholder={phoneOtpEnabled ? "Email or +1 555 123 4567" : "Email address"}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              textContentType="username"
              editable={!busy}
              style={authInputStyle}
            />
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="Password"
              autoCapitalize="none"
              autoComplete="password"
              textContentType="password"
              secureTextEntry
              editable={!busy}
              style={authInputStyle}
            />
            <Pressable disabled={busy} onPress={sendOtpCode} style={authButtonStyle(!busy)}>
              {busy ? <ActivityIndicator color="#ffffff" /> : <Text style={authButtonTextStyle}>Send one-time code  ›</Text>}
            </Pressable>
            <Pressable disabled={busy} onPress={signInWithPassword} style={secondaryAuthButtonStyle(!busy)}>
              <Text style={secondaryAuthButtonTextStyle}>Sign in with password</Text>
            </Pressable>
          </>
        ) : (
          <>
            <TextInput
              value={code}
              onChangeText={setCode}
              placeholder="Enter code"
              keyboardType="number-pad"
              autoComplete="sms-otp"
              textContentType="oneTimeCode"
              editable={!busy}
              style={authInputStyle}
            />
            <Pressable disabled={busy} onPress={verifyOtpCode} style={authButtonStyle(!busy)}>
              {busy ? <ActivityIndicator color="#ffffff" /> : <Text style={authButtonTextStyle}>Verify and continue</Text>}
            </Pressable>
            <Pressable
              disabled={busy}
              onPress={() => {
                setStep("identifier");
                setCode("");
                setMessage(null);
                setError(null);
              }}
              style={{ minHeight: 42, alignItems: "center", justifyContent: "center" }}
            >
              <Text style={{ color: "#2563eb", fontWeight: "900" }}>
                {phoneOtpEnabled ? "Use a different email or phone" : "Use a different email"}
              </Text>
            </Pressable>
          </>
        )}
        {message ? <Text selectable style={{ color: colors.green, fontSize: 14, lineHeight: 20 }}>{message}</Text> : null}
        {error ? <Text selectable style={{ color: colors.red, fontSize: 14, lineHeight: 20 }}>{error}</Text> : null}
      </SectionCard>

      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
        <Text selectable style={{ color: colors.faint, fontSize: 11, fontWeight: "700", letterSpacing: 0 }}>
          OR CONTINUE WITH
        </Text>
        <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
      </View>

      <View style={{ gap: 10 }}>
        <Pressable disabled={Boolean(oauthBusy)} onPress={() => signInWith("google")} style={{ minHeight: 50, alignItems: "center", justifyContent: "center", borderRadius: 999, borderCurve: "continuous", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, opacity: oauthBusy && oauthBusy !== "google" ? 0.55 : 1 }}>
          {oauthBusy === "google" ? <ActivityIndicator color={colors.ink} /> : <Text style={{ color: colors.ink, fontSize: 14, fontWeight: "700" }}>Continue with Google</Text>}
        </Pressable>
        <Pressable disabled={Boolean(oauthBusy)} onPress={() => signInWith("apple")} style={{ minHeight: 50, alignItems: "center", justifyContent: "center", borderRadius: 999, borderCurve: "continuous", backgroundColor: colors.text, opacity: oauthBusy && oauthBusy !== "apple" ? 0.55 : 1 }}>
          {oauthBusy === "apple" ? <ActivityIndicator color="#ffffff" /> : <Text style={{ color: "#ffffff", fontSize: 14, fontWeight: "700" }}>Continue with Apple</Text>}
        </Pressable>
      </View>

      <Text selectable style={{ textAlign: "center", color: colors.faint, fontSize: 13, lineHeight: 19 }}>
        By continuing you agree to our Terms and Privacy Policy.
      </Text>
    </ScrollView>
  );
}

const authInputStyle = {
  minHeight: 50,
  borderRadius: 14,
  borderCurve: "continuous" as const,
  borderWidth: 1,
  borderColor: colors.border,
  paddingHorizontal: 14,
  color: colors.ink,
  backgroundColor: colors.surfaceSoft
};

function authButtonStyle(enabled: boolean) {
  return {
    minHeight: 50,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    borderRadius: 999,
    borderCurve: "continuous" as const,
    backgroundColor: enabled ? colors.blue : "#9aa8bd"
  };
}

const authButtonTextStyle = { color: "#ffffff", fontSize: 16, fontWeight: "900" as const };

function secondaryAuthButtonStyle(enabled: boolean) {
  return {
    minHeight: 48,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    borderRadius: 999,
    borderCurve: "continuous" as const,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    opacity: enabled ? 1 : 0.55
  };
}

const secondaryAuthButtonTextStyle = { color: colors.ink, fontSize: 15, fontWeight: "800" as const };

function readClerkError(error: unknown) {
  if (typeof error === "object" && error && "errors" in error) {
    const errors = (error as { errors?: Array<{ longMessage?: string; message?: string }> }).errors;
    return errors?.[0]?.longMessage ?? errors?.[0]?.message ?? null;
  }
  return error instanceof Error ? error.message : null;
}
