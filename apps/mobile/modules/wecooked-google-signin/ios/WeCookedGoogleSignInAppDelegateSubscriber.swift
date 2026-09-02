import ExpoModulesCore
import GoogleSignIn
import UIKit

// Registered via expo-module.config.json -> apple.appDelegateSubscribers.
//
// B4.2A does NOT edit the generated ios/AppDelegate.swift and uses no
// withAppDelegate / withDangerousMod / string replacement. This subscriber is
// the ONLY AppDelegate integration point.
//
// It forwards Google's OAuth callback URLs to GoogleSignIn and returns false for
// anything it does not handle, so the existing `wecooked://` deep-linking
// continues to work unchanged.
public class WeCookedGoogleSignInAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    return GIDSignIn.sharedInstance.handle(url)
  }
}