import { Alert, Platform } from 'react-native';

// react-native-web has no <Alert> implementation, so Alert.alert() is a
// silent no-op on web — which broke confirm dialogs like "Log out". These
// helpers fall back to the browser's window.confirm / window.alert on web.

export function confirm(
  title,
  message,
  onConfirm,
  { confirmLabel = 'OK', cancelLabel = 'Cancel', destructive = false } = {}
) {
  if (Platform.OS === 'web') {
    const text = message ? `${title}\n\n${message}` : title;
    // eslint-disable-next-line no-alert
    if (typeof window !== 'undefined' && window.confirm(text)) onConfirm?.();
    return;
  }
  Alert.alert(title, message, [
    { text: cancelLabel, style: 'cancel' },
    { text: confirmLabel, style: destructive ? 'destructive' : 'default', onPress: () => onConfirm?.() },
  ]);
}

export function notify(title, message, onDismiss) {
  if (Platform.OS === 'web') {
    const text = message ? `${title}\n\n${message}` : title;
    // eslint-disable-next-line no-alert
    if (typeof window !== 'undefined') window.alert(text);
    onDismiss?.();
    return;
  }
  Alert.alert(title, message, [{ text: 'OK', onPress: () => onDismiss?.() }]);
}
