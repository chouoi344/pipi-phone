package com.pipiphone.app;

import android.media.MediaRecorder;
import android.os.Handler;
import android.util.Base64;
import java.io.File;
import java.io.IOException;
import java.io.RandomAccessFile;

/** Short, foreground-only voice note. Its private file has no name on disk while recording. */
final class VoiceCapture {
    private final File cache;
    private final Handler handler;
    private final Runnable timeout;
    private MediaRecorder recorder;
    private RandomAccessFile audio;

    VoiceCapture(File cache, Handler handler, Runnable interrupted) {
        this.cache = cache;
        this.handler = handler;
        timeout = () -> { cancel(); interrupted.run(); };
    }

    @SuppressWarnings("deprecation") void start() throws IOException {
        if (recorder != null) throw new IllegalStateException("当前正在录音");
        File file = File.createTempFile("voice-", ".m4a", cache);
        try {
            audio = new RandomAccessFile(file, "rw");
            if (!file.delete()) throw new IOException("无法准备临时录音文件");
            recorder = new MediaRecorder();
            recorder.setAudioSource(MediaRecorder.AudioSource.MIC);
            recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
            recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
            recorder.setAudioSamplingRate(16000);
            recorder.setAudioEncodingBitRate(32000);
            recorder.setAudioChannels(1);
            recorder.setOutputFile(audio.getFD());
            recorder.setOnErrorListener((source, what, extra) -> {
                if (source == recorder) timeout.run();
            });
            recorder.prepare();
            recorder.start();
            // The UI finishes at 60 seconds, including when the finger remains down.
            handler.postDelayed(timeout, 65000);
        } catch (IOException | RuntimeException failure) {
            cancel();
            throw failure;
        }
    }

    String finish() throws IOException {
        if (recorder == null) throw new IllegalStateException("录音已中断，请重新按住说话");
        try {
            recorder.stop();
            long length = audio.length();
            if (length <= 0 || length > 512 * 1024) throw new IOException("录音文件无效");
            byte[] bytes = new byte[(int) length];
            audio.seek(0);
            audio.readFully(bytes);
            return Base64.encodeToString(bytes, Base64.NO_WRAP);
        } finally { cancel(); }
    }

    void cancel() {
        handler.removeCallbacks(timeout);
        if (recorder != null) { recorder.release(); recorder = null; }
        if (audio != null) {
            try { audio.close(); } catch (IOException failure) {
                android.util.Log.w("PipiVoice", "Could not close temporary recording", failure);
            }
            audio = null;
        }
    }
}
