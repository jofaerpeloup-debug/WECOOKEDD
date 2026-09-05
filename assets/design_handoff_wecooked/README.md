# Handoff: WeCooked — Premium Cooking App

## Overview
WeCooked is a premium mobile cooking app blending a food-magazine aesthetic with a personal cookbook and smart kitchen companion. It covers onboarding, a personalized Home/Discover feed, recipe details, a step-by-step Cooking Mode with timers, Search & Filters, Saved Collections, a Grocery List, and Profile — plus a signature "Cook With What You Have" feature.

## About the Design Files
The bundled `WeCooked.dc.html` file is a **design reference built in HTML** — an interactive prototype showing intended look, content, and behavior. It is not production code to copy directly. The task is to **recreate this design in the target codebase's environment** (React Native, SwiftUI, Flutter, native Android, etc.) using that platform's established patterns and libraries. If no mobile framework exists yet in the target repo, choose the most appropriate one for a cross-platform premium consumer app (React Native or Flutter are reasonable defaults) and implement the designs there.

The prototype uses a generic iOS device frame purely to preview the design at phone scale — do not treat the frame markup itself as anything to port.

## Fidelity
**High-fidelity (hifi).** Colors, typography, spacing, and copy are final as specified below. Recreate the UI pixel-close using the target codebase's component library and platform-native controls (e.g. real navigation stacks/tab bars, real system fonts fallback, real safe-area insets) rather than literally porting HTML/CSS.

## Design Tokens

**Colors**
- Background (espresso): `#0D0908`
- Primary accent (terracotta): `#E94B23`
- Primary text (cream): `#FFF4E6`
- Secondary text (beige): `#C9B8A8`
- Tertiary/muted text: `#8A7A6C`
- Highlight (saffron): `#F2B544`
- Card/surface fill: `rgba(255,244,230,0.04–0.08)` on espresso (subtle warm-white overlays)
- Placeholder image fill: `#1B1411` / `#201510` / `#241811` (warm near-black variants) with a diagonal `repeating-linear-gradient` hairline stripe at `rgba(255,244,230,0.06–0.07)`, 14px repeat
- Borders/dividers: `rgba(255,244,230,0.08)`

**Typography**
- Display/headline font: **Playfair Display** (weights 500/600/700, italic for logo lockup) — recipe titles, section headers, big numbers
- UI/body font: **Work Sans** (weights 400/500/600/700) — body copy, buttons, labels, nav
- Section eyebrow labels: Work Sans, 11.5px, weight 700, letter-spacing 0.1em, uppercase, color `#8A7A6C`
- Body copy: Work Sans 13.5–14px, line-height ~1.55, color `#C9B8A8`

**Spacing / Radius**
- Screen horizontal padding: 20px
- Card radius: 14–20px; pill buttons/chips: fully rounded (999px / 50%)
- Section vertical rhythm: ~24–30px between sections on Home

**Shadows**
- No heavy drop shadows in this design — depth comes from tonal layering (dark surfaces over darker background), not elevation shadows.

## Screens / Views

### 1. Splash
- Full-bleed espresso background with a faint terracotta diagonal-stripe texture overlay.
- Centered: a simple bowl/steam glyph in a circular outline, "WeCooked" wordmark (Playfair Display, italic-capable, 34px, cream), tagline "Cook together, Enjoy together." (Work Sans, 14px, beige).
- Bottom: full-width pill button "Get Started" (terracotta fill, cream text) → advances to Onboarding.

### 2. Onboarding (3 slides)
- Each slide: large placeholder photo card (22px radius) at top, then a headline built from three text runs — first word cream, middle phrase terracotta, last word(s) cream (e.g. "Discover **recipes** you'll love") in Playfair Display 30px, followed by a one-line description in beige.
- Slide 1: "Discover **recipes** you'll love" / "Personalized picks just for your taste."
- Slide 2: "Cook **step by step** with ease" / "Simple instructions, perfect results."
- Slide 3: "Plan **meals & shop** smarter" / "Organize, save and cook stress-free."
- Bottom: 3-dot progress indicator (active dot widens to 24px, terracotta; inactive dots 7px, `rgba(255,244,230,0.2)`), and a circular terracotta "next" button with a right-chevron icon. On slide 3, tapping advances into the app (Home).

### 3. Home / Discover
- Header: italic "WeCooked" wordmark (Playfair Display 22px) + notification bell icon button.
- Greeting: "Good morning, {name}" (beige) + "What shall we cook today?" (Playfair Display 22px, cream).
- Search row: pill search field ("Search recipes, ingredients...") + square terracotta filter-icon button that opens Search & Filters.
- **Today's Feature** — full-width hero card, 190px tall photo placeholder, bottom gradient overlay, "TODAY'S FEATURE" eyebrow (saffron), recipe title (Playfair Display 21px) + time/difficulty meta, circular terracotta play button bottom-right. Tapping opens Recipe Details.
- **What's the vibe?** — horizontal scroll of 4 toggle chips (Cozy / Fresh / Quick / Impress). Selected chip fills terracotta; unselected chips are a subtle translucent cream outline. Selecting filters the Trending section below.
- **Browse by craving** — horizontal row of 4 circular category tiles (Breakfast / Noodles / Ulam / Desserts) with placeholder photo circles + labels. Tapping jumps to Search & Filters pre-filtered by that category.
- **Trending meals** — horizontal scroll of recipe cards (150px wide, 110px photo, title + time/difficulty meta below).
- **Cook With What You Have** — banner card (saffron-tinted outline/fill, 18px radius) with a fridge/book icon, title (Playfair Display 16px), one-line description. Tapping opens the dedicated Cook-With-What-You-Have screen.
- Bottom tab bar (sticky): Home, Search, a raised center "+" quick-action button (terracotta circle, opens Cook-With-What-You-Have), Saved, Profile. Active tab icon/label turns terracotta; inactive stays muted beige-brown.

### 4. Recipe Details
- Full-bleed 280px hero photo placeholder with a back button and save/share buttons overlaid (translucent dark circular buttons), positioned to clear the status bar.
- Title (Playfair Display 24px), star rating + review count, then a 3-up meta row: Time / Difficulty / Yield (servings).
- Description paragraph (beige).
- **Ingredients** list: each row has a terracotta "+" bullet, ingredient name (cream), quantity right-aligned (muted), separated by hairline dividers.
- Sticky bottom CTA: full-width terracotta pill "Start Cooking" with a play icon → enters Cooking Mode.

### 5. Cooking Mode (step-by-step)
- Header: exit/back button + recipe title.
- Step-progress dots row (one per step; filled terracotta = current, translucent terracotta = completed, faint = upcoming).
- **Normal step view**: step photo placeholder, "STEP N" eyebrow (terracotta), step title (Playfair Display 22px), instruction paragraph, a tappable inline timer readout (clock icon + mm:ss in saffron) that opens the **immersive timer view**. Bottom: "Back" (secondary pill) and "Next Step"/"Finish Cooking" (terracotta pill, label changes on the last step) buttons.
- **Immersive timer view** (entered by tapping the timer): centered circular countdown ring (terracotta progress arc over a translucent track), large mm:ss readout (Playfair Display 40px) with a "Running"/"Paused" caption, step title + instruction beneath, and a two-button row: "Cancel" (secondary) / "Pause"–"Resume" (terracotta). Tapping the ring again returns to the normal step view.
- Timers auto-count down once a step is entered; pausing stops the countdown.

### 6. Search & Filters
- Header with back button + "Search" title, search field + "Clear" text action.
- Filter groups, each an eyebrow label + wrapping row of pill toggle chips: **Cuisine/Region** (Luzon / Visayas / Mindanao / Fusion), **Cooking Time** (<15 / 15–30 / 30–60 / >60 min), **Difficulty** (Easy / Medium / Hard), **Dietary** (Vegetarian / Vegan / Gluten Free). Selected chips fill terracotta.
- Results list below updates live as filters change: recipe row cards (photo thumbnail + title + time/difficulty/cuisine meta).
- Sticky bottom CTA: terracotta pill button labeled "Show {N} recipes" reflecting the live filtered count.

### 7. Saved / Collections
- Header: "My Collections" title + grocery-list shortcut icon + "new collection" icon.
- 2-column grid of collection cards: photo placeholder tile (96px tall) + collection name + recipe count.
- Tapping a collection opens a simple list view (back header + recipe row cards) of that collection's recipes.

### 8. Grocery List
- Header: back button + "Grocery List" title + "Edit" text action.
- Items grouped under category eyebrows (Produce / Meat / Pantry): each row is a circular checkbox (terracotta fill + strikethrough text when checked), item name, quantity right-aligned.
- Sticky bottom CTA: terracotta pill "+ Add Item" appends a new demo item to the list.

### 9. Profile
- Header: settings gear + italic "Profile" title + notification bell.
- Avatar: terracotta circle with initial letter (placeholder for a real photo), name (Playfair Display 19px), one-line bio.
- Stats row: Recipes saved / Collections / Following counts, each with a number (Playfair Display) + label.
- Preferences list (hairline-divided rows): Dietary Preference (tap expands an inline chip picker: No preference / Vegetarian / Vegan / Gluten Free / Pescatarian), Favorite Cuisines (static, shows selected regions), Cooking Level (tap cycles Beginner → Intermediate → Advanced), Cooking History, Settings (both chevron rows, inert in the prototype).

### 10. Cook With What You Have
- Header: back button + title.
- Instruction copy, then a 4-column grid of ingredient toggle chips (circular swatch + label) for what's on hand (e.g. Chicken, Pork, Garlic, Soy Sauce, Vinegar, Egg, Onion, Tomato). Selected chips fill terracotta.
- An arrow divider, then "WeCooked suggests" — a suggestion card (saffron-tinted outline) with a photo placeholder, suggested dish title, and time/difficulty meta, derived live from the selected ingredients. Tapping opens that recipe's Recipe Details. If nothing is selected, shows a prompt to pick ingredients instead.

## Interactions & Behavior
- All primary navigation is single-page state (no full reloads): tab bar switches Home/Search/Saved/Profile; recipe cards push into Recipe Details; "Start Cooking" pushes into Cooking Mode; the center "+" and the Home banner both open Cook-With-What-You-Have.
- Back/exit buttons return to the screen's originating tab.
- Vibe chips and craving tiles filter recipe lists live (no page reload).
- Search filters (cuisine/region, time bucket, difficulty, dietary) combine as an AND filter and update the result list and count live.
- Cooking Mode timers run automatically per step (count down every second) and can be paused/resumed; advancing/going back to a step resets that step's timer to its full duration.
- Save/heart toggle on Recipe Details adds/removes the recipe from Saved.
- Grocery item rows toggle a checked/strikethrough state on tap; "Add Item" appends a new row.
- Dietary Preference and Cooking Level rows on Profile are lightly interactive (inline picker / cycling value) — everything else on Profile is static.

## State Management
Minimum state needed to reproduce behavior:
- Current screen / navigation stack + active bottom tab
- Onboarding slide index
- Selected vibe filter (Home) and category filter (from craving tap)
- Search filters: selected cuisines/regions (multi), time bucket (single), difficulty (single), dietary tags (multi)
- Selected/open recipe id; set of saved recipe ids
- Cooking Mode: active recipe id, current step index, seconds remaining for the active step, running/paused flag, immersive-timer-open flag
- Grocery list items (id, category, name, qty, checked) — with the ability to append new items
- Selected collection id (for the collection detail view)
- Cook-With-What-You-Have: set of selected on-hand ingredients → drives a computed suggested recipe
- Profile: dietary preference value, cooking level value, and whether the dietary-preference picker is expanded

## Data
15 recipes are used throughout (Home trending, Search results, Saved collections, Cook-With-What-You-Have suggestions). Each recipe record needs: id, title, category (breakfast/noodles/ulam/desserts), cuisine/region (Luzon/Visayas/Mindanao/Fusion), minutes, difficulty (Easy/Medium/Hard), servings, rating, review count, vibe tags (cozy/fresh/quick/impress), dietary tags (vegetarian/vegan/glutenfree), a description, an ingredients list (name + qty), and a steps list (title + instruction + duration in seconds). See `WeCooked.dc.html` for the full authored dataset (Chicken Adobo, Pork Sinigang, Pancit Canton, Pancit Bihon, Lechon Kawali, Sisig, Kare-Kare, Bicol Express, Tapsilog, Longsilog, Tinolang Manok, Bulalo, Halo-Halo, Leche Flan, Ube Halaya).

## Assets
No real photography is included — every image is a placeholder (a striped dark tile with a monospace caption naming the intended shot, e.g. "photo: chicken adobo"). Source real food photography for each recipe, the onboarding slides, and category tiles before shipping. The avatar is a plain initial-letter circle standing in for a profile photo.

## Files
- `WeCooked.dc.html` — the full interactive prototype (all 10 screens, inline-styled, with all interaction logic in a single component class).
