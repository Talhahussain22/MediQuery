import React, { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

export default function AuthInput({ s, label, secure, ...props }) {
  const [hidden, setHidden] = useState(true);

  return (
    <>
      <Text style={s.label}>{label}</Text>
      <View style={s.inputRow}>
        <TextInput
          style={[s.input, secure && { paddingRight: 44 }]}
          placeholderTextColor={s.placeholder.color}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry={secure && hidden}
          {...props}
        />
        {secure && (
          <Pressable style={s.eyeButton} onPress={() => setHidden((h) => !h)} hitSlop={8}>
            <Ionicons name={hidden ? "eye-off" : "eye"} size={22} color={s.icon.color} />
          </Pressable>
        )}
      </View>
    </>
  );
}
