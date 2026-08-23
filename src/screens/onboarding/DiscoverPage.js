import React from 'react';
import { View, Text, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { recipes } from '../../data/mockData';
import { SectionHeading, MiniFrame, Bar, previewStyles as p, pageTextStyles as pt } from './shared';

const featured = recipes[0];
const cards = [recipes[1], recipes[2]];

export default function DiscoverPage() {
  return (
    <>
      <SectionHeading line1="Step 1 — Discover" line2="One Search, Every Recipe" />
      <Text style={pt.sub}>
        The system connects thousands of recipes to one search bar, so you can find exactly what to cook next.
      </Text>
      <View style={pt.previewWrap}>
        <MiniFrame>
          <View style={p.searchRow}>
            <Ionicons name="search" size={13} color="rgba(255,255,255,0.4)" />
            <Bar width={90} height={7} />
            <View style={p.filterDot}>
              <Ionicons name="options-outline" size={11} color="#fff" />
            </View>
          </View>

          <View style={p.rowBetween}>
            <Text style={p.label}>Popular Recipes</Text>
            <Text style={p.link}>See all</Text>
          </View>

          <View style={p.card}>
            <View style={p.cardImageWrap}>
              <Image source={{ uri: featured.image }} style={p.cardImage} />
              <View style={p.heartDot}>
                <Ionicons name="heart-outline" size={11} color="#fff" />
              </View>
            </View>
            <Text style={p.cardTitle} numberOfLines={1}>
              {featured.title}
            </Text>
            <View style={p.metaRow}>
              <Ionicons name="time-outline" size={9} color="rgba(255,255,255,0.45)" />
              <Text style={p.metaText}>{featured.time}</Text>
              <Ionicons name="star-outline" size={9} color="rgba(255,255,255,0.45)" />
              <Text style={p.metaText}>Score {featured.score}</Text>
            </View>
          </View>

          <View style={p.cardRow}>
            {cards.map((r) => (
              <View key={r.id} style={p.cardHalf}>
                <Image source={{ uri: r.image }} style={p.cardImageSmall} />
                <Text style={p.cardTitle} numberOfLines={1}>
                  {r.title}
                </Text>
                <View style={p.metaRow}>
                  <Ionicons name="time-outline" size={8} color="rgba(255,255,255,0.45)" />
                  <Text style={p.metaText}>{r.time}</Text>
                </View>
              </View>
            ))}
          </View>

          <View style={p.rowBetween}>
            <Text style={p.label}>Categories</Text>
          </View>
          <View style={p.chipRow}>
            <View style={p.chip} />
            <View style={p.chip} />
            <View style={[p.chip, p.chipActive]} />
            <View style={p.chip} />
            <View style={p.chip} />
          </View>
        </MiniFrame>
      </View>
    </>
  );
}
