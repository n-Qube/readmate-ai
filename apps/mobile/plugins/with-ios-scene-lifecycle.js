const { withAppDelegate, withInfoPlist } = require("@expo/config-plugins");

const LEGACY_WINDOW_START = `#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif

`;

const SCENE_DELEGATE = `
@objc(SceneDelegate)
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard
      let windowScene = scene as? UIWindowScene,
      let appDelegate = UIApplication.shared.delegate as? AppDelegate,
      let factory = appDelegate.reactNativeFactory
    else {
      return
    }

    let window = UIWindow(windowScene: windowScene)
    let launchOptions = makeLaunchOptions(from: connectionOptions)
    self.window = window
    appDelegate.window = window

    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
  }

  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    guard let url = URLContexts.first?.url else {
      return
    }

    _ = RCTLinkingManager.application(UIApplication.shared, open: url, options: [:])
  }

  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    _ = RCTLinkingManager.application(
      UIApplication.shared,
      continue: userActivity,
      restorationHandler: { _ in }
    )
  }

  private func makeLaunchOptions(
    from connectionOptions: UIScene.ConnectionOptions
  ) -> [UIApplication.LaunchOptionsKey: Any] {
    var launchOptions: [UIApplication.LaunchOptionsKey: Any] = [:]

    if let urlContext = connectionOptions.urlContexts.first {
      launchOptions[.url] = urlContext.url
      if let sourceApplication = urlContext.options.sourceApplication {
        launchOptions[.sourceApplication] = sourceApplication
      }
    }

    if let userActivity = connectionOptions.userActivities.first {
      launchOptions[.userActivityDictionary] = [
        "UIApplicationLaunchOptionsUserActivityTypeKey": userActivity.activityType,
        "UIApplicationLaunchOptionsUserActivityKey": userActivity,
      ]
    }

    if let notificationResponse = connectionOptions.notificationResponse {
      launchOptions[.remoteNotification] = notificationResponse.notification.request.content.userInfo
    }

    if let shortcutItem = connectionOptions.shortcutItem {
      launchOptions[.shortcutItem] = shortcutItem
    }

    return launchOptions
  }
}
`;

module.exports = function withIosSceneLifecycle(config) {
  config = withInfoPlist(config, (configWithInfoPlist) => {
    configWithInfoPlist.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: "Default Configuration",
            UISceneDelegateClassName: "$(PRODUCT_MODULE_NAME).SceneDelegate",
          },
        ],
      },
    };
    return configWithInfoPlist;
  });

  return withAppDelegate(config, (configWithAppDelegate) => {
    const appDelegate = configWithAppDelegate.modResults;
    if (appDelegate.language !== "swift") {
      throw new Error("ReadMate's UIScene lifecycle plugin requires a Swift AppDelegate.");
    }

    if (appDelegate.contents.includes("class SceneDelegate")) {
      return configWithAppDelegate;
    }
    if (!appDelegate.contents.includes(LEGACY_WINDOW_START)) {
      throw new Error("Unable to find Expo's legacy window startup block in AppDelegate.swift.");
    }

    appDelegate.contents = appDelegate.contents
      .replace(LEGACY_WINDOW_START, "")
      .replace("\nclass ReactNativeDelegate", `${SCENE_DELEGATE}\nclass ReactNativeDelegate`);

    return configWithAppDelegate;
  });
};
