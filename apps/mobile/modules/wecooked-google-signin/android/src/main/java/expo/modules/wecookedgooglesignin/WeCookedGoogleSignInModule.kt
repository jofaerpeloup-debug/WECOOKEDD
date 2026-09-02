package expo.modules.wecookedgooglesignin

import android.content.Context
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.util.concurrent.atomic.AtomicBoolean

// ---------------------------------------------------------------------------
// WeCooked Google Sign-In — Android native implementation (B4.2A).
//
// SECURITY / SCOPE NOTES (see docs/architecture/mobile-google-sign-in.md):
//   * Public surface is exactly signIn({ nonce }) -> { idToken } and
//     clearState() -> void. Nothing else crosses the bridge.
//   * The raw 43-char base64url nonce is validated and passed to Google
//     UNTRANSFORMED — no trim, no hashing (no SHA), no re-encoding.
//   * Only the ID token string is returned. serverAuthCode / access token /
//     profile / email / subject / scopes are never read, returned, or logged.
//   * No SharedPreferences, no saved-state token storage, no module field
//     holding the ID token after resolution, no silent/restore credential path.
//   * The nonce and the token are NEVER logged.
//   * NOT build-verified in B4.2A — static review only.
// ---------------------------------------------------------------------------

private val NONCE_REGEX = Regex("^[A-Za-z0-9_-]{43}$")

private const val CODE_CANCELLED = "GOOGLE_CANCELLED"
private const val CODE_IN_PROGRESS = "GOOGLE_IN_PROGRESS"
private const val CODE_NOT_CONFIGURED = "GOOGLE_NOT_CONFIGURED"
private const val CODE_UNAVAILABLE = "GOOGLE_UNAVAILABLE"
private const val CODE_PROVIDER_FAILED = "GOOGLE_PROVIDER_FAILED"

private fun safeMessageFor(code: String): String = when (code) {
  CODE_CANCELLED -> "Google sign-in was cancelled."
  CODE_IN_PROGRESS -> "A Google sign-in is already in progress."
  CODE_NOT_CONFIGURED -> "Google sign-in is not configured in this build."
  CODE_UNAVAILABLE -> "Google sign-in is not available right now."
  else -> "Google sign-in did not complete."
}

// Only stable WeCooked codes + fixed safe messages ever cross the bridge.
// The provider's own exception text / payloads are deliberately discarded.
private class GoogleSignInException(code: String) :
  CodedException(code, safeMessageFor(code), null)

class SignInOptions : Record {
  @Field
  val nonce: String = ""
}

class WeCookedGoogleSignInModule : Module() {
  // Defensive native in-progress guard. This is a *correctness* guard against a
  // double native operation; the authoritative single-flight lives in JS
  // (src/auth/googleAuthFlow.js). Cleared on EVERY terminal path.
  private val inProgress = AtomicBoolean(false)

  private val context: Context
    get() = appContext.reactContext
      ?: throw GoogleSignInException(CODE_UNAVAILABLE)

  private fun readWebServerClientId(): String {
    val ctx = context
    val resId = ctx.resources.getIdentifier(
      "wecooked_google_web_client_id",
      "string",
      ctx.packageName
    )
    if (resId == 0) {
      throw GoogleSignInException(CODE_NOT_CONFIGURED)
    }
    val value = ctx.getString(resId).trim()
    if (value.isEmpty()) {
      throw GoogleSignInException(CODE_NOT_CONFIGURED)
    }
    return value
  }

  override fun definition() = ModuleDefinition {
    Name("WeCookedGoogleSignIn")

    AsyncFunction("signIn") Coroutine { options: SignInOptions ->
      // Native double-settlement / re-entry guard.
      if (!inProgress.compareAndSet(false, true)) {
        throw GoogleSignInException(CODE_IN_PROGRESS)
      }
      try {
        val rawNonce = options.nonce
        // Validate the runtime nonce shape BEFORE calling Google. Do not trim,
        // transform, or hash. Never put the nonce value in the error.
        if (!NONCE_REGEX.matches(rawNonce)) {
          throw GoogleSignInException(CODE_PROVIDER_FAILED)
        }

        val webServerClientId = readWebServerClientId()

        // Explicit, user-present "Sign in with Google" button flow. The raw
        // nonce is handed to Google as-is; Google signs it into the ID token's
        // `nonce` claim, which the WeCooked backend (B4.1) verifies.
        val googleIdOption = GetSignInWithGoogleOption.Builder(webServerClientId)
          .setNonce(rawNonce)
          .build()

        val request = GetGoogleCredentialRequest(googleIdOption)

        val credentialManager = CredentialManager.create(context)
        val activity = appContext.currentActivity
          ?: throw GoogleSignInException(CODE_UNAVAILABLE)

        val response = try {
          credentialManager.getCredential(activity, request)
        } catch (e: GetCredentialCancellationException) {
          throw GoogleSignInException(CODE_CANCELLED)
        } catch (e: NoCredentialException) {
          throw GoogleSignInException(CODE_PROVIDER_FAILED)
        } catch (e: GetCredentialException) {
          // Credential Manager exception text is NOT surfaced.
          throw GoogleSignInException(CODE_PROVIDER_FAILED)
        }

        val credential = response.credential
        if (credential.type != GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
          throw GoogleSignInException(CODE_PROVIDER_FAILED)
        }

        val googleIdTokenCredential = try {
          GoogleIdTokenCredential.createFrom(credential.data)
        } catch (e: Exception) {
          throw GoogleSignInException(CODE_PROVIDER_FAILED)
        }

        // Copy ONLY the ID token into a local; return immediately. No module
        // field retains it, and no other credential fields are read.
        val idToken = googleIdTokenCredential.idToken
        if (idToken.isNullOrEmpty()) {
          throw GoogleSignInException(CODE_PROVIDER_FAILED)
        }

        // NOTE: clearCredentialState() is deliberately NOT called here. Clearing
        // after every acquisition is a logout-hygiene concern only (clearState).
        mapOf("idToken" to idToken)
      } catch (e: CodedException) {
        throw e
      } catch (e: Throwable) {
        // Unknown native failure -> generic provider failure, fixed message.
        throw GoogleSignInException(CODE_PROVIDER_FAILED)
      } finally {
        inProgress.set(false)
      }
    }

    AsyncFunction("clearState") { promise: Promise ->
      // WeCooked logout hygiene only. Best-effort; failure must never block the
      // WeCooked logout flow (the JS caller ignores rejections).
      try {
        val credentialManager = CredentialManager.create(context)
        credentialManager.clearCredentialStateAsync(
          androidx.credentials.ClearCredentialStateRequest(),
          null,
          java.util.concurrent.Executors.newSingleThreadExecutor(),
          object : androidx.credentials.CredentialManagerCallback<Void?, androidx.credentials.exceptions.ClearCredentialException> {
            override fun onResult(result: Void?) {
              inProgress.set(false)
              promise.resolve(null)
            }

            override fun onError(e: androidx.credentials.exceptions.ClearCredentialException) {
              // Do not surface provider error text.
              inProgress.set(false)
              promise.resolve(null)
            }
          }
        )
      } catch (e: Throwable) {
        inProgress.set(false)
        promise.resolve(null)
      }
    }

    OnDestroy {
      // Module teardown — clear the guard.
      inProgress.set(false)
    }
  }
}

// Small helper so the request construction reads clearly and stays testable in
// isolation during static review.
@Suppress("FunctionName")
private fun GetGoogleCredentialRequest(
  option: GetSignInWithGoogleOption
): GetCredentialRequest =
  GetCredentialRequest.Builder()
    .addCredentialOption(option)
    .build()