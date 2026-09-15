from pathlib import Path
import re
import sys

root = Path(sys.argv[1])
app = root / 'app' / 'src' / 'main'
html = app / 'assets' / 'index.html'
manifest = app / 'AndroidManifest.xml'

if not html.is_file() or not manifest.is_file():
    raise SystemExit('Expected Android source files were not found; refusing to guess a base.')

java_candidates = list(app.rglob('MainActivity.java'))
if not java_candidates:
    raise SystemExit('MainActivity.java was not found in the latest Android source.')
java = java_candidates[0]

text = html.read_text(encoding='utf-8')
j = java.read_text(encoding='utf-8')

# ---------- Small balanced-brace helpers ----------
def replace_js_function(src, name, replacement):
    match = re.search(r'function\s+' + re.escape(name) + r'\s*\([^)]*\)\s*\{', src)
    if not match:
        return src, False
    brace = match.end() - 1
    depth = 0
    quote = None
    escape = False
    for idx in range(brace, len(src)):
        ch = src[idx]
        if quote:
            if escape:
                escape = False
            elif ch == '\\':
                escape = True
            elif ch == quote:
                quote = None
            continue
        if ch in "'\"`":
            quote = ch
        elif ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                return src[:match.start()] + replacement + src[idx + 1:], True
    raise SystemExit('Unbalanced JavaScript function: ' + name)


def replace_void_method(src, name, body):
    pattern = r'(?:(?:public|private|protected|final|static)\s+)*void\s+' + re.escape(name) + r'\s*\(\s*\)\s*\{'
    match = re.search(pattern, src)
    if not match:
        return src, False
    brace = match.end() - 1
    depth = 0
    for idx in range(brace, len(src)):
        if src[idx] == '{':
            depth += 1
        elif src[idx] == '}':
            depth -= 1
            if depth == 0:
                prefix = match.group(0).split('{', 1)[0]
                replacement = prefix + '{\n            ' + body + '\n        }'
                return src[:match.start()] + replacement + src[idx + 1:], True
    raise SystemExit('Unbalanced Java method: ' + name)


# ---------- W Speed / UI ----------
if 'function openWSpeedProfile(' not in text:
    text = """function openWSpeedProfile(){if(typeof openProfile==='function')return openProfile();if(typeof showProfile==='function')return showProfile();if(typeof openWSpeed==='function')return openWSpeed();if(typeof openModal==='function')return openModal('<div style=\"text-align:center\"><h2>W Speed</h2><div class=\"eyebrow\">THE KNIGHT OF REALITY</div><p>Your personal quest companion.</p></div>');if(typeof toast==='function')toast('W Speed profile is unavailable in this build.');}\n""" + text

if 'function toggleOnlineMode(' not in text:
    text += "\nfunction toggleOnlineMode(){if(typeof s==='undefined'||!s)return;if(typeof s.onlineMode!=='boolean')s.onlineMode=false;s.onlineMode=!s.onlineMode;if(typeof save==='function')save();updateOnlineModeUI();if(typeof toast==='function')toast('Online Mode '+(s.onlineMode?'enabled':'disabled')+'.');}\n"
if 'function updateOnlineModeUI(' not in text:
    text += "\nfunction updateOnlineModeUI(){const b=document.getElementById('onlineModeBtn');const st=document.getElementById('aiStatus');const on=typeof s!=='undefined'&&!!s.onlineMode;if(b)b.textContent='🌐 Online Mode: '+(on?'ON':'OFF');if(st)st.textContent=on?'online mode ready':'online mode off';}\n"
if 'function openActivityAwarenessSettings(' not in text:
    text += "\nfunction openActivityAwarenessSettings(){if(window.ActivityAwareness&&typeof ActivityAwareness.openUsageAccessSettings==='function'){ActivityAwareness.openUsageAccessSettings();if(typeof toast==='function')toast('Enable Usage Access for Daily Quest, then return here.');}else if(typeof toast==='function')toast('Activity awareness is unavailable in this build.');}\n"

# Menu insertion: match the id regardless of attribute order, quoting, or class presence.
if 'id="onlineModeBtn"' not in text and "id='onlineModeBtn'" not in text:
    menu = re.search(r'<div\b[^>]*\bid\s*=\s*[\"\']menu[\"\'][^>]*>', text, flags=re.I)
    controls = '<button class="ghost" id="onlineModeBtn" onclick="toggleMenu();toggleOnlineMode()">🌐 Online Mode: OFF</button><button class="ghost" onclick="toggleMenu();openWSpeedProfile()">⚔️ W Speed Profile</button>'
    if menu:
        text = text[:menu.end()] + controls + text[menu.end():]
    else:
        # Do not silently lose the feature if the latest export changed its menu markup.
        body = re.search(r'</body\s*>', text, flags=re.I)
        if body:
            text = text[:body.start()] + '<div id="dailyQuestCompatControls">' + controls + '</div>' + text[body.start():]
        else:
            text += '<div id="dailyQuestCompatControls">' + controls + '</div>'

# Remove description-required validation without assuming exact surrounding formatting.
text = re.sub(r"if\s*\(\s*!\s*desc\s*\)\s*return\s+toast\([^;]*description[^;]*\)\s*;?", "", text, flags=re.I)
text = re.sub(r"if\s*\(\s*!\s*q\.description\s*\)\s*return\s+toast\([^;]*(?:description|required)[^;]*\)\s*;?", "", text, flags=re.I)
text = text.replace('Every quest needs a description.', '')
text = text.replace('A quest description is required.', '')

# Activity Awareness JS: replace the existing handler safely, even when its body has nested blocks.
text, _ = replace_js_function(text, 'requestUsage', 'function requestUsage(){openActivityAwarenessSettings();}')

# Completion reaction helper.
if 'function wspeedQuestReaction(' not in text:
    text += "\nfunction wspeedQuestReaction(q){if(typeof addMsg!=='function')return;const lines=['Quest cleared. Nice. Do it again tomorrow.','XP secured. Your procrastination department is furious.','That checkbox just got destroyed.'];addMsg('ai',lines[Math.floor(Math.random()*lines.length)]+' +'+((q&&q.xp)||25)+' XP.');}\n"

# Try to hook common completion-render sequences without requiring one exact whitespace style.
if 'W_SPEED_COMPLETION_HOOK' not in text:
    hook = "/* W_SPEED_COMPLETION_HOOK */"
    render_anchor = re.compile(r'(renderQuests\s*\(\s*\)\s*;\s*renderAchievements\s*\(\s*\))')
    if render_anchor.search(text):
        text = render_anchor.sub(lambda m: m.group(1) + ';' + hook + ';if(typeof q!==\'undefined\')wspeedQuestReaction(q)', text, count=1)
    else:
        # Keep the helper available; do not invent a completion function name.
        text += '\n' + hook + '\n'

# Initialize Online Mode UI at a stable render point if possible.
if 'updateOnlineModeUI();' not in text:
    for anchor in ('addWelcome();', 'renderQuests();', 'render();'):
        if anchor in text:
            text = text.replace(anchor, anchor + 'updateOnlineModeUI();', 1)
            break

html.write_text(text, encoding='utf-8')

# ---------- Native Android Activity Awareness bridge ----------
if 'import android.content.Intent;' not in j:
    j = 'import android.content.Intent;\n' + j
if 'import android.provider.Settings;' not in j:
    j = 'import android.provider.Settings;\n' + j
if 'import android.webkit.JavascriptInterface;' not in j:
    j = 'import android.webkit.JavascriptInterface;\n' + j

# Fix the known recursion bug by replacing the whole native method body.
j, _ = replace_void_method(j, 'openUsageSettings', 'startActivity(new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS));')

# Register ActivityAwareness next to the existing notification bridge.
if 'ActivityAwarenessBridge' not in j:
    registration = re.search(
        r'(?:w\.)?addJavascriptInterface\(new\s+NotificationBridge\(\)\s*,\s*[\"\']AndroidNotifications[\"\']\s*\);',
        j,
    )
    if not registration:
        raise SystemExit('Could not find the native NotificationBridge registration anchor in MainActivity.java.')
    j = j[:registration.end()] + '\n        w.addJavascriptInterface(new ActivityAwarenessBridge(), "ActivityAwareness");' + j[registration.end():]
    bridge = '''\n    public class ActivityAwarenessBridge {\n        @JavascriptInterface\n        public void openUsageAccessSettings(){\n            startActivity(new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS));\n        }\n    }\n'''
    pos = j.rfind('\n}')
    if pos < 0:
        raise SystemExit('MainActivity closing brace not found.')
    j = j[:pos] + bridge + j[pos:]

java.write_text(j, encoding='utf-8')

# ---------- Manifest permission ----------
m = manifest.read_text(encoding='utf-8')
if 'android.permission.PACKAGE_USAGE_STATS' not in m:
    m = re.sub(r'(<manifest\b[^>]*>)', r'\1\n    <uses-permission android:name="android.permission.PACKAGE_USAGE_STATS" />', m, count=1)
manifest.write_text(m, encoding='utf-8')

# ---------- Regression checks ----------
def method_body_contains(src, name, needle):
    pattern = r'(?:(?:public|private|protected|final|static)\s+)*void\s+' + re.escape(name) + r'\s*\(\s*\)\s*\{'
    match = re.search(pattern, src)
    if not match:
        return False
    brace = match.end() - 1
    depth = 0
    for idx in range(brace, len(src)):
        if src[idx] == '{':
            depth += 1
        elif src[idx] == '}':
            depth -= 1
            if depth == 0:
                return needle in src[brace + 1:idx]
    return False

checks = {
    'W Speed profile helper': 'function openWSpeedProfile(' in text,
    'Online Mode': 'function toggleOnlineMode(' in text and 'id="onlineModeBtn"' in text,
    'Activity Awareness JS bridge': 'ActivityAwareness.openUsageAccessSettings' in text,
    'Activity Awareness Java bridge': 'ActivityAwarenessBridge' in j,
    'Usage Access intent': 'Settings.ACTION_USAGE_ACCESS_SETTINGS' in j,
    'Usage Access permission': 'android.permission.PACKAGE_USAGE_STATS' in m,
    'Usage Access method is direct': method_body_contains(j, 'openUsageSettings', 'startActivity(new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS));'),
    'No recursive Usage Access method': not method_body_contains(j, 'openUsageSettings', 'openUsageSettings(') and not method_body_contains(j, 'openUsageSettings', 'runOnUiThread'),
    'No description-required message': 'Every quest needs a description.' not in text and 'A quest description is required.' not in text,
}
failed = [name for name, ok in checks.items() if not ok]
if failed:
    raise SystemExit('Patch regression checks failed: ' + ', '.join(failed))

print('Latest Daily Quest Android source patched; structural regression checks passed.')
