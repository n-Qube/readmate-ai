import { useAuth } from "@clerk/expo";
import { Redirect, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { colors } from "@/components/mobile-design";
import { FirstRunOnboarding } from "@/components/onboarding-screen";
import { SignInScreen } from "@/components/sign-in-screen";
import { SetupFlow } from "@/components/setup-flow";
import { deviceStorage } from "@/storage/device-storage";
import { saveSetupPreferences, type SetupPreferences } from "@/setup/setup-preferences";
import { isWebMcpChallengeEntry } from "@/utils/challenge-entry";
import { screenshotMode } from "@/utils/screenshot-mode";

const onboardingStorageKey = "readmate.onboarding.completed.v1";

export default function IndexRedirect() {
  const { isLoaded, isSignedIn } = useAuth();
  const { challenge } = useLocalSearchParams<{ challenge?: string | string[] }>();
  const challengeEntry = isWebMcpChallengeEntry(challenge);
  const [onboardingChecked, setOnboardingChecked] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showSetup, setShowSetup] = useState(false);

  useEffect(() => {
    if (screenshotMode || challengeEntry) {
      setShowOnboarding(false);
      setOnboardingChecked(true);
      return;
    }

    deviceStorage.getItem(onboardingStorageKey)
      .then((value) => setShowOnboarding(value !== "1"))
      .catch(() => setShowOnboarding(true))
      .finally(() => setOnboardingChecked(true));
  }, [challengeEntry]);

  if (screenshotMode) {
    return <Redirect href="/(tabs)" />;
  }

  if (!onboardingChecked) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.blue} />
      </View>
    );
  }

  if (showOnboarding) {
    const completeOnboarding = async (options?: { showSetup?: boolean }) => {
      try {
        await deviceStorage.setItem(onboardingStorageKey, "1");
      } catch {
        // Continue into the app even if local persistence is unavailable.
      } finally {
        setShowOnboarding(false);
        setShowSetup(options?.showSetup === true);
      }
    };

    return <FirstRunOnboarding onComplete={completeOnboarding} />;
  }

  if (showSetup) {
    const completeSetup = async (preferences?: SetupPreferences) => {
      try {
        if (preferences) await saveSetupPreferences(preferences);
        await deviceStorage.setItem("readmate.setup.completed.v1", "1");
      } catch {
        // Continue into auth even if local persistence is unavailable.
      } finally {
        setShowSetup(false);
      }
    };

    return <SetupFlow onComplete={completeSetup} />;
  }

  if (!isLoaded) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.blue} />
      </View>
    );
  }

  if (!isSignedIn) {
    return <SignInScreen />;
  }

  return <Redirect href="/(tabs)" />;
}
