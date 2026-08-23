import React from 'react';
import { View, Text, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { recipes } from '../../data/mockData';
import { SectionHeading, MiniFrame, Bar, previewStyles as p, pageTextStyles as pt } from './shared';

const sampleRecipe = recipes[0];

export default function StepsPage() {
  const steps = sampleRecipe.steps || [];
  return (
    <>
      <SectionHeading line1="Step 2 — Follow" line2="Guided, Start to Finish" />
      <Text style={pt.sub}>
        Every recipe breaks down into clear, numbered steps, so the system walks you through cooking with confidence.
      </Text>
      <View style={pt.previewWrap}>
        <MiniFrame>
          <View style={p.searchRow}>
            <Ionicons name="arrow-back" size={13} color="rgba(255,255,255,0.6)" />
            <Bar width={110} height={7} />
          </View>

          <View style={p.rowBetween}>
            <Text style={p.cardTitle} numberOfLines={1}>
              {sampleRecipe.title}
            </Text>
            <View style={p.metaRow}>
              <Ionicons name="time-outline" size={9} color="rgba(255,255,255,0.45)" />
              <Text style={p.metaText}>{sampleRecipe.time}</Text>
            </View>
          </View>

          <View style={p.tabsRow}>
            <Bar width={54} height={6} color="rgba(255,255,255,0.28)" />
            <View style={{ alignItems: 'center' }}>
              <Bar width={34} height={6} color="#F5821F" />
              <View style={p.tabUnderline} />
            </View>
            <Bar width={40} height={6} color="rgba(255,255,255,0.28)" />
          </View>
          {steps.slice(0, 4).map((s, i) => (
            <View key={i} style={p.stepRow}>
              <View style={p.stepIndex}>
                <Text style={p.stepIndexText}>{i + 1}</Text>
              </View>
              <Image source={{ uri: sampleRecipe.image }} style={p.stepThumb} />
              <View style={{ flex: 1, gap: 5 }}>
                <Text style={p.cardTitle} numberOfLines={1}>
                  {s.title}
                </Text>
                <Bar width={'95%'} height={6} />
              </View>
            </View>
          ))}
        </MiniFrame>
      </View>
    </>
  );
}
