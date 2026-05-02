// ─────────────────────────────────────────────────────────────────
// ScreenTitle.tsx — eyebrow + large title + optional trailing slot
//
// Used at the top of main screens (Search, Favourites, Profile).
// The `trailing` slot accepts any ReactNode — typically an IconBtn.
// Matches ScreenTitle in components.jsx.
// ─────────────────────────────────────────────────────────────────

import React from 'react';
import { Text, View } from 'react-native';

interface ScreenTitleProps {
  /** Small label above the main title (optional). */
  eyebrow?: string;
  /** The primary large title text. */
  title: string;
  /** Optional node rendered in the top-right (e.g. IconBtn for settings). */
  trailing?: React.ReactNode;
}

export function ScreenTitle({ eyebrow, title, trailing }: ScreenTitleProps) {
  return (
    <View
      style={{
        paddingHorizontal: 20,
        paddingTop: 6,
        paddingBottom: 12,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-end',
      }}
    >
      <View style={{ flex: 1 }}>
        {eyebrow ? (
          <Text
            style={{
              fontFamily: 'Nunito-Bold',
              fontSize: 13,
              color: '#7B8794',
              letterSpacing: 0.1,
            }}
          >
            {eyebrow}
          </Text>
        ) : null}
        <Text
          style={{
            fontFamily: 'Nunito-ExtraBold',
            fontSize: 30,
            color: '#1D2630',
            letterSpacing: -0.6,
            lineHeight: 32,
            marginTop: eyebrow ? 2 : 0,
          }}
          // Allow the title to shrink on very small screens rather than clip.
          adjustsFontSizeToFit
          minimumFontScale={0.8}
        >
          {title}
        </Text>
      </View>

      {trailing ? (
        <View style={{ marginLeft: 12 }}>{trailing}</View>
      ) : null}
    </View>
  );
}
