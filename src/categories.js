import path from 'node:path';

export const ANDROID_CATEGORIES = ['dex', 'native', 'resources', 'assets', 'other'];
export const IOS_CATEGORIES = ['binary', 'frameworks', 'assets', 'resources', 'other'];

const IPA_APP_ENTRY = /^Payload\/([^/]+)\.app\/(.+)$/;
const AAB_ROOT_DIRECTORIES = new Set(['BUNDLE-METADATA', 'META-INF']);
const IOS_NESTED_BUNDLES = ['PlugIns/', 'Extensions/', 'Watch/', 'AppClips/'];

export function detectKind(fileName, entries) {
  const extension = path.extname(fileName).toLowerCase();
  if (extension === '.ipa') return 'ipa';
  if (extension === '.aab') return 'aab';
  if (extension === '.apk') return 'apk';
  if (entries.some((entry) => IPA_APP_ENTRY.test(entry.name))) return 'ipa';
  if (entries.some((entry) => entry.name === 'BundleConfig.pb' || entry.name.startsWith('base/manifest/'))) {
    return 'aab';
  }
  return 'apk';
}

export function categoriesFor(kind) {
  return kind === 'ipa' ? IOS_CATEGORIES : ANDROID_CATEGORIES;
}

function androidCategory(name, kind) {
  if (name.toLowerCase().endsWith('.dex')) return 'dex';
  let relative = name;
  if (kind === 'aab') {
    const slash = relative.indexOf('/');
    if (slash > 0 && !AAB_ROOT_DIRECTORIES.has(relative.slice(0, slash))) {
      relative = relative.slice(slash + 1);
    }
  }
  if (relative.startsWith('lib/')) return 'native';
  if (relative.startsWith('res/') || relative === 'resources.arsc' || relative === 'resources.pb') return 'resources';
  if (relative.startsWith('assets/')) return 'assets';
  return 'other';
}

function iosCategory(name) {
  const match = IPA_APP_ENTRY.exec(name);
  if (!match) return 'other';
  const [, appName, relative] = match;
  if (relative === appName) return 'binary';
  if (relative.startsWith('Frameworks/')) return 'frameworks';
  if (IOS_NESTED_BUNDLES.some((directory) => relative.startsWith(directory))) return 'other';
  if (relative.endsWith('.car') || relative.startsWith('Assets/')) return 'assets';
  return 'resources';
}

export function categorize(name, kind) {
  return kind === 'ipa' ? iosCategory(name) : androidCategory(name, kind);
}
