"""Operate the unchanged official APK using Android accessibility, without CDP."""
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

EVIDENCE = Path(os.environ['GATE_EVIDENCE_DIR'])
ADB = os.environ['ADB_PATH']
SERIAL = 'emulator-5554'
PACKAGE = 'com.pipiphone.app'


def adb(*args, binary=False):
    return subprocess.check_output([ADB, '-s', SERIAL, *map(str, args)],
                                   text=not binary, timeout=30)


def nodes():
    for _ in range(4):
        dumped = adb('shell', 'uiautomator', 'dump', '/sdcard/gate-ui.xml')
        if 'dumped to' in dumped:
            raw = adb('exec-out', 'cat', '/sdcard/gate-ui.xml')
            (EVIDENCE / 'android-current.xml').write_text(raw, encoding='utf8')
            return [node.attrib for node in ET.fromstring(raw).iter('node')]
        time.sleep(1)
    raise RuntimeError('Android accessibility hierarchy unavailable')


def labels(node):
    return [node.get('text', ''), node.get('content-desc', '')]


def find(label, snapshot, exact=True):
    return next((n for n in snapshot if n.get('bounds') != '[0,0][0,0]'
                 and any(label == v if exact else label in v for v in labels(n))), None)


def wait(label, timeout=60, exact=True):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        found = find(label, nodes(), exact)
        if found:
            return found
        time.sleep(.5)
    raise AssertionError('Not visible in official Android App: ' + label)


def tap_node(node):
    x1, y1, x2, y2 = map(int, re.findall(r'\d+', node['bounds']))
    adb('shell', 'input', 'tap', (x1 + x2) // 2, (y1 + y2) // 2)
    time.sleep(.7)


def tap(label, exact=True):
    tap_node(wait(label, exact=exact))


def screenshot(name):
    (EVIDENCE / (name + '.png')).write_bytes(adb('exec-out', 'screencap', '-p', binary=True))
    snapshot = nodes()
    (EVIDENCE / (name + '.txt')).write_text('\n'.join(
        ' | '.join(labels(n)) for n in snapshot if any(labels(n))), encoding='utf8')


def about():
    for _ in range(8):
        snapshot = nodes()
        if find('网页程序更新', snapshot):
            if not find('检查更新', snapshot):
                tap('网页程序更新')
            return
        for label, exact in [('关于屁屁机', False), ('设置', True), ('我', True), ('返回', True)]:
            element = find(label, snapshot, exact)
            if element:
                tap_node(element)
                break
        else:
            raise AssertionError('Cannot navigate to About through Android UI')
    raise AssertionError('About navigation did not finish')


def chat():
    for _ in range(6):
        snapshot = nodes()
        if find('消息', snapshot):
            tap('消息')
            break
        tap('返回')
    tap('Gate Friend', exact=False)
    wait('Message before upgrade', exact=False)


def connect():
    adb('reverse', 'tcp:18766', 'tcp:18766')
    adb('install', '-g', os.environ['GATE_APK_PATH'])
    installed = adb('shell', 'dumpsys', 'package', PACKAGE)
    assert 'versionName=0.1.21' in installed and 'versionCode=23' in installed
    assert 'DEBUGGABLE' not in installed, 'The gate must use the non-debuggable official APK'
    (EVIDENCE / 'android-package.txt').write_text(installed, encoding='utf8')
    adb('shell', 'am', 'start', '-n', PACKAGE + '/.MainActivity')
    wait('进入小手机')
    edits = [n for n in nodes() if n.get('class') == 'android.widget.EditText']
    assert len(edits) == 2, 'Native first connection should request address and password'
    assert 'http://127.0.0.1:18766' in labels(edits[0]), 'Unexpected emulator development address'
    tap_node(edits[1])
    adb('shell', 'input', 'text', 'GateFixture2026')
    adb('shell', 'input', 'keyevent', '4')
    tap('进入小手机')
    for _ in range(30):
        snapshot = nodes()
        if find('我知道了', snapshot):
            tap('我知道了')
        elif find('Gate Friend', snapshot, False):
            break
        else:
            time.sleep(1)
    else:
        raise AssertionError('Authenticated Android chat list did not appear')
    chat()
    screenshot('android-before-chat')
    about()
    wait('v0.14.4')
    wait('更新完成')
    screenshot('android-before-update')


def install():
    tap('检查更新')
    wait('发现新版本 v0.14.5')
    screenshot('android-update-offer')
    tap('立即更新')
    wait('更新到 v0.14.5？')
    # The dialog is appended after the page and reuses its install caption.
    # Select the last match even on WebViews exposing the covered page as well.
    confirm = next(n for n in reversed(nodes()) if '立即更新' in labels(n)
                   and n.get('bounds') != '[0,0][0,0]')
    tap_node(confirm)
    wait('已排队', exact=False)
    screenshot('android-update-queued')


def complete():
    wait('已更新到 0.14.5', timeout=90, exact=False)
    screenshot('android-update-completed')
    tap('刷新页面')
    time.sleep(2)
    # Returning to the existing account must not require entering credentials.
    about()
    wait('v0.14.5')
    snapshot = nodes()
    assert not find('进入小手机', snapshot), 'Android login was lost across the server restart'
    screenshot('android-after-version')
    chat()
    screenshot('android-after-chat')
    print('Official Android 0.1.21 retained its session and old chat after web 0.14.4 -> 0.14.5', flush=True)


try:
    {'connect': connect, 'install': install, 'complete': complete}[sys.argv[1]]()
except Exception:
    try:
        screenshot('android-failure-' + sys.argv[1])
        (EVIDENCE / 'android-logcat.txt').write_text(adb('logcat', '-d', '-t', '1200'), encoding='utf8')
    except Exception as capture_error:
        print('Could not capture Android failure:', capture_error, file=sys.stderr)
    raise
