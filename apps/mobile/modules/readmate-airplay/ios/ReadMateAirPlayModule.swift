import AVFoundation
import AVKit
import ExpoModulesCore
import MediaPlayer
import UIKit

private struct OutputMedia {
  let uri: String
  let title: String
  let subtitle: String
  let artworkUrl: String
  let currentTime: Double
  let duration: Double
}

public class ReadMateAirPlayModule: Module {
  private var routeObserver: NSObjectProtocol?
  private var player: AVPlayer?
  private var playerItemStatusObserver: NSKeyValueObservation?
  private var timeObserver: Any?
  private var endObserver: NSObjectProtocol?
  private var failedObserver: NSObjectProtocol?
  private var pendingMedia: OutputMedia?
  private var loadedMediaUri: String?
  private var remoteCommandTargets: [(command: MPRemoteCommand, target: Any)] = []

  public func definition() -> ModuleDefinition {
    Name("ReadMateAirPlay")
    Events("onOutputStateChanged")

    OnCreate {
      self.configureRemoteCommands()
      self.routeObserver = NotificationCenter.default.addObserver(
        forName: AVAudioSession.routeChangeNotification,
        object: nil,
        queue: .main
      ) { [weak self] _ in
        self?.handleRouteChanged()
      }
    }

    OnDestroy {
      self.removeRemoteCommands()
      self.clearPlayer(clearNowPlaying: true)
      if let observer = self.routeObserver {
        NotificationCenter.default.removeObserver(observer)
      }
      self.routeObserver = nil
    }

    Function("showPicker") { (uri: String, title: String, subtitle: String, artworkUrl: String, currentTime: Double, duration: Double) in
      self.pendingMedia = OutputMedia(uri: uri, title: title, subtitle: subtitle, artworkUrl: artworkUrl, currentTime: currentTime, duration: duration)
      self.configureAudioSession()
      // Give iOS a real audio item before it evaluates the available routes.
      // Creating the player only after the route changed made some receivers
      // appear as "Cannot Play" in the system picker.
      self.loadPendingMedia(autoplay: false, force: true)
      self.emitRouteState()
      DispatchQueue.main.async {
        guard let windowScene = UIApplication.shared.connectedScenes
          .compactMap({ $0 as? UIWindowScene })
          .first(where: { $0.activationState == .foregroundActive }),
          let window = windowScene.windows.first(where: { $0.isKeyWindow }),
          let rootView = window.rootViewController?.view else {
          return
        }

        let picker = AVRoutePickerView(frame: CGRect(x: 0, y: 0, width: 1, height: 1))
        // ReadMate casts spoken audio, not video. The default audio-first order
        // avoids advertising video-only routes that cannot accept this item.
        picker.prioritizesVideoDevices = false
        picker.alpha = 0.01
        rootView.addSubview(picker)
        picker.layoutIfNeeded()

        DispatchQueue.main.async {
          if let button = ReadMateAirPlayModule.findButton(in: picker) {
            button.sendActions(for: .touchUpInside)
          }
        }

        DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
          picker.removeFromSuperview()
        }
      }
    }

    Function("loadMedia") { (uri: String, title: String, subtitle: String, artworkUrl: String, currentTime: Double, duration: Double) in
      self.pendingMedia = OutputMedia(uri: uri, title: title, subtitle: subtitle, artworkUrl: artworkUrl, currentTime: currentTime, duration: duration)
      self.configureAudioSession()
      self.emitRouteState()
    }

    Function("sendCommand") { (command: String, value: Double) in
      DispatchQueue.main.async {
        guard let player = self.player else { return }
        switch command {
        case "play":
          player.play()
          self.emitPlaybackState(playbackState: "playing")
        case "pause":
          player.pause()
          self.emitPlaybackState(playbackState: "paused")
        case "stop":
          self.clearPlayer(clearNowPlaying: true)
          self.emitPlaybackState(playbackState: "idle")
        case "seekBy":
          let current = player.currentTime().seconds
          let next = max(0, (current.isFinite ? current : 0) + value)
          player.seek(to: CMTime(seconds: next, preferredTimescale: 600)) { _ in
            DispatchQueue.main.async {
              self.emitPlaybackState()
            }
          }
        default:
          break
        }
      }
    }
  }

  private func handleRouteChanged() {
    if isAirPlayRoute() {
      emitRouteState()
      loadPendingMedia(autoplay: true, force: false)
    } else {
      emitRouteState()
      clearPlayer(clearNowPlaying: true)
    }
  }

  private func configureRemoteCommands() {
    let commands = MPRemoteCommandCenter.shared()
    commands.playCommand.isEnabled = true
    commands.pauseCommand.isEnabled = true
    commands.togglePlayPauseCommand.isEnabled = true
    commands.skipBackwardCommand.isEnabled = true
    commands.skipBackwardCommand.preferredIntervals = [10]
    commands.skipForwardCommand.isEnabled = true
    commands.skipForwardCommand.preferredIntervals = [10]
    commands.changePlaybackPositionCommand.isEnabled = true

    addRemoteTarget(commands.playCommand) { [weak self] _ in
      guard let self, let player = self.player else { return .noSuchContent }
      player.play()
      self.emitPlaybackState(playbackState: "playing")
      return .success
    }
    addRemoteTarget(commands.pauseCommand) { [weak self] _ in
      guard let self, let player = self.player else { return .noSuchContent }
      player.pause()
      self.emitPlaybackState(playbackState: "paused")
      return .success
    }
    addRemoteTarget(commands.togglePlayPauseCommand) { [weak self] _ in
      guard let self, let player = self.player else { return .noSuchContent }
      if player.timeControlStatus == .playing {
        player.pause()
        self.emitPlaybackState(playbackState: "paused")
      } else {
        player.play()
        self.emitPlaybackState(playbackState: "playing")
      }
      return .success
    }
    addRemoteTarget(commands.skipBackwardCommand) { [weak self] event in
      guard let self, let player = self.player else { return .noSuchContent }
      let interval = (event as? MPSkipIntervalCommandEvent)?.interval ?? 10
      self.seek(player, to: max(0, self.currentTime() - interval))
      return .success
    }
    addRemoteTarget(commands.skipForwardCommand) { [weak self] event in
      guard let self, let player = self.player else { return .noSuchContent }
      let interval = (event as? MPSkipIntervalCommandEvent)?.interval ?? 10
      self.seek(player, to: max(0, self.currentTime() + interval))
      return .success
    }
    addRemoteTarget(commands.changePlaybackPositionCommand) { [weak self] event in
      guard let self, let player = self.player, let position = event as? MPChangePlaybackPositionCommandEvent else { return .noSuchContent }
      self.seek(player, to: max(0, position.positionTime))
      return .success
    }
  }

  private func addRemoteTarget(_ command: MPRemoteCommand, handler: @escaping (MPRemoteCommandEvent) -> MPRemoteCommandHandlerStatus) {
    let target = command.addTarget(handler: handler)
    remoteCommandTargets.append((command, target))
  }

  private func removeRemoteCommands() {
    for entry in remoteCommandTargets {
      entry.command.removeTarget(entry.target)
    }
    remoteCommandTargets.removeAll()
  }

  private func seek(_ player: AVPlayer, to seconds: Double) {
    player.seek(to: CMTime(seconds: seconds, preferredTimescale: 600)) { [weak self] _ in
      DispatchQueue.main.async {
        self?.emitPlaybackState()
      }
    }
  }

  private func configureAudioSession() {
    let session = AVAudioSession.sharedInstance()
    do {
      try session.setCategory(.playback, mode: .default)
      try session.setActive(true)
    } catch {
      emitError(error.localizedDescription)
    }
  }

  private func isAirPlayRoute() -> Bool {
    AVAudioSession.sharedInstance().currentRoute.outputs.contains { $0.portType == .airPlay }
  }

  private func emitRouteState() {
    let output = AVAudioSession.sharedInstance().currentRoute.outputs.first(where: { $0.portType == .airPlay }) ?? AVAudioSession.sharedInstance().currentRoute.outputs.first
    let isAirPlay = output?.portType == .airPlay
    let name = output?.portName ?? "This device"
    let normalizedName = name.lowercased()
    let isScreen = isAirPlay && ["tv", "display", "projector", "screen", "apple"].contains(where: normalizedName.contains)
    sendEvent("onOutputStateChanged", [
      "connected": isAirPlay,
      "platform": isAirPlay ? "airplay" : "local",
      "deviceName": name,
      "isScreen": isScreen,
      "playbackState": playbackState(),
      "currentTime": currentTime(),
      "duration": currentDuration()
    ])
  }

  private func loadPendingMedia(autoplay: Bool, force: Bool) {
    guard let media = pendingMedia, !media.uri.isEmpty, let url = mediaUrl(from: media.uri) else { return }
    if !force, loadedMediaUri == media.uri, player != nil {
      if autoplay { player?.play() }
      emitPlaybackState(playbackState: autoplay ? "playing" : nil)
      return
    }

    clearPlayer(clearNowPlaying: false)
    configureAudioSession()

    let item = AVPlayerItem(url: url)
    playerItemStatusObserver = item.observe(\.status, options: [.initial, .new]) { [weak self, weak item] _, _ in
      guard let self, let item else { return }
      DispatchQueue.main.async {
        if item.status == .failed {
          self.emitError(item.error?.localizedDescription ?? "The AirPlay device could not play this audio.")
        } else if item.status == .readyToPlay {
          self.emitPlaybackState()
        }
      }
    }
    let nextPlayer = AVPlayer(playerItem: item)
    nextPlayer.allowsExternalPlayback = true
    player = nextPlayer
    loadedMediaUri = media.uri
    updateNowPlaying(
      title: media.title,
      subtitle: media.subtitle,
      artworkUrl: media.artworkUrl,
      currentTime: media.currentTime,
      duration: media.duration,
      playbackRate: autoplay ? 1 : 0
    )

    if media.currentTime > 0 {
      nextPlayer.seek(to: CMTime(seconds: media.currentTime, preferredTimescale: 600))
    }

    timeObserver = nextPlayer.addPeriodicTimeObserver(forInterval: CMTime(seconds: 0.75, preferredTimescale: 600), queue: .main) { [weak self] _ in
      self?.emitPlaybackState()
    }
    endObserver = NotificationCenter.default.addObserver(
      forName: .AVPlayerItemDidPlayToEndTime,
      object: item,
      queue: .main
    ) { [weak self] _ in
      self?.emitPlaybackState(playbackState: "completed")
    }
    failedObserver = NotificationCenter.default.addObserver(
      forName: .AVPlayerItemFailedToPlayToEndTime,
      object: item,
      queue: .main
    ) { [weak self] notification in
      let error = notification.userInfo?[AVPlayerItemFailedToPlayToEndTimeErrorKey] as? Error
      self?.emitError(error?.localizedDescription ?? "The AirPlay device could not finish playing this audio.")
    }

    if autoplay { nextPlayer.play() }
    emitPlaybackState(playbackState: autoplay ? "playing" : "paused")
  }

  private func clearPlayer(clearNowPlaying: Bool) {
    if let observer = timeObserver {
      player?.removeTimeObserver(observer)
    }
    if let observer = endObserver {
      NotificationCenter.default.removeObserver(observer)
    }
    if let observer = failedObserver {
      NotificationCenter.default.removeObserver(observer)
    }
    playerItemStatusObserver?.invalidate()
    playerItemStatusObserver = nil
    timeObserver = nil
    endObserver = nil
    failedObserver = nil
    player?.pause()
    player = nil
    loadedMediaUri = nil
    if clearNowPlaying {
      MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
    }
  }

  private func emitPlaybackState(playbackState forcedState: String? = nil) {
    let output = AVAudioSession.sharedInstance().currentRoute.outputs.first(where: { $0.portType == .airPlay }) ?? AVAudioSession.sharedInstance().currentRoute.outputs.first
    let isAirPlay = output?.portType == .airPlay
    let name = output?.portName ?? "AirPlay"
    let normalizedName = name.lowercased()
    let isScreen = isAirPlay && ["tv", "display", "projector", "screen", "apple"].contains(where: normalizedName.contains)
    let state = forcedState ?? playbackState()
    updateNowPlayingPlaybackState(state)
    sendEvent("onOutputStateChanged", [
      "connected": isAirPlay,
      "platform": isAirPlay ? "airplay" : "local",
      "deviceName": name,
      "isScreen": isScreen,
      "playbackState": state,
      "currentTime": currentTime(),
      "duration": currentDuration()
    ])
  }

  private func emitError(_ message: String) {
    sendEvent("onOutputStateChanged", [
      "connected": isAirPlayRoute(),
      "platform": "airplay",
      "playbackState": "error",
      "error": message
    ])
  }

  private func playbackState() -> String {
    guard let player else { return "idle" }
    if player.timeControlStatus == .playing { return "playing" }
    if player.timeControlStatus == .waitingToPlayAtSpecifiedRate { return "loading" }
    return "paused"
  }

  private func currentTime() -> Double {
    guard let player else { return 0 }
    let seconds = player.currentTime().seconds
    return seconds.isFinite ? max(0, seconds) : 0
  }

  private func currentDuration() -> Double {
    guard let duration = player?.currentItem?.duration.seconds, duration.isFinite else {
      return pendingMedia?.duration ?? 0
    }
    return max(0, duration)
  }

  private func mediaUrl(from uri: String) -> URL? {
    if let url = URL(string: uri), url.scheme != nil {
      return url
    }
    return URL(fileURLWithPath: uri)
  }

  private func updateNowPlaying(title: String, subtitle: String, artworkUrl: String, currentTime: Double, duration: Double, playbackRate: Double) {
    var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
    info[MPMediaItemPropertyTitle] = title
    info[MPMediaItemPropertyArtist] = subtitle
    info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = max(0, currentTime)
    if duration > 0 {
      info[MPMediaItemPropertyPlaybackDuration] = duration
    }
    info[MPNowPlayingInfoPropertyPlaybackRate] = playbackRate
    MPNowPlayingInfoCenter.default().nowPlayingInfo = info

    guard let url = URL(string: artworkUrl), !artworkUrl.isEmpty else { return }
    URLSession.shared.dataTask(with: url) { data, _, _ in
      guard let data, let image = UIImage(data: data) else { return }
      let artwork = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
      DispatchQueue.main.async {
        var updated = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
        updated[MPMediaItemPropertyArtwork] = artwork
        MPNowPlayingInfoCenter.default().nowPlayingInfo = updated
      }
    }.resume()
  }

  private func updateNowPlayingPlaybackState(_ playbackState: String) {
    var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
    info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = currentTime()
    info[MPNowPlayingInfoPropertyPlaybackRate] = playbackState == "playing" ? 1 : 0
    let duration = currentDuration()
    if duration > 0 {
      info[MPMediaItemPropertyPlaybackDuration] = duration
    }
    MPNowPlayingInfoCenter.default().nowPlayingInfo = info
  }

  private static func findButton(in view: UIView) -> UIButton? {
    if let button = view as? UIButton { return button }
    for subview in view.subviews {
      if let button = findButton(in: subview) { return button }
    }
    return nil
  }
}
