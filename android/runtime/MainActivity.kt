package me.maxistar.keyboardhelper.companion

import android.os.Bundle
import android.graphics.Color
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowCompat
import kotlin.math.max

class MainActivity : TauriActivity() {
  private data class SafeInsets(val top: Int = 0, val right: Int = 0, val bottom: Int = 0, val left: Int = 0) {
    fun asJson() = "{\\\"top\\\":$top,\\\"right\\\":$right,\\\"bottom\\\":$bottom,\\\"left\\\":$left}"
  }

  private var safeInsets = SafeInsets()
  private var companionWebView: WebView? = null

  private inner class SafeInsetsBridge {
    @JavascriptInterface
    fun snapshot(): String = safeInsets.asJson()
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    WindowCompat.setDecorFitsSystemWindows(window, false)
    window.statusBarColor = Color.TRANSPARENT
    window.navigationBarColor = Color.TRANSPARENT
    WindowCompat.getInsetsController(window, window.decorView).apply {
      isAppearanceLightStatusBars = false
      isAppearanceLightNavigationBars = false
    }

    ViewCompat.setOnApplyWindowInsetsListener(window.decorView) { _, windowInsets ->
      val systemBars = windowInsets.getInsets(
        WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout(),
      )
      val mandatoryGestures = windowInsets.getInsets(WindowInsetsCompat.Type.mandatorySystemGestures())
      safeInsets = SafeInsets(
        top = max(systemBars.top, mandatoryGestures.top),
        right = max(systemBars.right, mandatoryGestures.right),
        bottom = max(systemBars.bottom, mandatoryGestures.bottom),
        left = max(systemBars.left, mandatoryGestures.left),
      )
      publishSafeInsets()
      windowInsets
    }
    ViewCompat.requestApplyInsets(window.decorView)
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    companionWebView = webView
    webView.addJavascriptInterface(SafeInsetsBridge(), "KeyboardHelperSafeInsets")
    publishSafeInsets()
  }

  private fun publishSafeInsets() {
    val snapshot = safeInsets.asJson()
    companionWebView?.post {
      companionWebView?.evaluateJavascript(
        "window.__keyboardHelperSafeInsets=$snapshot;window.dispatchEvent(new CustomEvent('keyboardhelper:insetschange',{detail:window.__keyboardHelperSafeInsets}));",
        null,
      )
    }
  }
}
