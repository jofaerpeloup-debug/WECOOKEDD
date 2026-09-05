import React from 'react';
import { View, Text, Pressable, StyleSheet, Modal } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { typography, spacing, radius } from '../theme/theme';
import { useTheme } from '../theme/ThemeContext';

const ITEMS = [
  {
    route: 'Assistant',
    icon: 'chef-hat',
    mci: true,
    title: 'Ask the Chef',
    sub: 'Recipe ideas, ingredient swaps, help.',
  },
  {
    route: 'MealPlan',
    icon: 'calendar-outline',
    title: 'Meal Plan',
    sub: 'Plan your week and build a grocery list.',
  },
];

export default function PlusMenu({ visible, onClose, navigation }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors);

  const go = (route) => {
    onClose();
    navigation.navigate(route);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.xl) }]}>
        <View style={styles.grabber} />
        {ITEMS.map((it) => (
          <Pressable key={it.route} style={styles.row} onPress={() => go(it.route)}>
            <View style={styles.iconWrap}>
              {it.mci ? (
                <MaterialCommunityIcons name={it.icon} size={20} color={colors.sageDeep} />
              ) : (
                <Ionicons name={it.icon} size={20} color={colors.sageDeep} />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{it.title}</Text>
              <Text style={styles.sub}>{it.sub}</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.inkFaint} />
          </Pressable>
        ))}
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
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      paddingVertical: spacing.md,
    },
    iconWrap: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.sagePale,
      alignItems: 'center',
      justifyContent: 'center',
    },
    title: { fontFamily: typography.display.fontFamily, fontSize: 16, color: colors.ink },
    sub: { fontFamily: typography.body.fontFamily, fontSize: 12, color: colors.inkSoft, marginTop: 2 },
  });
}
