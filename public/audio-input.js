// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
(() => {
  const TARGET_RATE = 16000;

  function readBlobBuffer(blob) {
    if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('音频读取失败，请重试'));
      reader.readAsArrayBuffer(blob);
    });
  }

  function isReadyMono16kWav(arrayBuffer) {
    if (!arrayBuffer || arrayBuffer.byteLength < 46) return false;
    const view = new DataView(arrayBuffer);
    const tag = o => String.fromCharCode(view.getUint8(o), view.getUint8(o + 1), view.getUint8(o + 2), view.getUint8(o + 3));
    if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return false;
    let fmtOk = false, dataOk = false;
    for (let at = 12; at + 8 <= arrayBuffer.byteLength;) {
      const id = tag(at), size = view.getUint32(at + 4, true), end = at + 8 + size;
      if (end > arrayBuffer.byteLength) return false;
      if (id === 'fmt ' && size >= 16) {
        const format = view.getUint16(at + 8, true);
        const channels = view.getUint16(at + 10, true);
        const rate = view.getUint32(at + 12, true);
        const bits = view.getUint16(at + 22, true);
        fmtOk = format === 1 && channels === 1 && rate === TARGET_RATE && bits === 16;
      }
      if (id === 'data' && size > 0) dataOk = true;
      at = end + (size % 2);
    }
    return fmtOk && dataOk;
  }

  function resampleMono(samples, inputRate, targetRate) {
    if (!samples || !samples.length) return new Float32Array(0);
    if (!inputRate || inputRate === targetRate) return samples;
    const ratio = inputRate / targetRate;
    const outLength = Math.max(1, Math.round(samples.length / ratio));
    const output = new Float32Array(outLength);
    for (let i = 0; i < outLength; i++) {
      const pos = i * ratio;
      const idx = Math.floor(pos);
      const frac = pos - idx;
      const a = samples[idx] || 0;
      const b = samples[Math.min(idx + 1, samples.length - 1)] || 0;
      output[i] = a + (b - a) * frac;
    }
    return output;
  }

  function encodeWav(monoSamples, sampleRate) {
    const resampled = resampleMono(monoSamples, sampleRate, TARGET_RATE);
    const frames = resampled.length;
    if (!frames) throw new Error('没有录到声音，请重试');
    const buffer = new ArrayBuffer(44 + frames * 2);
    const view = new DataView(buffer);
    const label = (offset, value) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
    label(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); label(8, 'WAVE'); label(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, TARGET_RATE, true); view.setUint32(28, TARGET_RATE * 2, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    label(36, 'data'); view.setUint32(40, frames * 2, true);
    for (let i = 0; i < frames; i++) {
      const s = Math.max(-1, Math.min(1, resampled[i]));
      view.setInt16(44 + i * 2, Math.round(s * (s < 0 ? 32768 : 32767)), true);
    }
    return new Blob([buffer], { type: 'audio/wav' });
  }

  function decodeBuffer(context, arrayBuffer) {
    const copy = arrayBuffer.slice(0);
    return new Promise((resolve, reject) => {
      let settled = false;
      const ok = decoded => { if (!settled) { settled = true; resolve(decoded); } };
      const fail = err => { if (!settled) { settled = true; reject(err instanceof Error ? err : new Error('音频解码失败，请重试')); } };
      try {
        const ret = context.decodeAudioData(copy, ok, fail);
        if (ret && typeof ret.then === 'function') ret.then(ok, fail);
      } catch (err) {
        fail(err);
      }
    });
  }

  async function recordingWav(blob) {
    const raw = await readBlobBuffer(blob);
    if (isReadyMono16kWav(raw)) return new Blob([raw], { type: 'audio/wav' });
    const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const Live = window.AudioContext || window.webkitAudioContext;
    let decoded = null;
    let liveCtx = null;
    try {
      if (Offline) {
        try {
          const ctx = new Offline(1, 1, TARGET_RATE);
          decoded = await decodeBuffer(ctx, raw);
        } catch {
          decoded = null;
        }
      }
      if (!decoded && Live) {
        liveCtx = new Live();
        decoded = await decodeBuffer(liveCtx, raw);
      }
    } finally {
      if (liveCtx && typeof liveCtx.close === 'function') liveCtx.close().catch(() => {});
    }
    if (!decoded || !decoded.length) throw new Error('无法解码这段录音，请重试');
    const frames = decoded.length;
    const channels = Array.from({ length: decoded.numberOfChannels }, (_, i) => decoded.getChannelData(i));
    const mono = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
      let sum = 0;
      for (const ch of channels) sum += ch[i];
      mono[i] = sum / channels.length;
    }
    return encodeWav(mono, decoded.sampleRate || TARGET_RATE);
  }

  function createPcmRecorder(stream, existingContext) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) throw new Error('当前浏览器不支持录音处理');
    const chunks = [];
    let totalFrames = 0;
    let rms = 0;
    let ctx = existingContext || null;
    let source = null;
    let processor = null;
    let sink = null;
    let ownsContext = !existingContext;
    const recorder = {
      state: 'inactive',
      mimeType: 'audio/wav',
      ondataavailable: null,
      onstop: null,
      onerror: null,
      level: () => rms,
      start() {
        try {
          if (!ctx || ctx.state === 'closed') {
            ctx = new Ctor();
            ownsContext = true;
          }
          if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
            ctx.resume().catch(() => {});
          }
          source = ctx.createMediaStreamSource(stream);
          processor = ctx.createScriptProcessor(4096, 1, 1);
          sink = ctx.createGain();
          sink.gain.value = 0;
          processor.onaudioprocess = event => {
            if (recorder.state !== 'recording') return;
            const input = event.inputBuffer.getChannelData(0);
            const copy = new Float32Array(input.length);
            copy.set(input);
            chunks.push(copy);
            totalFrames += copy.length;
            let power = 0;
            for (let i = 0; i < copy.length; i++) power += copy[i] * copy[i];
            rms = Math.min(1, Math.sqrt(power / copy.length) * 6);
          };
          source.connect(processor);
          processor.connect(sink);
          sink.connect(ctx.destination);
          recorder.state = 'recording';
          return true;
        } catch (err) {
          cleanup();
          throw err;
        }
      },
      stop() {
        if (recorder.state === 'inactive') return;
        const sampleRate = ctx?.sampleRate || 44100;
        recorder.state = 'inactive';
        cleanup();
        try {
          if (totalFrames > 0 && typeof recorder.ondataavailable === 'function') {
            const merged = new Float32Array(totalFrames);
            let offset = 0;
            for (const part of chunks) { merged.set(part, offset); offset += part.length; }
            const wav = encodeWav(merged, sampleRate);
            recorder.ondataavailable({ data: wav });
          }
          if (typeof recorder.onstop === 'function') recorder.onstop();
        } catch (err) {
          if (typeof recorder.onerror === 'function') recorder.onerror(err);
        }
      }
    };
    function cleanup() {
      try { if (processor) { processor.onaudioprocess = null; processor.disconnect(); } } catch {}
      try { if (source) source.disconnect(); } catch {}
      try { if (sink) sink.disconnect(); } catch {}
      processor = source = sink = null;
      if (ownsContext && ctx && ctx.state !== 'closed' && typeof ctx.close === 'function') {
        ctx.close().catch(() => {});
      }
      ctx = null;
    }
    return recorder;
  }

  window.PipiAudio = { recordingWav, createPcmRecorder, encodeWav, isReadyMono16kWav };
})();
