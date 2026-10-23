import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { categorize, categoriesFor, detectKind } from '../src/categories.js';

const entries = (...names) => names.map((name) => ({ name }));

describe('detectKind', () => {
  it('uses the file extension first', () => {
    assert.equal(detectKind('build/app-release.apk', []), 'apk');
    assert.equal(detectKind('build/app-release.AAB', []), 'aab');
    assert.equal(detectKind('build/App.ipa', []), 'ipa');
  });

  it('falls back to the archive layout', () => {
    assert.equal(detectKind('artifact.zip', entries('Payload/App.app/App')), 'ipa');
    assert.equal(detectKind('artifact.zip', entries('BundleConfig.pb', 'base/dex/classes.dex')), 'aab');
    assert.equal(detectKind('artifact.zip', entries('base/manifest/AndroidManifest.xml')), 'aab');
    assert.equal(detectKind('artifact.zip', entries('classes.dex')), 'apk');
  });
});

describe('categoriesFor', () => {
  it('lists Android and iOS categories in report order', () => {
    assert.deepEqual(categoriesFor('apk'), ['dex', 'native', 'resources', 'assets', 'other']);
    assert.deepEqual(categoriesFor('aab'), ['dex', 'native', 'resources', 'assets', 'other']);
    assert.deepEqual(categoriesFor('ipa'), ['binary', 'frameworks', 'assets', 'resources', 'other']);
  });
});

describe('categorize APK', () => {
  const cases = [
    ['classes.dex', 'dex'],
    ['classes12.dex', 'dex'],
    ['lib/arm64-v8a/libapp.so', 'native'],
    ['lib/x86_64/libc++_shared.so', 'native'],
    ['res/drawable/icon.png', 'resources'],
    ['resources.arsc', 'resources'],
    ['assets/fonts/font.ttf', 'assets'],
    ['AndroidManifest.xml', 'other'],
    ['META-INF/CERT.RSA', 'other'],
    ['kotlin/kotlin.kotlin_builtins', 'other'],
    ['base/res/drawable/icon.png', 'other'],
  ];
  for (const [name, category] of cases) {
    it(`${name} -> ${category}`, () => assert.equal(categorize(name, 'apk'), category));
  }
});

describe('categorize AAB', () => {
  const cases = [
    ['base/dex/classes.dex', 'dex'],
    ['base/lib/arm64-v8a/libapp.so', 'native'],
    ['base/res/layout/main.xml', 'resources'],
    ['base/resources.pb', 'resources'],
    ['base/assets/data.bin', 'assets'],
    ['base/manifest/AndroidManifest.xml', 'other'],
    ['base/root/kotlin/collections.kotlin_builtins', 'other'],
    ['feature_camera/dex/classes.dex', 'dex'],
    ['feature_camera/res/raw/clip.mp4', 'resources'],
    ['feature_camera/assets/model.tflite', 'assets'],
    ['BUNDLE-METADATA/com.android.tools.build.obfuscation/proguard.map', 'other'],
    ['META-INF/MANIFEST.MF', 'other'],
    ['BundleConfig.pb', 'other'],
  ];
  for (const [name, category] of cases) {
    it(`${name} -> ${category}`, () => assert.equal(categorize(name, 'aab'), category));
  }
});

describe('categorize IPA', () => {
  const cases = [
    ['Payload/Example.app/Example', 'binary'],
    ['Payload/My App.app/My App', 'binary'],
    ['Payload/Example.app/Frameworks/Lib.framework/Lib', 'frameworks'],
    ['Payload/Example.app/Frameworks/libswiftCore.dylib', 'frameworks'],
    ['Payload/Example.app/Frameworks/Lib.framework/Assets.car', 'frameworks'],
    ['Payload/Example.app/Assets.car', 'assets'],
    ['Payload/Example.app/Assets/intro.mp4', 'assets'],
    ['Payload/Example.app/Base.lproj/Main.storyboardc/Info.plist', 'resources'],
    ['Payload/Example.app/en.lproj/Localizable.strings', 'resources'],
    ['Payload/Example.app/View.nib', 'resources'],
    ['Payload/Example.app/Info.plist', 'resources'],
    ['Payload/Example.app/Example.bundle/Example', 'resources'],
    ['Payload/Example.app/PlugIns/Widget.appex/Widget', 'other'],
    ['Payload/Example.app/Watch/WatchApp.app/WatchApp', 'other'],
    ['SwiftSupport/iphoneos/libswiftCore.dylib', 'other'],
    ['Symbols/ABC.symbols', 'other'],
    ['iTunesMetadata.plist', 'other'],
  ];
  for (const [name, category] of cases) {
    it(`${name} -> ${category}`, () => assert.equal(categorize(name, 'ipa'), category));
  }
});
