package expo.modules.readmateairplay

import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.view.ViewGroup
import androidx.core.os.bundleOf
import androidx.mediarouter.app.MediaRouteButton
import com.google.android.gms.cast.CastDevice
import com.google.android.gms.cast.MediaInfo
import com.google.android.gms.cast.MediaLoadRequestData
import com.google.android.gms.cast.MediaMetadata
import com.google.android.gms.cast.MediaStatus
import com.google.android.gms.cast.framework.CastButtonFactory
import com.google.android.gms.cast.framework.CastContext
import com.google.android.gms.cast.framework.CastSession
import com.google.android.gms.cast.framework.SessionManagerListener
import com.google.android.gms.cast.framework.media.RemoteMediaClient
import com.google.android.gms.common.images.WebImage
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlin.math.max

private data class OutputMedia(
  val uri: String,
  val title: String,
  val subtitle: String,
  val artworkUrl: String,
  val currentTime: Double,
  val duration: Double
)

class ReadMateAirPlayModule : Module() {
  private val mainHandler = Handler(Looper.getMainLooper())
  private var castContext: CastContext? = null
  private var pendingMedia: OutputMedia? = null
  private var observedClient: RemoteMediaClient? = null

  private val statusPoll = object : Runnable {
    override fun run() {
      emitCastState()
      if (castContext?.sessionManager?.currentCastSession?.isConnected == true) {
        mainHandler.postDelayed(this, 750)
      }
    }
  }

  private val remoteCallback = object : RemoteMediaClient.Callback() {
    override fun onStatusUpdated() = emitCastState()
    override fun onMetadataUpdated() = emitCastState()
    override fun onPreloadStatusUpdated() = emitCastState()
    override fun onQueueStatusUpdated() = emitCastState()
  }

  private val sessionListener = object : SessionManagerListener<CastSession> {
    override fun onSessionStarted(session: CastSession, sessionId: String) = onCastConnected(session)
    override fun onSessionResumed(session: CastSession, wasSuspended: Boolean) = onCastConnected(session)
    override fun onSessionEnded(session: CastSession, error: Int) = onCastDisconnected()
    override fun onSessionSuspended(session: CastSession, reason: Int) = onCastDisconnected()
    override fun onSessionStartFailed(session: CastSession, error: Int) = emitCastError("Could not connect to the cast device.")
    override fun onSessionResumeFailed(session: CastSession, error: Int) = emitCastError("Could not resume the cast session.")
    override fun onSessionStarting(session: CastSession) = Unit
    override fun onSessionEnding(session: CastSession) = Unit
    override fun onSessionResuming(session: CastSession, sessionId: String) = Unit
  }

  override fun definition() = ModuleDefinition {
    Name("ReadMateAirPlay")
    Events("onOutputStateChanged")

    OnDestroy {
      mainHandler.removeCallbacks(statusPoll)
      observedClient?.unregisterCallback(remoteCallback)
      castContext?.sessionManager?.removeSessionManagerListener(sessionListener, CastSession::class.java)
    }

    Function("showPicker") { uri: String, title: String, subtitle: String, artworkUrl: String, currentTime: Double, duration: Double ->
      pendingMedia = OutputMedia(uri, title, subtitle, artworkUrl, currentTime, duration)
      appContext.currentActivity?.let { activity ->
        activity.runOnUiThread {
          val root = activity.findViewById<ViewGroup>(android.R.id.content) ?: return@runOnUiThread
          try {
            val context = ensureCastContext(activity)
            if (context.sessionManager.currentCastSession?.isConnected == true) {
              loadPendingMedia()
            }
            val routeButton = MediaRouteButton(activity).apply {
              alpha = 0.01f
              layoutParams = ViewGroup.LayoutParams(1, 1)
            }
            CastButtonFactory.setUpMediaRouteButton(activity.applicationContext, routeButton)
            root.addView(routeButton)
            routeButton.post {
              routeButton.performClick()
              routeButton.postDelayed({ root.removeView(routeButton) }, 1_000)
            }
          } catch (error: Throwable) {
            emitCastError(error.message ?: "Chromecast is unavailable on this device.")
          }
        }
      }
    }

    Function("loadMedia") { uri: String, title: String, subtitle: String, artworkUrl: String, currentTime: Double, duration: Double ->
      pendingMedia = OutputMedia(uri, title, subtitle, artworkUrl, currentTime, duration)
      appContext.currentActivity?.runOnUiThread { loadPendingMedia() }
    }

    Function("sendCommand") { command: String, value: Double ->
      appContext.currentActivity?.runOnUiThread {
        val client = castContext?.sessionManager?.currentCastSession?.remoteMediaClient ?: return@runOnUiThread
        when (command) {
          "play" -> client.play()
          "pause" -> client.pause()
          "stop" -> client.stop()
          "seekBy" -> client.seek(max(0L, client.approximateStreamPosition + (value * 1_000).toLong()))
        }
        mainHandler.postDelayed({ emitCastState() }, 200)
      }
    }
  }

  private fun ensureCastContext(activity: android.app.Activity): CastContext {
    castContext?.let { return it }
    val context = CastContext.getSharedInstance(activity)
    context.sessionManager.addSessionManagerListener(sessionListener, CastSession::class.java)
    castContext = context
    context.sessionManager.currentCastSession?.takeIf { it.isConnected }?.let { onCastConnected(it) }
    return context
  }

  private fun onCastConnected(session: CastSession) {
    observe(session.remoteMediaClient)
    emitCastState()
    loadPendingMedia()
    mainHandler.removeCallbacks(statusPoll)
    mainHandler.post(statusPoll)
  }

  private fun onCastDisconnected() {
    mainHandler.removeCallbacks(statusPoll)
    observedClient?.unregisterCallback(remoteCallback)
    observedClient = null
    sendEvent("onOutputStateChanged", bundleOf("connected" to false, "platform" to "local", "isScreen" to false))
  }

  private fun observe(client: RemoteMediaClient?) {
    if (observedClient === client) return
    observedClient?.unregisterCallback(remoteCallback)
    observedClient = client
    client?.registerCallback(remoteCallback)
  }

  private fun loadPendingMedia() {
    val media = pendingMedia ?: return
    val session = castContext?.sessionManager?.currentCastSession ?: return
    if (!session.isConnected || media.uri.isBlank()) return
    try {
      val castUri = Uri.parse(media.uri)
      require(castUri.scheme == "https") { "ReadMate requires a secure HTTPS audio URL for Chromecast." }
      val metadata = MediaMetadata(MediaMetadata.MEDIA_TYPE_MUSIC_TRACK).apply {
        putString(MediaMetadata.KEY_TITLE, media.title)
        putString(MediaMetadata.KEY_ARTIST, media.subtitle)
        if (media.artworkUrl.isNotBlank()) addImage(WebImage(Uri.parse(media.artworkUrl)))
      }
      val mediaInfo = MediaInfo.Builder(media.uri)
        .setStreamType(MediaInfo.STREAM_TYPE_BUFFERED)
        .setContentType("audio/mpeg")
        .setMetadata(metadata)
        .build()
      val request = MediaLoadRequestData.Builder()
        .setMediaInfo(mediaInfo)
        .setAutoplay(true)
        .setCurrentTime(max(0L, (media.currentTime * 1_000).toLong()))
        .build()
      val client = session.remoteMediaClient ?: return
      observe(client)
      client.load(request).setResultCallback { result ->
        if (!result.status.isSuccess) {
          emitCastError(result.status.statusMessage ?: "The cast device could not load the prepared audio.")
        }
      }
      emitCastState("loading")
    } catch (error: Throwable) {
      emitCastError(error.message ?: "ReadMate could not send this audio to the cast device.")
    }
  }

  private fun emitCastState(forcedState: String? = null) {
    val session = castContext?.sessionManager?.currentCastSession
    val client = session?.remoteMediaClient
    if (session?.isConnected != true || client == null) return
    val status = client.mediaStatus
    val playbackState = forcedState ?: when (status?.playerState) {
      MediaStatus.PLAYER_STATE_BUFFERING -> "loading"
      MediaStatus.PLAYER_STATE_PLAYING -> "playing"
      MediaStatus.PLAYER_STATE_PAUSED -> "paused"
      MediaStatus.PLAYER_STATE_IDLE -> if (status.idleReason == MediaStatus.IDLE_REASON_FINISHED) "completed" else "idle"
      else -> "idle"
    }
    val device = session.castDevice
    sendEvent(
      "onOutputStateChanged",
      bundleOf(
        "connected" to true,
        "platform" to "chromecast",
        "deviceName" to (device?.friendlyName ?: "Cast device"),
        "isScreen" to (device?.hasCapability(CastDevice.CAPABILITY_VIDEO_OUT) == true),
        "playbackState" to playbackState,
        "currentTime" to (client.approximateStreamPosition / 1_000.0),
        "duration" to (client.streamDuration / 1_000.0)
      )
    )
  }

  private fun emitCastError(message: String) {
    sendEvent(
      "onOutputStateChanged",
      bundleOf(
        "connected" to (castContext?.sessionManager?.currentCastSession?.isConnected == true),
        "platform" to "chromecast",
        "playbackState" to "error",
        "error" to message
      )
    )
  }
}
