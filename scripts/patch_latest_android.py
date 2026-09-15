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

# This patcher intentionally does NOT depend on function names from an older export.
# The latest source has changed names/formatting between exports, so locate stable
# structural anchors and add small, isolated compatibility helpers instead.

# W Speed profile helper: provide one only when the current source has no profile entry point.
if 'function openWSpeedProfile(' not in text:
    helper = "function openWSpeedProfile(){if(typeof openProfile==='function')return openProfile();if(typeof showProfile==='function')return showProfile();if(typeof openWSpeed==='function')return openWSpeed();if(typeof openModal==='function')return openModal('<div style=\"text-align:center\"><h2>W Speed</h2><div class=\"eyebrow\">THE KNIGHT OF REALITY</div><p>Your personal quest companion.</p></div>');if(typeof toast==='function')toast('W Speed profile is unavailable in this build.');}\n"
    text = helper + text

# Online Mode helper/UI: preserve an existing implementation, otherwise create a safe one.
if 'function toggleOnlineMode(' not in text:
    text += "\nfunction toggleOnlineMode(){if(typeof s==='undefined'||!s)return;if(typeof s.onlineMode!=='boolean')s.onlineMode=false;s.onlineMode=!s.onlineMode;if(typeof save==='function')save();if(typeof updateOnlineModeUI==='function')updateOnlineModeUI();if(typeof toast==='function')toast('Online Mode '+(s.onlineMode?'enabled':'disabled')+'.');}\n"
if 'function updateOnlineModeUI(' not in text:
    text += "\nfunction updateOnlineModeUI(){const b=document.getElementById('onlineModeBtn');const st=document.getElementById('aiStatus');const on=typeof s!=='undefined'&&!!s.onlineMode;if(b)b.textContent='🌐 Online Mode: '+(on?'ON':'OFF');if(st)st.textContent=on?'online mode ready':'online mode off';}\n"

# Activity Awareness JS bridge: always provide a stable function, regardless of the
# source export's old requestUsage function name.
if 'function openActivityAwarenessSettings(' not in text:
    text += "\nfunction openActivityAwarenessSettings(){if(window.ActivityAwareness&&ActivityAwareness.openUsageAccessSettings){ActivityAwareness.openUsageAccessSettings();if(typeof toast==='function')toast('Enable Usage Access for Daily Quest, then return here.');}else if(typeof toast==='function')toast('Activity awareness is unavailable in this build.');}\n"

# Add menu controls using a structural id anchor rather than a complete menu string.
if 'id="onlineModeBtn"' not in text:
    m = re.search(r'<div[^>]*class=[\"\'][^\"\']*menu[^\"\']*[\"\'][^>]*id=[\"\']menu[\"\'][^>]*>', text)
    if not m:
        m = re.search(r'<div[^>]*id=[\"\']menu[\"\'][^>]*class=[\"\'][^\"\']*menu[^\"\']*[\"\'][^>]*>', text)
    if m:
        controls = '<button class="ghost" id="onlineModeBtn" onclick="toggleMenu();toggleOnlineMode()">🌐 Online Mode: OFF</button><button class="ghost" onclick="toggleMenu();openWSpeedProfile()">⚔️ W Speed Profile</button>'
        text = text[:m.end()] + controls + text[m.end():]
    else:
        print('Warning: menu container not found; Online Mode controls were not inserted.')

# Remove known description-required validation wherever it appears, but leave the field itself.
text = re.sub(r"if\s*\(\s*!desc\s*\)\s*return\s+toast\([^;]*description[^;]*\);?", "", text, flags=re.I)
text = re.sub(r"if\s*\(\s*!q\.description\s*\)\s*return\s+toast\([^;]*(?:description|required)[^;]*\);?", "", text, flags=re.I)
text = text.replace('Every quest needs a description.', '')
text = text.replace('A quest description is required.', '')

# If the source already has requestUsage, redirect it. Otherwise leave the helper available.
if re.search(r'function\s+requestUsage\s*\(', text):
    text = re.sub(
        r'function\s+requestUsage\s*\([^)]*\)\s*\{.*?\n?\}',
        "function requestUsage(){openActivityAwarenessSettings();}",
        text,
        count=1,
        flags=re.S,
    )

# Wire quest completion reaction only when a recognizable completion function exists.
if 'function wspeedQuestReaction(' not in text:
    text += "\nfunction wspeedQuestReaction(q){if(typeof addMsg!=='function')return;const lines=['Quest cleared. Nice. Do it again tomorrow.','XP secured. Your procrastination department is furious.','That checkbox just got destroyed.'];addMsg('ai',lines[Math.floor(Math.random()*lines.length)]+' +'+((q&&q.xp)||25)+' XP.');}\n"

# Avoid depending on exact completion function names. If the existing source already calls
# renderQuests/renderAchievements after completion, append a guarded reaction nearby once.
if 'wspeedQuestReaction(q)' not in text:
    anchor = "renderQuests();renderAchievements()"
    if anchor in text:
        text = text.replace(anchor, anchor + ';wspeedQuestReaction(q)', 1)

# Initialize Online Mode when the source has a normal DOM-ready-ish welcome call.
if 'updateOnlineModeUI();' not in text:
    for anchor in ('addWelcome();', 'renderQuests();', 'render();'):
        if anchor in text:
            text = text.replace(anchor, anchor + 'updateOnlineModeUI();', 1)
            break

html.write_text(text, encoding='utf-8')

# ----- Native Android Activity Awareness bridge -----
if 'import android.content.Intent;' not in j:
    j = re.sub(r'^(import\s+android\.content\.[^;]+;\s*)$', r'\1\nimport android.content.Intent;', j, count=1, flags=re.M)
    if 'import android.content.Intent;' not in j:
        j = 'import android.content.Intent;\n' + j
if 'import android.provider.Settings;' not in j:
    j = re.sub(r'^(import\s+android\.os\.[^;]+;\s*)$', r'\1\nimport android.provider.Settings;', j, count=1, flags=re.M)
    if 'import android.provider.Settings;' not in j:
        j = 'import android.provider.Settings;\n' + j
if 'import android.webkit.JavascriptInterface;' not in j:
    j = 'import android.webkit.JavascriptInterface;\n' + j

# Replace any existing openUsageSettings implementation safely using balanced braces.
def replace_void_method(src, name, body):
    pattern = r'(?:public\s+)?(?:final\s+)?void\s+' + re.escape(name) + r'\s*\(\s*\)\s*\{'
    match = re.search(pattern, src)
    if not match:
        return src, False
    brace = match.end() - 1
    depth = 0
    for idx in range(brace, len(src)):
        if src[idx] == '{': depth += 1
        elif src[idx] == '}':
            depth -= 1
            if depth == 0:
                replacement = match.group(0).split('{')[0] + '{\n            ' + body + '\n        }'
                return src[:match.start()] + replacement + src[idx+1:], True
    raise SystemExit('Unbalanced Java method: ' + name)

j, _ = replace_void_method(j, 'openUsageSettings', 'startActivity(new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS));')

# Register the new bridge using whichever WebView registration formatting the source uses.
if 'ActivityAwarenessBridge' not in j:
    registration = None
    for pat in (
        r'w\.addJavascriptInterface\(new\s+NotificationBridge\(\)\s*,\s*["\']AndroidNotifications["\']\s*\);',
        r'addJavascriptInterface\(new\s+NotificationBridge\(\)\s*,\s*["\']AndroidNotifications["\']\s*\);'
    ):
        mm = re.search(pat, j)
        if mm:
            registration = mm.group(0)
            break
    if not registration:
        raise SystemExit('Could not find the native NotificationBridge registration anchor in MainActivity.java.')
    j = j.replace(registration, registration + '\n        w.addJavascriptInterface(new ActivityAwarenessBridge(), "ActivityAwareness");', 1)
    bridge = '''\n    public class ActivityAwarenessBridge {\n        @JavascriptInterface\n        public void openUsageAccessSettings(){\n            startActivity(new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS));\n        }\n    }\n'''
    pos = j.rfind('\n}')
    if pos < 0:
        raise SystemExit('MainActivity closing brace not found.')
    j = j[:pos] + bridge + j[pos:]

java.write_text(j, encoding='utf-8')

# ----- Manifest permission -----
m = manifest.read_text(encoding='utf-8')
if 'android.permission.PACKAGE_USAGE_STATS' not in m:
    m = re.sub(r'(<manifest\b[^>]*>)', r'\1\n    <uses-permission android:name="android.permission.PACKAGE_USAGE_STATS" />', m, count=1)
manifest.write_text(m, encoding='utf-8')

# ----- Regression checks: check outcomes, not fragile source function names -----
checks = {
    'W Speed profile helper': 'function openWSpeedProfile(' in text,
    'Online Mode': 'function toggleOnlineMode(' in text,
    'Activity Awareness JS bridge': 'ActivityAwareness.openUsageAccessSettings' in text,
    'Activity Awareness Java bridge': 'ActivityAwarenessBridge' in j,
    'Usage Access intent': 'Settings.ACTION_USAGE_ACCESS_SETTINGS' in j,
    'Usage Access permission': 'android.permission.PACKAGE_USAGE_STATS' in m,
    'No recursive Usage Access call': 'runOnUiThread(() -> startActivity(new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)))' not in j,
    'No description-required message': 'Every quest needs a description.' not in text and 'A quest description is required.' not in text,
}
failed = [name for name, ok in checks.items() if not ok]
if failed:
    raise SystemExit('Patch regression checks failed: ' + ', '.join(failed))

print('Latest Daily Quest Android source patched; structural regression checks passed.')
