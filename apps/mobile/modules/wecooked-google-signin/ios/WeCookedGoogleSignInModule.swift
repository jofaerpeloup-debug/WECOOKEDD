import ExpoModulesCore
import GoogleSignIn
import UIKit

// ---------------------------------------------------------------------------
// WeCooked Google Sign-In — iOS native implementation (B4.2A).
//
// SECURITY / SCOPE NOTES (see docs/architecture/mobile-google-sign-in.md):
//   * Public surface is exactly signIn({ nonce }) -> { idToken } and
//     clearState() -> void. Nothing else crosses the bridge.
//   * The raw 43-char base64url nonce is validated and passed to the current
//     interactive GoogleSignIn `nonce:` API UNTRANSFORMED — no trim, no hashing
//     (no SHA), no re-encoding.
//   * Only `result.user.idToken.tokenString` is read. serverAuthCode / access
//     token / refresh token / profile / email / sub / scopes are never read,
//     returned, or logged.
//   * No UserDefaults, no restorePreviousSignIn, no currentUser path, no
//     refreshTokensIfNeeded, no disconnect, no revoke.
//   * The nonce and the token are NEVER logged.
//   * After copying the JWT to a local, GIDSignIn.signOut() is called
//     best-effort; the copied JWT stays valid for the backend exchange.
//   * NOT build-verified in B4.2A — static review only.
// ---------------------------------------------------------------------------

private let nonceRegex = try! NSRegularExpression(pattern: "^[A-Za-z0-9_-]{43}$")

private enum GoogleCode: String {
  case cancelled = "GOOGLE_CANCELLED"
  case inProgress = "GOOGLE_IN_PROGRESS"
  case notConfigured = "GOOGLE_NOT_CONFIGURED"
  case unavailable = "GOOGLE_UNAVAILABLE"
  case providerFailed = "GOOGLE_PROVIDER_FAILED"

  var safeMessage: String {
    switch self {
    case .cancelled: return "Google sign-in was cancelled."
    case .inProgress: return "A Google sign-in is already in progress."
    case .notConfigured: return "Google sign-in is not configured in this build."
    case .unavailable: return "Google sign-in is not available right now."
    case .providerFailed: return "Google sign-in did not complete."
    }
  }
}

// Only a stable WeCooked code + fixed safe message crosses the bridge.
// NSError.localizedDescription / Google internal payloads are discarded.
private final class GoogleSignInException: Exception {
  private let providedCode: String
  private let providedReason: String

  init(_ code: GoogleCode) {
    self.providedCode = code.rawValue
    self.providedReason = code.safeMessage
    super.init()
  }

  override var code: String { providedCode }
  override var reason: String { providedReason }
}

private func nonceIsValid(_ value: String) -> Bool {
  let range = NSRange(value.startIndex..., in: value)
  return nonceRegex.firstMatch(in: value, range: range) != nil
}

public class WeCookedGoogleSignInModule: Module {
  // Defensive native in-progress guard (correctness). Authoritative single-flight
  // is in JS (src/auth/googleAuthFlow.js). Cleared on EVERY terminal path.
  private var inProgress = false

  public func definition() -> ModuleDefinition {
    Name("WeCookedGoogleSignIn")

    AsyncFunction("signIn") { (options: SignInOptions, promise: Promise) in
      if self.inProgress {
        promise.reject(GoogleSignInException(.inProgress))
        return
      }

      let rawNonce = options.nonce
      // Validate the runtime nonce BEFORE calling Google. No trim / transform /
      // hash. The nonce value never appears in an error.
      guard nonceIsValid(rawNonce) else {
        promise.reject(GoogleSignInException(.providerFailed))
        return
      }

      // Build-time config: GIDClientID (iOS OAuth client) is read by the SDK
      // from Info.plist; GIDServerClientID (Web/server OAuth client) is the
      // serverClientID that produces the backend-verified `aud`.
      guard
        let infoPlist = Bundle.main.infoDictionary,
        let clientID = infoPlist["GIDClientID"] as? String,
        !clientID.isEmpty,
        let serverClientID = infoPlist["GIDServerClientID"] as? String,
        !serverClientID.isEmpty
      else {
        promise.reject(GoogleSignInException(.notConfigured))
        return
      }

      guard let presentingViewController = Self.foregroundPresentingViewController() else {
        promise.reject(GoogleSignInException(.unavailable))
        return
      }

      self.inProgress = true
      GIDSignIn.sharedInstance.configuration = GIDConfiguration(
        clientID: clientID,
        serverClientID: serverClientID
      )

      GIDSignIn.sharedInstance.signIn(
        withPresenting: presentingViewController,
        hint: nil,
        additionalScopes: nil,
        nonce: rawNonce
      ) { signInResult, error in
        defer { self.inProgress = false }

        if let error = error {
          // Map to GOOGLE_CANCELLED ONLY for a genuine Google Sign-In
          // cancellation: require BOTH the Google Sign-In error domain
          // (kGIDSignInErrorDomain) AND the `.canceled` code. A non-Google
          // NSError that merely shares the numeric code is NOT a cancellation
          // and falls through to GOOGLE_PROVIDER_FAILED.
          // NSError.localizedDescription / Google payloads are never surfaced.
          let nsError = error as NSError
          let isGoogleCancellation =
            nsError.domain == kGIDSignInErrorDomain
            && nsError.code == GIDSignInError.canceled.rawValue
          if isGoogleCancellation {
            promise.reject(GoogleSignInException(.cancelled))
          } else {
            promise.reject(GoogleSignInException(.providerFailed))
          }
          return
        }

        // Read ONLY the ID token string. Nothing else.
        guard
          let idTokenString = signInResult?.user.idToken?.tokenString,
          !idTokenString.isEmpty
        else {
          promise.reject(GoogleSignInException(.providerFailed))
          return
        }

        // Copy to a local; the JWT stays valid after a local sign-out.
        let idToken = idTokenString
        GIDSignIn.sharedInstance.signOut()

        promise.resolve(["idToken": idToken])
      }
    }
    .runOnQueue(.main)

    AsyncFunction("clearState") { (promise: Promise) in
      // WeCooked logout hygiene only. Best-effort. Never disconnect / revoke.
      GIDSignIn.sharedInstance.signOut()
      self.inProgress = false
      promise.resolve(nil)
    }
    .runOnQueue(.main)
  }

  private static func foregroundPresentingViewController() -> UIViewController? {
    let scene = UIApplication.shared.connectedScenes
      .first { $0.activationState == .foregroundActive } as? UIWindowScene
    let keyWindow = scene?.windows.first { $0.isKeyWindow } ?? scene?.windows.first
    var top = keyWindow?.rootViewController
    while let presented = top?.presentedViewController {
      top = presented
    }
    return top
  }
}

struct SignInOptions: Record {
  @Field
  var nonce: String = ""
}