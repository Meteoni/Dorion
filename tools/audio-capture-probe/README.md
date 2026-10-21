# WebView2 display-audio probe

This is a diagnostic plugin, not a confirmed fix. It tests the installed WebView2 runtime through Dorion's real `getDisplayMedia` path. No build or replacement executable is needed.

Version 2 calls the native `MediaDevices` prototype method directly. Vencord's enabled-by-default `WebScreenShare` plugin replaces the instance method, forces `restrictOwnAudio: true`, and omits the caller's `windowAudio` preference. Version 1 did not account for this interception, so its requests were not controlled native-API tests when that wrapper was active. Version 2 reports `pageCaptureOverridden` and refuses to run if the prototype method itself is not native.

## Install

1. Download `audio-capture-probe.js` into the `plugins` folder beside your portable `Dorion.exe`. For a nonportable installation, use the plugin folder opened by Dorion's settings.
2. Enable the plugin in Dorion's plugin settings. A file added while Dorion is running is discovered at full application startup, not by page reload. Alternatively, register it using the included `plugins.json` entry (merge this entry if other plugins are listed). Reload after registration. The panel title must say **v2**. Preload is not required.
3. Download `external-tone.html`, open it in a separate browser outside Dorion, and click **Play 1511 Hz reference**. Use headphones for a clean test.

## Test

For each selection, enable the picker's audio checkbox if one is available. Merely returning a video track or advertising a constraint does not establish audio support.

1. Click **Screen baseline**, select the entire screen, and click **Measure tones**. Both the external 1511 Hz reference and Dorion's 997 Hz test tone should be captured. The 997 Hz level should increase when the tone turns on. If not, the baseline is inconclusive.
2. Click **Screen excluding self**, select the same screen, and measure again. A working self-exclusion implementation removes the 997 Hz tone while retaining the 1511 Hz reference. A missing audio track or total silence does not count as success. The probe also reports the returned `restrictOwnAudio` setting when present.
3. Click **Application window**, select the external reference browser window, and measure. It should return an audio track containing 1511 Hz while excluding Dorion's 997 Hz tone.
4. Repeat **Application window** with a different, silent application's window. The 1511 Hz tone should disappear. This control distinguishes application audio from system audio paired with window video. Use a different application process, since several windows of one app may share audio.

All levels are relative diagnostic FFT readings, not calibrated sound-pressure measurements. More negative means quieter; compare baseline versus restricted capture. `generatedTone997Hz` measures the test signal before it reaches the output and should rise when the tone switches on. `ownTone997Hz` measures that frequency inside the captured stream. No audio/video is recorded, uploaded, played back from the capture, or connected to Discord. Only generated test tones play through the speakers. Capture stops after 180 seconds, when stopped in the picker, or when the panel is closed.

Copy the panel's text results to report the runtime behavior. Track device/group IDs, window titles, and Discord channel information are omitted from the report.

## Remove

Click **Close**, disable the plugin, and delete its JavaScript file. Stop the external reference tone or close its browser tab.

## Evidence and limits

Chromium enabled `ApplicationAudioCaptureWin` by default on January 28, 2026:
https://chromium.googlesource.com/chromium/src/+/5dd5bdb2e5d905e6e1a1f07e1927304f52b7bb0e

The WebView2 request remains open:
https://github.com/MicrosoftEdge/WebView2Feedback/issues/4327

The inspected Dorion installation uses WebView2 157.0.4341.10 and loads Shelter plus Vencord. A source audit found no direct capture implementation in Dorion's Rust/injection sources; its Vencord WebScreenShare plugin does wrap this API:
https://github.com/Vendicated/Vencord/blob/main/src/plugins/webScreenShare.browser/index.tsx

Version 1 user tests returned silent monitor audio and broader self-excluding audio with window video. Because the page method may have been Vencord's wrapper, these do not establish how native WebView2 handles the exact requested preferences. Version 2 requires a fresh runtime test. The desktop automation helper rejected control of WebView2 DevTools, so this plugin provides a manual test without DevTools access.
