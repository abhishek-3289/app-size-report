# App Size Report 📦

[![My Skills](https://skillicons.dev/icons?i=githubactions,androidstudio,apple,nodejs&perline=4)](https://skillicons.dev)

## Use 📄

### Example ⌨️

```yaml
    permissions:
      contents: read
      pull-requests: write

    steps:
      - name: Report APK size
        id: size
        uses: appshipkit/app-size-report@v1
        with:
          head-path: head/app/build/outputs/apk/release/app-release-unsigned.apk
          base-path: base/app/build/outputs/apk/release/app-release-unsigned.apk
          name: Android release APK
          max-increase-percent: 5

      - name: Use outputs
        env:
          DIFF_BYTES: ${{ steps.size.outputs.diff-bytes }}
          EXCEEDED: ${{ steps.size.outputs.exceeded }}
        run: echo "Changed by $DIFF_BYTES bytes, limit exceeded: $EXCEEDED"
```

### Description 🔖

A GitHub Action that compares the size of a mobile build artifact from a pull request with a baseline
built from the base branch and reports the result on the pull request. It works with Android APK, Android
App Bundle (AAB) and iOS IPA files, which are all ZIP archives.

The action reads the ZIP central directory itself (no `unzip`, no npm dependencies) and records the
compressed and uncompressed size of every entry. The report contains:

- **File size** of the artifact, used as a proxy for download size, plus the total compressed and
  uncompressed size of all entries and the entry count, each with the change against the baseline.
- **Compressed size per category** with deltas.
- **Top changed entries**: the `top-files` entries with the largest absolute change in compressed size,
  marked `added`, `removed` or `changed`. Without a baseline the largest entries are listed instead.

Sizes are shown as `B`, `KB`, `MB` or `GB` (1 KB = 1024 bytes) with one decimal, deltas are signed and
percentages have two decimals.

The report is written to the job summary and the `report` output. On `pull_request` and
`pull_request_target` events it is also posted as a single sticky comment: the action looks for a comment
containing the hidden marker `<!-- app-size-report:<name> -->` and updates it, or creates one if it does not
exist. Give every artifact its own `name` to get one comment per artifact. On other events the comment is
skipped. If the comment cannot be written (for example a read-only token on a pull request from a fork) a
warning is printed and the step continues.

If `base-path` is empty or the file does not exist, only the head artifact is reported and the report says
that no baseline was found. A `base-path` that exists but is not a valid ZIP fails the step.

When `max-increase-bytes` or `max-increase-percent` is set and the file size grows by more than that
(strictly greater), the comment and summary are still written first, `exceeded` is set to `true` and then
the step fails. Either limit is enough to fail. Limits are ignored when there is no baseline.

#### Categories

The kind of artifact comes from the file extension (`.apk`, `.aab`, `.ipa`); for other extensions it is
detected from the archive layout. Categories use compressed sizes.

| Artifact | Category | Entries |
|:---------|:---------|:--------|
| APK / AAB | `dex` | `*.dex` anywhere |
| APK / AAB | `native` | `lib/**` |
| APK / AAB | `resources` | `res/**`, `resources.arsc`, `resources.pb` |
| APK / AAB | `assets` | `assets/**` |
| APK / AAB | `other` | everything else (manifest, `META-INF/**`, `kotlin/**`, ...) |
| IPA | `binary` | `Payload/<Name>.app/<Name>`, the main executable |
| IPA | `frameworks` | `Payload/<Name>.app/Frameworks/**` |
| IPA | `assets` | `*.car` and `Assets/**` inside the `.app` |
| IPA | `resources` | every other file inside the `.app` (`*.nib`, `*.storyboardc`, `*.lproj/**`, `Info.plist`, bundles, ...) |
| IPA | `other` | files outside the `.app` (`SwiftSupport/`, `Symbols/`, `iTunesMetadata.plist`) and nested app bundles in `PlugIns/`, `Extensions/`, `Watch/`, `AppClips/` |

For an AAB the module directory is stripped first, so `base/lib/**`, `base/res/**`, `base/assets/**` and
`base/resources.pb` (and the same paths in dynamic feature modules) land in the categories above.
`BUNDLE-METADATA/**` and `META-INF/**` count as `other`.

#### Limits

- The main executable of an IPA is assumed to have the same name as the `.app` folder, which is the Xcode
  default. If `CFBundleExecutable` differs, the executable is counted as `resources`.
- ZIP64 archives are supported: the ZIP64 end of central directory record and the ZIP64 extra field are
  read, so archives and entries larger than 4 GB are measured correctly up to 2^53 bytes. Split
  (multi-disk) archives are not supported.
- File names are read as UTF-8 and fall back to Latin-1 when the bytes are not valid UTF-8.

### Inputs 📥

| name                 | description                                                                                       | required | default                         |
|:---------------------|:--------------------------------------------------------------------------------------------------|:---------|:--------------------------------|
| head-path            | Path to the artifact (APK, AAB or IPA) built from the pull request.                               | Yes      | ❌                              |
| base-path            | Path to the baseline artifact. When empty or missing only the head build is reported.             | No       | ❌                              |
| name                 | Label shown in the report and used in the sticky comment marker.                                  | No       | file name of `head-path`        |
| max-increase-bytes   | Fail the step when the file size grows by more than this many bytes.                              | No       | ❌                              |
| max-increase-percent | Fail the step when the file size grows by more than this percentage, e.g. `2.5`.                  | No       | ❌                              |
| comment              | Create or update a sticky pull request comment.                                                   | No       | `true`                          |
| github-token         | Token used for the comment. Needs `pull-requests: write`.                                         | No       | `github.token`                  |
| top-files            | How many entries with the largest compressed size change to list. `0` hides the list.             | No       | `10`                            |

Relative paths are resolved against `GITHUB_WORKSPACE`.

### Outputs 📤

1. **head-size** :- Size of the head artifact file in bytes.
2. **base-size** :- Size of the baseline artifact file in bytes, empty without a baseline.
3. **diff-bytes** :- `head-size - base-size`, empty without a baseline.
4. **diff-percent** :- Change in percent with two decimals, e.g. `4.88` or `-1.20`, empty without a baseline.
5. **report** :- The Markdown report (multi-line).
6. **exceeded** :- `true` when a limit was exceeded, otherwise `false`.

## Examples 🧪

Ready-to-copy workflows live in [`examples/`](examples):

- [`android-apk-size.yml`](examples/android-apk-size.yml) checks out the pull request and its base commit
  side by side, runs `./gradlew assembleRelease` in both and compares the release APKs. The base build uses
  `continue-on-error`, so a base branch that does not build simply produces a report without a baseline.
- [`ios-ipa-size.yml`](examples/ios-ipa-size.yml) runs on macOS, installs a signing certificate and
  provisioning profile from secrets, archives and exports scheme `App` with `ExportOptions.plist` for both
  commits and compares the IPAs.

Copy one into `.github/workflows/` of your repository.

### Baseline from the main branch ♻️

Building the base commit doubles the build time. Instead you can upload the artifact on every push to `main`
and download the one from the latest successful run in the pull request:

```yaml
# in the workflow that runs on push to main
      - uses: actions/upload-artifact@v7
        with:
          name: apk-baseline
          path: app/build/outputs/apk/release/app-release-unsigned.apk

# in the pull request workflow (needs actions: read)
      - name: Download baseline
        continue-on-error: true
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          run_id=$(gh run list --repo "$GITHUB_REPOSITORY" --workflow build.yml --branch main \
            --status success --limit 1 --json databaseId --jq '.[0].databaseId')
          gh run download "$run_id" --repo "$GITHUB_REPOSITORY" --name apk-baseline --dir baseline

      - uses: appshipkit/app-size-report@v1
        with:
          head-path: app/build/outputs/apk/release/app-release-unsigned.apk
          base-path: baseline/app-release-unsigned.apk
```

If the download fails (no run yet, artifact expired) the action reports the head build only.

## Development 🛠️

The action is a Node 24 JavaScript action with no npm dependencies, so there is nothing to install or bundle.

```bash
npm test
```

The tests build small APK-like and IPA-like ZIP files on the fly (stored, deflated and ZIP64 variants)
with a tiny ZIP writer in `tests/helpers/`, so no binary fixtures are committed. The GitHub API is stubbed
with recorded request/response pairs.

| Workflow | Trigger | What it does |
|:---------|:--------|:-------------|
| [CI](.github/workflows/ci.yml) | push to `main`, pull requests | `node --check`, actionlint, unit tests on Node 24, and an integration run of the action against two APKs zipped in the job (with, over the limit and without a baseline). |
| [Release](.github/workflows/release.yml) | manual (`patch` / `minor` / `major`) | Runs CI, calculates the next version from the highest `vX.Y.Z` tag, publishes a GitHub release with generated notes, and moves the `vMAJOR` tag. |
