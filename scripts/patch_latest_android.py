from pathlib import Path
import re
import sys

root = Path(sys.argv[1])
app = root / 'app' / 'src' / 'main'
html = app / 'assets' / 'index.html'
java = app / 'java' / 'com' / 'dailyquest' / 'app' / 'MainActivity.java'
manifest = app / 'AndroidManifest.xml'

if not html.is_file() or not java.is_file():
    raise SystemExit('Expected Android source files were not found; refusing to guess a base.')

text = html.read_text(encoding='utf-8')
for marker in ('function sendAI()', 'function toggleOnlineMode()', 'function openWSpeedProfile()', 'function requestUsage()', 'function confirmComplete('):
    if marker not in text:
        raise SystemExit(f'Latest Android source is missing expected marker: {marker}')

# Restore the controls that were present in the latest W Speed UI but were not visible.
menu = '<div class="menu" id="menu">'
if 'id="onlineModeBtn"' not in text:
    controls = '<button class="ghost" id="onlineModeBtn" onclick="toggleMenu();toggleOnlineMode()">🌐 Online Mode: OFF</button><button class="ghost" onclick="toggleMenu();openWSpeedProfile()">⚔️ W Speed Profile</button>'
    text = text.replace(menu, menu + controls, 1)

# Descriptions are optional for both creation and editing.
text = text.replace("const desc=document.getElementById('qeDesc').value.trim();if(!desc)return toast('Every quest needs a description. Tell W Speed what actually has to be done.');", "const desc=document.getElementById('qeDesc').value.trim();")
text = text.replace("q.description=document.getElementById('edesc').value.trim();if(!q.description)return toast('A quest description is required.');", "q.description=document.getElementById('edesc').value.trim();")
text = text.replace("if(!q.description)return toast('Every quest needs a description.');", "")
text = text.replace("if(!q.description)return toast('A quest description is required.');", "")

# Activity Awareness uses its own native bridge.
text = text.replace("if(window.AndroidNotifications){AndroidNotifications.openUsageSettings();toast('Enable Usage Access for Daily Quest, then return here.')}else toast('Activity awareness is Android-only.')", "if(window.ActivityAwareness){ActivityAwareness.openUsageAccessSettings();toast('Enable Usage Access for Daily Quest, then return here.')}else toast('Activity awareness is unavailable in this build.')")

# Quest completion gets an immediate W Speed reaction while retaining XP/achievement logic.
if 'function wspeedQuestReaction(' not in text:
    reaction = "function wspeedQuestReaction(q){const lines=['Quest cleared. Nice. Do that again tomorrow.','You actually did it. The kingdom survives another day.','XP secured. Your procrastination department is furious.','That checkbox just got absolutely destroyed.'];addMsg('ai',lines[Math.floor(Math.random()*lines.length)]+' +'+(q.xp||25)+' XP.');}\n"
    text = text.replace('function confirmComplete(id){', reaction + 'function confirmComplete(id){', 1)
text = text.replace("toast('Quest cleared. +'+(q.xp||25)+' XP');renderQuests();renderAchievements()", "toast('Quest cleared. +'+(q.xp||25)+' XP');renderQuests();renderAchievements();wspeedQuestReaction(q)")

if 'addWelcome();updateOnlineModeUI();' not in text:
    text = text.replace('addWelcome();', 'addWelcome();updateOnlineModeUI();', 1)

html.write_text(text, encoding='utf-8')

j = java.read_text(encoding='utf-8')
if 'import android.content.Intent;' not in j:
    anchor = 'import android.content.Context;'
    j = j.replace(anchor, anchor + '\nimport android.content.Intent;', 1) if anchor in j else 'import android.content.Intent;\n' + j
if 'import android.provider.Settings;' not in j:
    anchor = 'import android.os.Bundle;'
    j = j.replace(anchor, anchor + '\nimport android.provider.Settings;', 1) if anchor in j else 'import android.provider.Settings;\n' + j

# Replace the complete openUsageSettings method body without using runOnUiThread.
def replace_method(src, name, body):
    m = re.search(r'public\\s+void\\s+' + re.escape(name) + r'\\s*\\(\\s*\\)\\s*\\{', src)
    if not m:
        return src, False
    brace = m.end() - 1
    depth = 0
    for idx in range(brace, len(src)):
        if src[idx] == '{':
            depth += 1
        elif src[idx] == '}':
            depth -= 1
            if depth == 0:
                return src[:brace+1] + '\n            ' + body + '\n        ' + src[idx:], True
    raise SystemExit('Unbalanced Java method: ' + name)

j, had_old_method = replace_method(j, 'openUsageSettings', 'startActivity(new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS));')

# Add a dedicated bridge if the source does not already expose one.
if 'ActivityAwarenessBridge' not in j:
    anchor = 'w.addJavascriptInterface(new NotificationBridge(),"AndroidNotifications");'
    if anchor not in j:
        anchor = 'w.addJavascriptInterface(new NotificationBridge(), "AndroidNotifications");'
    if anchor not in j:
        raise SystemExit('Notification bridge anchor not found; refusing to alter MainActivity.')
    j = j.replace(anchor, anchor + '\n        w.addJavascriptInterface(new ActivityAwarenessBridge(),"ActivityAwareness");', 1)
    bridge = '''\n    public class ActivityAwarenessBridge {\n        @JavascriptInterface public void openUsageAccessSettings(){\n            startActivity(new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS));\n        }\n    }\n'''
    pos = j.rfind('\n}')
    if pos < 0:
        raise SystemExit('MainActivity closing brace not found.')
    j = j[:pos] + bridge + j[pos:]
elif 'ActivityAwareness"' not in j:
    anchor = 'w.addJavascriptInterface(new NotificationBridge(),"AndroidNotifications");'
    if anchor not in j:
        anchor = 'w.addJavascriptInterface(new NotificationBridge(), "AndroidNotifications");'
    if anchor not in j:
        raise SystemExit('Notification bridge anchor not found.')
    j = j.replace(anchor, anchor + '\n        w.addJavascriptInterface(new ActivityAwarenessBridge(),"ActivityAwareness");', 1)

java.write_text(j, encoding='utf-8')

m = manifest.read_text(encoding='utf-8')
if 'android.permission.PACKAGE_USAGE_STATS' not in m:
    m = m.replace('<application', '<uses-permission android:name="android.permission.PACKAGE_USAGE_STATS" tools:ignore="ProtectedPermissions" />\n    <application', 1)
if 'xmlns:tools=' not in m:
    m = m.replace('<manifest ', '<manifest xmlns:tools="http://schemas.android.com/tools" ', 1)
manifest.write_text(m, encoding='utf-8')

# Assertions that guard against the exact regression the user reported.
if 'id="onlineModeBtn"' not in text: raise SystemExit('Online Mode control missing after patch.')
if 'W Speed Profile' not in text: raise SystemExit('W Speed profile control missing after patch.')
if 'ActivityAwareness' not in text or 'ActivityAwareness' not in j: raise SystemExit('Activity Awareness bridge missing after patch.')
if 'ACTION_USAGE_ACCESS_SETTINGS' not in j: raise SystemExit('Usage Access settings action missing.')
if 'runOnUiThread(() -> startActivity(new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)))' in j: raise SystemExit('Recursive/UI-wrapper Activity Awareness implementation still present.')
if 'Every quest needs a description' in text or 'A quest description is required' in text: raise SystemExit('Description requirement still present.')

print('Latest Daily Quest Android source patched and regression guards passed.')
