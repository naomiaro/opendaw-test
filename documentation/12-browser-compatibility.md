# Browser Compatibility

> **Appendix** — platform-specific workarounds for Web Audio in different browsers

## Safari/iOS Audio Format

Safari cannot decode Ogg Opus files via `decodeAudioData`, even though `canPlayType` returns `"maybe"`. Provide m4a (AAC) fallback files and detect the browser via user agent:

```typescript
// src/lib/audioUtils.ts
export function getAudioExtension(): string {
  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent)
    || /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return isSafari ? "m4a" : "opus";
}
```

## iOS Safari AudioContext Suspension

iOS Safari re-suspends `AudioContext` after backgrounding or locking the device. Before calling `play()`:

```typescript
if (audioContext.state !== "running") {
  await audioContext.resume();
  // Wait for statechange event — iOS may not be "running" yet
  await new Promise<void>(resolve => {
    if (audioContext.state === ("running" as AudioContextState)) {
      resolve();
      return;
    }
    audioContext.addEventListener("statechange", function handler() {
      if (audioContext.state === ("running" as AudioContextState)) {
        audioContext.removeEventListener("statechange", handler);
        resolve();
      }
    });
  });
}
```

Browser autoplay policy means `AudioContext` starts suspended until a user gesture. `initializeOpenDAW()` registers click/keydown listeners to auto-resume it (one-shot).

## Cross-Origin Isolation (COOP/COEP)

`SharedArrayBuffer` requires cross-origin isolation headers. The project configures these in `public/_headers`:

- Demo pages require `Cross-Origin-Embedder-Policy: require-corp` and `Cross-Origin-Opener-Policy: same-origin`
- VitePress docs (`/docs/*`) are excluded — VitePress assets break under `require-corp`

## Output Device Selection

`AudioDevices` only handles inputs. For output device enumeration:

```typescript
const allDevices = await navigator.mediaDevices.enumerateDevices();
const outputs = allDevices.filter(d => d.kind === "audiooutput" && d.deviceId !== "");
```

`setSinkId` is Chrome/Edge only — gate with `"setSinkId" in AudioContext.prototype`.
