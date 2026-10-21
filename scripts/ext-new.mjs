#!/usr/bin/env node
/**
 * 拡張機能の雛形を作る。
 *
 *   npm run ext:new -- <id> [--requires <tag>,<tag>] [--name "<表示名>"] [--dir <置き場>]
 *
 *   <id>         kebab-case (例: hand-gestures)。フォルダ名・extension.json の id・C# の名前空間になる
 *   --requires   どの端末で動くか (タグ)。例: --requires cap:hand-tracking
 *                省略するとどの端末でも動く (src/shared/tags.ts にタグの一覧)
 *   --name       エディタに出す名前 (日本語でよい。英語名は id から作る)
 *   --device     端末を足す拡張機能にする。例: --device My_Glasses
 *                Adapters/My_Glasses/ (adapter.json・AndroidManifest.xml) と、XR の設定を書くビルドフックの
 *                雛形ができ、プロジェクトの targetDevice に My_Glasses を選べるようになる
 *   --replaces   エンジンの部品を置き換える拡張機能にする。例: --replaces vrm-loader / storage-backend / script:audio
 *                (一覧は src/shared/engineParts.ts)。入口に ReplaceEngineParts と、その部品の実装の雛形ができる
 *   --dir        置き場。既定は Extensions/ (エンジンに同梱)。自分用なら
 *                <ユーザーデータ>/extensions (エディタの「自分の拡張機能のフォルダを開く」)か、
 *                好きなフォルダに作って登録する (npm run ext:link -- <そのフォルダ>。コピーせずに使われる)
 *
 * できるもの:
 *   extension.json                設定 1 つ・物ごとの指定 1 つ・スクリプトの名前 1 つ入りの見本
 *   Runtime/<Name>Extension.cs    実機の入口 (OnStart / スクリプト API)
 *   Editor/<Name>BuildHook.cs     ビルド時のフック (中身は空。要らなければ消してよい)
 *   README.md
 *
 * 作ったあとは: エディタの拡張機能タブでスイッチを入れてビルド。
 * 詳しくは doc/17-extensions.md。
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 組み込みの名前と、置き換えられる部品は TypeScript 側の一覧から読む (二重に持たない)
const EXTENSIONS_TS = fs.readFileSync(path.join(ROOT, 'src/shared/extensions.ts'), 'utf8');
const PARTS_TS = fs.readFileSync(path.join(ROOT, 'src/shared/engineParts.ts'), 'utf8');
const listIn = (text, start) => {
  const from = text.indexOf(start);
  return [...text.slice(from, text.indexOf(']', from)).matchAll(/'([^']+)'/g)].map((m) => m[1]);
};
const BUILTIN = listIn(EXTENSIONS_TS, 'BUILTIN_SCRIPT_GLOBALS = [');
const SCRIPT_PARTS = listIn(PARTS_TS, 'REPLACEABLE_SCRIPT_GLOBALS = [');
const PARTS = Object.fromEntries([...PARTS_TS.matchAll(/id: '([a-z-]+)',[\s\S]*?csInterface: '([\w.]+)'/g)].map((m) => [m[1], m[2]]));
const TAG_RE = /^(device|platform|cap|sdk|feature|ext):(\*|[a-z0-9][a-z0-9.-]*)$/;

function fail(message) {
  console.error(`ext:new: ${message}`);
  process.exit(1);
}

const args = process.argv.slice(2);
const opts = { requires: [], name: null, dir: path.join(ROOT, 'Extensions'), device: null, replaces: [] };
let id = null;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--requires') opts.requires = String(args[++i] ?? '').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
  else if (a === '--name') opts.name = args[++i];
  else if (a === '--device') opts.device = args[++i];
  else if (a === '--replaces') opts.replaces = String(args[++i] ?? '').split(',').map((t) => t.trim()).filter(Boolean);
  else if (a === '--dir') opts.dir = path.resolve(args[++i] ?? '');
  else if (a === '-h' || a === '--help') { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]); process.exit(0); }
  else if (!id) id = a;
  else fail(`unexpected argument "${a}"`);
}

if (!id) fail('usage: npm run ext:new -- <id> [--requires cap:hand-tracking] [--name "表示名"] [--dir <folder>]');
if (!/^[a-z][a-z0-9-]{1,40}$/.test(id)) fail(`"${id}" must be kebab-case (a-z, 0-9, -), starting with a letter`);
for (const t of opts.requires) if (!TAG_RE.test(t)) fail(`"${t}" is not a tag (namespace:value; namespaces device / platform / cap / sdk / feature / ext)`);

for (const part of opts.replaces) {
  if (part.startsWith('script:') ? !SCRIPT_PARTS.includes(part.slice(7)) : !PARTS[part]) {
    fail(`--replaces "${part}" is not a replaceable engine part (${Object.keys(PARTS).join(', ')}, or script:<${SCRIPT_PARTS.join('|')}>)`);
  }
}

if (opts.device && !/^[A-Za-z][A-Za-z0-9_]{1,60}$/.test(opts.device)) fail(`--device "${opts.device}" must be a folder name (letters, digits, _), e.g. My_Glasses`);
const deviceId = opts.device ? opts.device.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/_/g, '-').toLowerCase() : null;
// 端末の拡張機能は、自分の端末向けのビルドでだけ動く (タグ device:<id> は adapter.json の id から付く)
if (deviceId && opts.requires.length === 0) opts.requires = [`device:${deviceId}`];

const pascal = id.split('-').map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');
const camel = pascal.charAt(0).toLowerCase() + pascal.slice(1);
if (BUILTIN.includes(camel)) fail(`the script name "${camel}" would clash with a built-in; pick another id`);
const english = id.split('-').map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
const displayJa = opts.name ?? english;

const dir = path.join(opts.dir, id);
if (fs.existsSync(dir)) fail(`${dir} already exists`);

const manifest = {
  id,
  version: '0.1.0',
  name: { en: english, ja: displayJa },
  description: {
    en: `TODO: what ${english} does, in one or two sentences.`,
    ja: `TODO: ${displayJa} が何をするかを 1〜2 文で。`,
  },
  tags: [],
  ...(opts.requires.length > 0 ? { requires: { all: opts.requires } } : {}),
  minIrVersion: 4,
  data: {
    version: 1,
    settings: [
      {
        key: 'greeting',
        type: 'string',
        default: 'Hello',
        label: { en: 'Greeting', ja: 'あいさつ' },
        help: { en: 'An example setting. The editor builds this form from extension.json.', ja: '設定の見本です。エディタはこの入力欄を extension.json から作ります。' },
      },
    ],
    object: [
      {
        key: 'highlight',
        type: 'boolean',
        default: false,
        label: { en: 'Highlight this object', ja: 'この物を目立たせる' },
      },
    ],
    migrations: [],
  },
  script: { globals: [camel] },
  ...(opts.replaces.length > 0 ? { replaces: opts.replaces } : {}),
  ...(opts.device ? { provides: { adapters: [opts.device] } } : {}),
  unity: { entry: `Arsist.Extensions.${pascal}.${pascal}Extension` },
};

// --replaces: 部品ごとの実装の雛形 (Runtime/<Name><Part>.cs) と、入口で渡すコード
const partClass = (part) => pascal + part.split('-').map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');
const enginePartFiles = {};
const partLines = [];
for (const part of opts.replaces.filter((p) => !p.startsWith('script:'))) {
  const cls = partClass(part);
  const iface = PARTS[part];
  const ifaceName = iface.split('.').pop();
  const ns = iface.split('.').slice(0, -1).join('.');
  partLines.push(`            parts.Replace<${ifaceName}>("${part}", new ${cls}(context));`);
  enginePartFiles[`${cls}.cs`] = part === 'vrm-loader' ? `// ${id}: VRM の読み込み (エンジンの "vrm-loader" を置き換える)。doc/17-extensions.md §2.6
using System;
using System.Collections;
using Arsist.Runtime.Extensions;
using ${ns};
using UnityEngine;

namespace Arsist.Extensions.${pascal}
{
    [UnityEngine.Scripting.Preserve]
    public sealed class ${cls} : ${ifaceName}
    {
        private readonly ArsistExtensionContext _context;

        public ${cls}(ArsistExtensionContext context)
        {
            _context = context;
        }

        // data (.vrm の中身) からモデルを作り、ルートを onLoaded に渡す (人型の Animator 付き)。
        // 表情・目を自分の仕組みで動かすなら、ルートに IArsistVrmFace / IArsistVrmEyes を実装した部品を付ける。
        public IEnumerator Load(byte[] data, string source, Action<GameObject> onLoaded, Action<string> onError)
        {
            _context.Log($"loading {source} ({data.Length} bytes)");
            yield return null;
            onError("TODO: load the VRM here");
        }
    }
}
` : part === 'storage-backend' ? `// ${id}: 端末に保存する値の置き場 (エンジンの "storage-backend" を置き換える)。doc/17-extensions.md §2.6
// 見本として PlayerPrefs に書く。クラウドに送るなら、Write は手元に置いてから裏で送る (メインスレッドで待たない)。
using Arsist.Runtime.Extensions;
using ${ns};
using UnityEngine;

namespace Arsist.Extensions.${pascal}
{
    [UnityEngine.Scripting.Preserve]
    public sealed class ${cls} : ${ifaceName}
    {
        private const string Key = "${id}.storage";
        private readonly ArsistExtensionContext _context;

        public ${cls}(ArsistExtensionContext context)
        {
            _context = context;
        }

        public string Name => $"PlayerPrefs[{Key}]";

        public string Read() => PlayerPrefs.HasKey(Key) ? PlayerPrefs.GetString(Key) : null;

        public void Write(string text)
        {
            PlayerPrefs.SetString(Key, text);
            PlayerPrefs.Save();
        }

        public void KeepUnreadable(string text)
        {
            PlayerPrefs.SetString(Key + ".broken", text ?? "");
            _context.Warn("saved values could not be read; kept them aside");
        }
    }
}
` : `// ${id}: ${part}
`;
}
const replaceParts = partLines.length === 0 ? '' : `
        // エンジンの部品を置き換える (extension.json の replaces)。エンジンがその部品を初めて使う前に 1 回。
        public override void ReplaceEngineParts(ArsistEngineParts.Replacer parts, ArsistExtensionContext context)
        {
${partLines.join('\n')}
        }
`;
const partUsings = [...new Set(opts.replaces.filter((p) => PARTS[p]).map((p) => PARTS[p].split('.').slice(0, -1).join('.')))]
  .map((ns) => `\nusing ${ns};`).join('');
const scriptParts = opts.replaces.filter((p) => p.startsWith('script:')).map((p) => p.slice(7));
const scriptReplacements = scriptParts.map((name) =>
  `\n            // 組み込みの \`${name}\` を置き換える (replaces: "script:${name}")。スクリプトにはこちらが渡る\n            script.Set("${name}", new ${pascal}ScriptApi(context));`).join('');

const runtime = `// ==============================================
// Arsist Extension: ${id} — entry point
// (generated by npm run ext:new; see doc/17-extensions.md)
// ==============================================

using Arsist.Runtime.Extensions;
using Arsist.Runtime.Inference;${partUsings}
using UnityEngine;

namespace Arsist.Extensions.${pascal}
{
    [UnityEngine.Scripting.Preserve]
    public sealed class ${pascal}Extension : ArsistRuntimeExtension
    {
        public override string Id => "${id}";

        // スクリプトエンジンの初期化中 (Awake) に呼ばれる。スクリプトを使わないプロジェクトでは呼ばれない。
        public override void RegisterScriptGlobals(ArsistScriptBridge script, ArsistExtensionContext context)
        {
            script.Set("${camel}", new ${pascal}ScriptApi(context));${scriptReplacements}
        }
${replaceParts}
        // シーンが始まったら 1 回。
        public override void OnStart(ArsistExtensionContext context)
        {
            context.Log($"started on {context.TargetDevice} (greeting = {context.GetString("greeting", "Hello")})");
            context.SetStore("${camel}.ready", true);

            foreach (var obj in context.ObjectsWithData())
            {
                var data = context.ObjectData(obj);
                if (MiniJson.Bool(data, "highlight", false)) context.Log($"'{obj.name}' asks to be highlighted");
            }
        }
    }

    /// <summary>スクリプトの \`${camel}\`。メソッドには [Preserve] を付ける (IL2CPP に消されないように)。</summary>
    [UnityEngine.Scripting.Preserve]
    public sealed class ${pascal}ScriptApi
    {
        private readonly ArsistExtensionContext _context;

        internal ${pascal}ScriptApi(ArsistExtensionContext context)
        {
            _context = context;
        }

        [UnityEngine.Scripting.Preserve]
        public string hello(string name) => $"{_context.GetString("greeting", "Hello")}, {name}";
    }
}
`;

const deviceEditor = `// ==============================================
// Arsist Extension: ${id} — device build hook for ${opts.device}
// (generated by npm run ext:new --device; see doc/17-extensions.md §2.2.1)
// ==============================================

using Arsist.Builder.Extensions;

namespace Arsist.Extensions.${pascal}.Build
{
    public sealed class ${pascal}BuildHook : ArsistBuildExtension
    {
        public override string ExtensionId => "${id}";

        // 端末のパッチ (AndroidManifest など) を当てたあと。XR の設定はここ。
        public override void OnPlayerSettings(ArsistBuildContext context)
        {
            if (!context.IsTargetDevice("${opts.device}")) return;
            context.Log("configuring ${opts.device}");

            // 端末の SDK を extension.json の unity.packages で入れたら、そのローダーと機能を有効にする。例:
            // context.AddXRLoader("UnityEngine.XR.OpenXR.OpenXRLoader");
            // context.EnableOpenXRFeature("com.vendor.openxr.feature.device");
        }

        // シーンを保存する直前。端末の SDK が要る部品 (セッション管理など) をシーンに置くならここ。
        public override void OnScene(ArsistBuildContext context)
        {
        }
    }
}
`;

const editor = `// ==============================================
// Arsist Extension: ${id} — build hook (optional; delete this file if you do not need it)
// ==============================================

using Arsist.Builder.Extensions;

namespace Arsist.Extensions.${pascal}.Build
{
    public sealed class ${pascal}BuildHook : ArsistBuildExtension
    {
        public override string ExtensionId => "${id}";

        // シーンを保存する直前。部品をシーンに置くならここ。
        public override void OnScene(ArsistBuildContext context)
        {
            context.Log($"building for {context.TargetDevice} with {context.DeviceTags.Count} device tags");
        }

        // 端末のパッチを当てたあと。PlayerSettings や SDK の設定を変えるならここ。
        public override void OnPlayerSettings(ArsistBuildContext context)
        {
        }
    }
}
`;

const readme = `# ${displayJa} (${id})

TODO: 何ができる拡張機能か。

## どこで動くか

${opts.requires.length > 0 ? opts.requires.map((t) => `- \`${t}\``).join('\n') : 'どの端末でも (requires なし)。'}

## 設定

| 項目 | 意味 |
|---|---|
| greeting | 見本の設定 |

## スクリプト

\`\`\`js
log(${camel}.hello('Arsist'));
\`\`\`

## データの形を変えるとき

\`extension.json\` の \`data.version\` を上げ、\`data.migrations\` に
\`{ "from": 1, "to": 2, "settings": [ { "op": "rename", "path": "old", "to": "new" } ] }\` のように足す。
プロジェクトを開くと、この拡張機能のデータだけが移行される (doc/17-extensions.md)。
`;

fs.mkdirSync(path.join(dir, 'Runtime'), { recursive: true });
fs.mkdirSync(path.join(dir, 'Editor'), { recursive: true });
fs.writeFileSync(path.join(dir, 'extension.json'), JSON.stringify(manifest, null, 2) + '\n');
fs.writeFileSync(path.join(dir, 'Runtime', `${pascal}Extension.cs`), runtime);
for (const [file, text] of Object.entries(enginePartFiles)) fs.writeFileSync(path.join(dir, 'Runtime', file), text);
fs.writeFileSync(path.join(dir, 'Editor', `${pascal}BuildHook.cs`), opts.device ? deviceEditor : editor);

if (opts.device) {
  const adapterDir = path.join(dir, 'Adapters', opts.device);
  fs.mkdirSync(adapterDir, { recursive: true });
  const adapter = {
    id: deviceId,
    name: opts.device.replace(/_/g, ' '),
    version: '0.1.0',
    description: 'TODO: the device in one sentence.',
    device: { manufacturer: 'TODO', displayName: opts.device.replace(/_/g, ' '), category: 'ar_glasses' },
    display: { fieldOfView: { horizontal: 50, vertical: 28 } },
    tagsNote: 'id → device:*, build.platform → platform:*, capabilities (true) → cap:* は自動で付く。表に無い性質だけを tags に書く (src/shared/adapterTags.ts)。',
    tags: [],
    capabilities: { sixDofTracking: false, threeDofTracking: true, handTracking: false, passthrough: false },
    build: { platform: 'Android', minApiLevel: 29, targetApiLevel: 34, architecture: ['arm64-v8a'], scriptingBackend: 'IL2CPP' },
  };
  fs.writeFileSync(path.join(adapterDir, 'adapter.json'), JSON.stringify(adapter, null, 2) + '\n');
  // 入口とテーマは対 (UnityPlayerActivity + UnityThemeSelector)。CLAUDE.md の注意を参照
  fs.writeFileSync(path.join(adapterDir, 'AndroidManifest.xml'), `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:tools="http://schemas.android.com/tools">
    <application
        android:label="@string/app_name"
        android:theme="@android:style/Theme.Black.NoTitleBar.Fullscreen"
        android:usesCleartextTraffic="true"
        tools:replace="android:theme,android:usesCleartextTraffic">
        <activity
            android:name="com.unity3d.player.UnityPlayerActivity"
            android:theme="@style/UnityThemeSelector"
            android:configChanges="density|fontScale|keyboard|keyboardHidden|layoutDirection|locale|mnc|mcc|navigation|orientation|screenLayout|screenSize|smallestScreenSize|uiMode|touchscreen"
            android:exported="true"
            android:launchMode="singleTask"
            android:screenOrientation="landscape">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
            <meta-data android:name="unityplayer.UnityActivity" android:value="true" />
        </activity>
    </application>
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
</manifest>
`);
}
fs.writeFileSync(path.join(dir, 'README.md'), readme);

console.log(`Created ${path.relative(process.cwd(), dir) || dir}`);
console.log('  extension.json               何で・どこで動き・どんな設定を持つか');
console.log(`  Runtime/${pascal}Extension.cs   実機の入口 (script: ${camel}.hello(name))`);
console.log(`  Editor/${pascal}BuildHook.cs    ビルド時のフック (要らなければ消す)`);
for (const file of Object.keys(enginePartFiles)) console.log(`  Runtime/${file}   置き換える部品の実装 (ReplaceEngineParts で渡す)`);
if (opts.replaces.length > 0) console.log(`  replaces: ${opts.replaces.join(', ')} — 有効にしたプロジェクトでは、エンジン標準の代わりにこちらが使われる`);
console.log('');
if (opts.device) {
  console.log(`  Adapters/${opts.device}/             端末のアダプタ (adapter.json・AndroidManifest.xml)`);
  console.log('');
  console.log(`Next: エディタで targetDevice に ${opts.device} を選ぶと、この拡張機能が自動で入ります。`);
  console.log('      SDK は Packages/ に置いて extension.json の unity.packages に書き、Editor のフックで XR を設定します。');
}
console.log('Next: エディタの拡張機能タブでスイッチを入れて、ビルド。');
console.log('      npm test で extension.json の形も確かめられます (Extensions/ に置いた場合)。');
