import React from "react";
import { Pressable, Text, StyleSheet, View } from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";
import * as Haptics from "expo-haptics";
import { colors, fonts, radius, spacing, type as tType } from "@/src/theme";
import type { IconName } from "@/src/icons";

type Props = {
  label: string;
  icon?: IconName;
  active?: boolean;
  onPress?: () => void;
  testID?: string;
};

export function Chip({ label, icon, active, onPress, testID }: Props) {
  return (
    <Pressable
      testID={testID}
      onPress={() => {
        Haptics.selectionAsync();
        onPress?.();
      }}
      style={[styles.chip, active && styles.chipActive]}
    >
      {icon ? (
        <Ionicons
          name={icon}
          size={16}
          color={active ? colors.onBrandPrimary : colors.onSurface}
          style={{ marginRight: 6 }}
        />
      ) : null}
      <Text style={[styles.label, active && styles.labelActive]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    height: 38,
    flexShrink: 0,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
  },
  chipActive: {
    backgroundColor: colors.brandPrimary,
    borderColor: colors.brandPrimary,
  },
  label: {
    fontFamily: fonts.bodySemi,
    fontSize: tType.sm,
    color: colors.onSurface,
  },
  labelActive: {
    color: colors.onBrandPrimary,
  },
});
