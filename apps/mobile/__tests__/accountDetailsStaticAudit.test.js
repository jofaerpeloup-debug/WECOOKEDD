const fs = require('fs');
const path = require('path');

const raw = fs.readFileSync(path.join(__dirname, '../src/screens/AccountDetailScreen.js'), 'utf8');

describe('MOBILE-PROFILE2 Account Details source contract', () => {
  it('uses AuthContext and the three authenticated profile mutations only', () => {
    expect(raw).toMatch(/const \{ user, syncUser \} = useAuth\(\)/);
    expect(raw).toMatch(/resetAvatar, updateProfile, uploadAvatar/);
    expect(raw).not.toMatch(/fetch\(|AsyncStorage|mockData|CommunityContext/);
  });

  it('implements the 500-character bio and exact cooking-level choices', () => {
    expect(raw).toMatch(/MAX_BIO_LENGTH = 500/);
    expect(raw).toMatch(/maxLength=\{MAX_BIO_LENGTH\}/);
    expect(raw).toMatch(/\['beginner', 'Beginner'\]/);
    expect(raw).toMatch(/\['intermediate', 'Intermediate'\]/);
    expect(raw).toMatch(/\['advanced', 'Advanced'\]/);
  });

  it('uses photo-library selection without camera/crop authority', () => {
    expect(raw).toMatch(/launchImageLibraryAsync/);
    expect(raw).toMatch(/allowsEditing: false/);
    expect(raw).not.toMatch(/launchCameraAsync|requestCameraPermissions/);
  });

  it('keeps save, upload, and reset under one identity-bound operation guard', () => {
    expect(raw).toMatch(/operationRef\.current/);
    expect(raw).toMatch(/ownerRef\.current === operation\.ownerId/);
    expect(raw).toMatch(/generationRef\.current === operation\.generation/);
    expect(raw).toMatch(/beginOperation\('save'\)/);
    expect(raw).toMatch(/beginOperation\('upload'\)/);
    expect(raw).toMatch(/beginOperation\('reset'\)/);
  });

  it('renders the authoritative avatar or accessible initial and confirms reset', () => {
    expect(raw).toMatch(/user\?\.avatarUrl/);
    expect(raw).toMatch(/accessibilityLabel=\{`\$\{user\?\.name \|\| 'Account'\} initial`\}/);
    expect(raw).toMatch(/Alert\.alert\('Reset profile photo\?'/);
  });

  it('sends only owned profile fields during save', () => {
    const call = raw.match(/updateProfile\(\{([^;]+?)\}\);/s);
    expect(call).not.toBeNull();
    expect(call[1]).toMatch(/name: trimmedName, bio, cookingLevel/);
    expect(call[1]).toMatch(/dietaryPreferences: dietary, allergies/);
    expect(call[1]).not.toMatch(/avatarUrl|assetId|role|status|email|userId/);
  });
});
