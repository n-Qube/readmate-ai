# iOS Design Audit QA

Use a Release-style build for every iOS design audit. Debug Xcode installs and EAS development-client builds can show Metro, dev launcher, or development overlays that users should never see.

## Build selection

- Preferred: TestFlight or `store-internal` build.
- Acceptable local artifact: `eas build -p ios --profile store-internal`.
- Do not audit with Xcode `Debug`, `npx expo run:ios`, or EAS `development`.

## Device setup

1. Delete the current ReadMate AI app from the iPhone.
2. Install the latest TestFlight/internal build.
3. Launch from the iOS home screen, not from Metro, Xcode, or Expo Dev Client.
4. Confirm startup shows the native splash and app UI only. No Metro URL, dev menu, or bundle server details should appear.

## Playback checks

1. Start playback from a real saved article.
2. Lock the phone and confirm lock-screen controls show title, source, play/pause, and skip controls.
3. Use Control Center to pause, resume, and skip.
4. Background the app, relaunch it, and confirm progress remains close to the heard position.
5. Test headset or AirPods play/pause if available.
