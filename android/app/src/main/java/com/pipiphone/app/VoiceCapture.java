package com.pipiphone.app;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.Build;
import android.os.Handler;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;

/**
 * Short, foreground-only 16 kHz mono 16-bit PCM voice capture producing standard WAV directly.
 * Avoids MediaRecorder short-stop (-1007) crashes, OEM AAC bitrate overshoot, and WebView AAC decode gaps.
 */
final class VoiceCapture {
    private static final int SAMPLE_RATE = 16000;
    private static final int CHANNEL_CONFIG = AudioFormat.CHANNEL_IN_MONO;
    private static final int AUDIO_FORMAT = AudioFormat.ENCODING_PCM_16BIT;
    // 60s @ 16kHz mono 16-bit PCM = 1,920,000 bytes (+ 44-byte WAV header). Allow generous headroom up to 4 MB.
    private static final int MAX_PCM_BYTES = 4 * 1024 * 1024 - 64;

    private final Context context;
    private final Handler handler;
    private final Runnable timeout;
    private final Object lock = new Object();
    private AudioRecord recorder;
    private Thread readerThread;
    private ByteArrayOutputStream pcmBuffer;
    private volatile boolean capturing;
    private AudioManager audioManager;
    private Object focusRequest;

    VoiceCapture(Context context, Handler handler, Runnable interrupted) {
        this.context = context.getApplicationContext();
        this.handler = handler;
        timeout = () -> { cancel(); interrupted.run(); };
    }

    boolean isRecording() {
        synchronized (lock) { return capturing && recorder != null; }
    }

    void start() throws IOException {
        // Defensively clear any stale session so a prior focus glitch can never lock the mic for 65s.
        cancel();
        int minBuf = AudioRecord.getMinBufferSize(SAMPLE_RATE, CHANNEL_CONFIG, AUDIO_FORMAT);
        if (minBuf <= 0) throw new IOException("设备不支持 16kHz 麦克风录音");
        int bufferSize = Math.max(minBuf * 2, SAMPLE_RATE / 2); // >= 0.25s ring buffer
        AudioRecord created = createAudioRecord(bufferSize);
        if (created == null || created.getState() != AudioRecord.STATE_INITIALIZED) {
            if (created != null) { try { created.release(); } catch (RuntimeException ignored) {} }
            throw new IOException("无法初始化麦克风，请检查系统录音权限");
        }
        ByteArrayOutputStream out = new ByteArrayOutputStream(64 * 1024);
        requestAudioFocus();
        try {
            created.startRecording();
            if (created.getRecordingState() != AudioRecord.RECORDSTATE_RECORDING) {
                throw new IOException("麦克风启动失败，请确认未被其他应用占用");
            }
        } catch (IOException | RuntimeException failure) {
            try { created.release(); } catch (RuntimeException ignored) {}
            abandonAudioFocus();
            throw failure;
        }
        Thread worker = new Thread(() -> readLoop(created, out, Math.max(2048, minBuf)), "pipi-voice-capture");
        synchronized (lock) {
            recorder = created;
            pcmBuffer = out;
            capturing = true;
            readerThread = worker;
        }
        worker.start();
        // The UI caps recording at 60 seconds; enforce a hard native ceiling at 65 seconds.
        handler.postDelayed(timeout, 65000);
    }

    private AudioRecord createAudioRecord(int bufferSize) {
        int[] sources = {MediaRecorder.AudioSource.VOICE_RECOGNITION, MediaRecorder.AudioSource.MIC};
        for (int source : sources) {
            AudioRecord candidate = null;
            try {
                candidate = new AudioRecord(source, SAMPLE_RATE, CHANNEL_CONFIG, AUDIO_FORMAT, bufferSize);
                if (candidate.getState() == AudioRecord.STATE_INITIALIZED) return candidate;
            } catch (RuntimeException ignored) {}
            if (candidate != null) { try { candidate.release(); } catch (RuntimeException ignored) {} }
        }
        return null;
    }

    private void readLoop(AudioRecord activeRecorder, ByteArrayOutputStream out, int chunkSize) {
        byte[] chunk = new byte[chunkSize];
        while (capturing) {
            int read;
            try {
                read = activeRecorder.read(chunk, 0, chunk.length);
            } catch (RuntimeException failure) {
                break;
            }
            if (read > 0) {
                synchronized (out) {
                    int remaining = MAX_PCM_BYTES - out.size();
                    if (remaining <= 0) break;
                    out.write(chunk, 0, Math.min(read, remaining));
                }
            } else if (read < 0) {
                break;
            }
        }
    }

    byte[] finishWav() throws IOException {
        AudioRecord activeRecorder;
        Thread worker;
        ByteArrayOutputStream out;
        synchronized (lock) {
            if (recorder == null || pcmBuffer == null) throw new IllegalStateException("录音已中断，请重新按住说话");
            capturing = false;
            activeRecorder = recorder;
            worker = readerThread;
            out = pcmBuffer;
            recorder = null;
            readerThread = null;
            pcmBuffer = null;
        }
        handler.removeCallbacks(timeout);
        try {
            try { activeRecorder.stop(); } catch (RuntimeException ignored) {}
            if (worker != null) {
                try { worker.join(600); } catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); }
            }
            byte[] pcm;
            synchronized (out) { pcm = out.toByteArray(); }
            if (pcm.length == 0) throw new IOException("没有录到声音，请重新按住说话");
            return buildWav(pcm);
        } finally {
            try { activeRecorder.release(); } catch (RuntimeException ignored) {}
            abandonAudioFocus();
        }
    }

    void cancel() {
        AudioRecord activeRecorder;
        Thread worker;
        synchronized (lock) {
            capturing = false;
            activeRecorder = recorder;
            worker = readerThread;
            recorder = null;
            readerThread = null;
            pcmBuffer = null;
        }
        handler.removeCallbacks(timeout);
        if (activeRecorder != null) {
            try { activeRecorder.stop(); } catch (RuntimeException ignored) {}
            if (worker != null) {
                try { worker.join(400); } catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); }
            }
            try { activeRecorder.release(); } catch (RuntimeException ignored) {}
        }
        abandonAudioFocus();
    }

    private static byte[] buildWav(byte[] pcm) {
        ByteBuffer header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN);
        header.put(new byte[]{'R', 'I', 'F', 'F'});
        header.putInt(36 + pcm.length);
        header.put(new byte[]{'W', 'A', 'V', 'E', 'f', 'm', 't', ' '});
        header.putInt(16);
        header.putShort((short) 1); // PCM
        header.putShort((short) 1); // mono
        header.putInt(SAMPLE_RATE);
        header.putInt(SAMPLE_RATE * 2); // byteRate
        header.putShort((short) 2); // blockAlign
        header.putShort((short) 16); // bitsPerSample
        header.put(new byte[]{'d', 'a', 't', 'a'});
        header.putInt(pcm.length);
        byte[] wav = new byte[44 + pcm.length];
        System.arraycopy(header.array(), 0, wav, 0, 44);
        System.arraycopy(pcm, 0, wav, 44, pcm.length);
        return wav;
    }

    @SuppressWarnings("deprecation")
    private void requestAudioFocus() {
        try {
            AudioManager mgr = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
            if (mgr == null) return;
            audioManager = mgr;
            if (Build.VERSION.SDK_INT >= 26) {
                AudioFocusRequest req = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE)
                        .setAudioAttributes(new AudioAttributes.Builder()
                                .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                                .build())
                        .build();
                focusRequest = req;
                mgr.requestAudioFocus(req);
            } else {
                mgr.requestAudioFocus(null, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT);
            }
        } catch (RuntimeException ignored) {}
    }

    @SuppressWarnings("deprecation")
    private void abandonAudioFocus() {
        AudioManager mgr = audioManager;
        Object req = focusRequest;
        audioManager = null;
        focusRequest = null;
        if (mgr == null) return;
        try {
            if (Build.VERSION.SDK_INT >= 26 && req instanceof AudioFocusRequest) {
                mgr.abandonAudioFocusRequest((AudioFocusRequest) req);
            } else {
                mgr.abandonAudioFocus(null);
            }
        } catch (RuntimeException ignored) {}
    }
}
