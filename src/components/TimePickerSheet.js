import React, { useMemo, useRef, useState, useEffect } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Modal,
  Animated,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';

const ITEM_H = 40;
const VISIBLE = 5; // odd — rows shown in the wheel
const PAD = ITEM_H * ((VISIBLE - 1) / 2);

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);
const PERIODS = ['AM', 'PM'];

export function fmtClock(value) {
  if (!value) return '';
  const [h, m] = value.split(':').map(Number);
  const period = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

// One scroll wheel. Snaps to the nearest row on release and reports its index.
function Wheel({ data, initialIndex, onIndexChange, format, width, styles }) {
  const ref = useRef(null);
  const scrollY = useRef(new Animated.Value(initialIndex * ITEM_H)).current;
  const committed = useRef(initialIndex);
  const snapTimer = useRef(null);

  useEffect(() => {
    const t = setTimeout(() => {
      ref.current?.scrollTo({ y: initialIndex * ITEM_H, animated: false });
    }, 40);
    return () => {
      clearTimeout(t);
      clearTimeout(snapTimer.current);
    };
  }, [initialIndex]);

  const settle = (y) => {
    const i = Math.max(0, Math.min(data.length - 1, Math.round(y / ITEM_H)));
    if (i !== committed.current) {
      committed.current = i;
      onIndexChange(i);
    }
    if (Math.abs(y - i * ITEM_H) > 0.5) {
      ref.current?.scrollTo({ y: i * ITEM_H, animated: true });
    }
  };

  const onScroll = Animated.event(
    [{ nativeEvent: { contentOffset: { y: scrollY } } }],
    {
      useNativeDriver: Platform.OS !== 'web',
      listener: (e) => {
        const y = e.nativeEvent.contentOffset.y;
        clearTimeout(snapTimer.current);
        snapTimer.current = setTimeout(() => settle(y), 120);
      },
    }
  );

  return (
    <Animated.ScrollView
      ref={ref}
      style={{ width, height: ITEM_H * VISIBLE }}
      showsVerticalScrollIndicator={false}
      snapToInterval={ITEM_H}
      decelerationRate="fast"
      scrollEventThrottle={16}
      onScroll={onScroll}
      onMomentumScrollEnd={(e) => settle(e.nativeEvent.contentOffset.y)}
      contentOffset={{ x: 0, y: initialIndex * ITEM_H }}
      contentContainerStyle={{ paddingVertical: PAD }}
      nestedScrollEnabled
    >
      {data.map((v, i) => {
        const input = [
          (i - 2) * ITEM_H,
          (i - 1) * ITEM_H,
          i * ITEM_H,
          (i + 1) * ITEM_H,
          (i + 2) * ITEM_H,
        ];
        const opacity = scrollY.interpolate({
          inputRange: input,
          outputRange: [0.2, 0.45, 1, 0.45, 0.2],
          extrapolate: 'clamp',
        });
        const scale = scrollY.interpolate({
          inputRange: input,
          outputRange: [0.82, 0.9, 1, 0.9, 0.82],
          extrapolate: 'clamp',
        });
        return (
          <Animated.View key={i} style={[styles.item, { opacity, transform: [{ scale }] }]}>
            <Text style={styles.itemText}>{format ? format(v) : String(v)}</Text>
          </Animated.View>
        );
      })}
    </Animated.ScrollView>
  );
}

function TimeBody({ day, mealTitle, currentTime, onSelect, onTest, styles, colors }) {
  const init = useMemo(() => {
    let h = 18;
    let m = 0;
    if (currentTime) {
      const [hh, mm] = currentTime.split(':').map(Number);
      h = hh;
      m = mm;
    }
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return { hourIdx: HOURS.indexOf(h12), minIdx: m, perIdx: h >= 12 ? 1 : 0 };
  }, [currentTime]);

  const [hourIdx, setHourIdx] = useState(init.hourIdx);
  const [minIdx, setMinIdx] = useState(init.minIdx);
  const [perIdx, setPerIdx] = useState(init.perIdx);

  const hour24 = useMemo(() => {
    const h12 = HOURS[hourIdx];
    if (perIdx === 1) return h12 === 12 ? 12 : h12 + 12;
    return h12 === 12 ? 0 : h12;
  }, [hourIdx, perIdx]);
  const minute = MINUTES[minIdx];
  const preview = fmtClock(
    `${String(hour24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  );

  const fadeColor = colors.paper;
  const transparent = `${fadeColor}00`;

  return (
    <>
      <Text style={styles.subtitle}>
        {mealTitle
          ? `We'll notify you every ${day} when it's time to cook ${mealTitle} — even if the app is closed.`
          : `Pick a time for ${day}.`}
      </Text>

      <View style={styles.wheelsWrap}>
        <View style={styles.selectionBand} pointerEvents="none" />
        <Wheel
          data={HOURS}
          initialIndex={init.hourIdx}
          onIndexChange={setHourIdx}
          width={54}
          styles={styles}
        />
        <Text style={styles.colon}>:</Text>
        <Wheel
          data={MINUTES}
          initialIndex={init.minIdx}
          onIndexChange={setMinIdx}
          format={(v) => String(v).padStart(2, '0')}
          width={54}
          styles={styles}
        />
        <Wheel
          data={PERIODS}
          initialIndex={init.perIdx}
          onIndexChange={setPerIdx}
          width={58}
          styles={styles}
        />
        <LinearGradient
          colors={[fadeColor, transparent]}
          style={[styles.fade, styles.fadeTop]}
          pointerEvents="none"
        />
        <LinearGradient
          colors={[transparent, fadeColor]}
          style={[styles.fade, styles.fadeBottom]}
          pointerEvents="none"
        />
      </View>

      <Text style={styles.preview}>Reminder set for {preview}</Text>

      <View style={styles.actionsRow}>
        {!!currentTime && (
          <Pressable style={styles.linkBtn} onPress={() => onSelect(null)}>
            <Ionicons name="notifications-off-outline" size={14} color={colors.error} />
            <Text style={styles.removeText}>Remove</Text>
          </Pressable>
        )}
        {!!onTest && (
          <Pressable style={styles.linkBtn} onPress={onTest}>
            <Ionicons name="paper-plane-outline" size={14} color={colors.sageDeep} />
            <Text style={styles.testText}>Send a test</Text>
          </Pressable>
        )}
      </View>

      <Pressable style={styles.done} onPress={() => onSelect({ hour: hour24, minute })}>
        <Text style={styles.doneText}>Done</Text>
      </Pressable>
    </>
  );
}

/**
 * Bottom sheet with a scroll-wheel time picker for a planned meal's cook
 * reminder. `onSelect` gets { hour, minute } (24h) on Done, or `null` to
 * remove the reminder.
 */
export default function TimePickerSheet({ visible, onClose, day, mealTitle, currentTime, onSelect, onTest }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.xl) }]}>
        <View style={styles.grabber} />
        <Text style={styles.title}>Cook reminder</Text>
        {visible && (
          <TimeBody
            day={day}
            mealTitle={mealTitle}
            currentTime={currentTime}
            onSelect={onSelect}
            onTest={onTest}
            styles={styles}
            colors={colors}
          />
        )}
      </View>
    </Modal>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.overlay },
    sheet: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: colors.paper,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.md,
    },
    grabber: {
      alignSelf: 'center',
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.hairline,
      marginBottom: spacing.lg,
    },
    title: { fontFamily: typography.display.fontFamily, fontSize: 18, color: colors.ink },
    subtitle: {
      fontFamily: typography.body.fontFamily,
      fontSize: 12.5,
      color: colors.inkSoft,
      lineHeight: 18,
      marginTop: 4,
      marginBottom: spacing.md,
    },
    wheelsWrap: {
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      gap: 2,
      height: ITEM_H * VISIBLE,
      position: 'relative',
    },
    selectionBand: {
      position: 'absolute',
      left: 20,
      right: 20,
      top: PAD,
      height: ITEM_H,
      borderRadius: radius.md,
      backgroundColor: colors.creamDeep,
    },
    colon: {
      fontFamily: typography.display.fontFamily,
      fontSize: 22,
      color: colors.ink,
      marginBottom: 3,
    },
    item: { height: ITEM_H, alignItems: 'center', justifyContent: 'center' },
    itemText: {
      fontFamily: typography.display.fontFamily,
      fontSize: 22,
      color: colors.ink,
    },
    fade: { position: 'absolute', left: 0, right: 0, height: ITEM_H * 2 },
    fadeTop: { top: 0 },
    fadeBottom: { bottom: 0 },
    preview: {
      fontFamily: typography.body.medium,
      fontSize: 12.5,
      color: colors.inkFaint,
      textAlign: 'center',
      marginTop: spacing.md,
      marginBottom: spacing.xs,
    },
    actionsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.xl,
      paddingVertical: spacing.sm,
      minHeight: 20,
    },
    linkBtn: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    removeText: { fontFamily: typography.body.semibold, fontSize: 13, color: colors.error },
    testText: { fontFamily: typography.body.semibold, fontSize: 13, color: colors.sageDeep },
    done: {
      marginTop: spacing.sm,
      height: 50,
      borderRadius: radius.pill,
      backgroundColor: colors.sageDeep,
      alignItems: 'center',
      justifyContent: 'center',
    },
    doneText: { fontFamily: typography.body.semibold, fontSize: 14, color: colors.onAccent },
  });
}
