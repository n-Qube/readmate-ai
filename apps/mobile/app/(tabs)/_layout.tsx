import { useAuth } from "@clerk/expo";
import { Redirect, Tabs } from "expo-router";
import { ActivityIndicator, View, type ColorValue } from "react-native";
import { AppIcon, type AppIconName } from "@/components/app-icon";
import { colors } from "@/components/mobile-design";
import { useApplySetupPreferences } from "@/setup/use-apply-setup-preferences";
import { screenshotMode } from "@/utils/screenshot-mode";

export default function TabLayout() {
  const { isLoaded, isSignedIn } = useAuth();
  useApplySetupPreferences(!screenshotMode && isLoaded && Boolean(isSignedIn));

  if (!screenshotMode && !isLoaded) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.blue} />
      </View>
    );
  }

  if (!screenshotMode && !isSignedIn) {
    return <Redirect href="/" />;
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.player,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
        tabBarItemStyle: { borderRadius: 18, paddingVertical: 5 },
        tabBarStyle: {
          display: "none"
        }
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Home", tabBarIcon: ({ color }) => <TabIcon name="house" color={color} /> }} />
      <Tabs.Screen name="library" options={{ title: "Library", tabBarIcon: ({ color }) => <TabIcon name="books.vertical" color={color} /> }} />
      <Tabs.Screen name="history" options={{ href: null }} />
      <Tabs.Screen name="study" options={{ title: "Study", tabBarIcon: ({ color }) => <TabIcon name="graduationcap" color={color} /> }} />
      <Tabs.Screen name="more" options={{ title: "More", tabBarIcon: ({ color }) => <TabIcon name="ellipsis" color={color} /> }} />
    </Tabs>
  );
}

function TabIcon({ name, color }: { name: AppIconName; color: ColorValue }) {
  return <AppIcon name={name} size={25} color={color} weight="semibold" />;
}
