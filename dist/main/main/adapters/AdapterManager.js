"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdapterManager = void 0;
/**
 * Arsist Engine - Adapter Manager
 * SDKアダプター（パッチシステム）の管理
 * 新しいデバイスへの対応を追加するための拡張可能な設計
 */
const path = __importStar(require("path"));
const fs = __importStar(require("fs-extra"));
class AdapterManager {
    adaptersDir;
    adaptersCache = new Map();
    constructor() {
        this.adaptersDir = AdapterManager.resolveAdaptersDir();
    }
    static resolveAdaptersDir() {
        const candidates = [];
        // 1) Packaged app: electron-builder copies Adapters/ into resources/
        if (process.resourcesPath) {
            candidates.push(path.join(process.resourcesPath, 'Adapters'));
        }
        // 2) Dev / source tree
        candidates.push(path.join(process.cwd(), 'Adapters'));
        // 3) Relative from __dirname (dist/main/main -> ../../../)
        candidates.push(path.join(__dirname, '../../..', 'Adapters'));
        candidates.push(path.join(__dirname, '../../../..', 'Adapters'));
        for (const p of candidates) {
            try {
                if (fs.pathExistsSync(p))
                    return p;
            }
            catch { /* ignore */ }
        }
        // fallback to first candidate even if not yet present
        return candidates[0] ?? path.join(__dirname, '../../..', 'Adapters');
    }
    /**
     * 利用可能なすべてのアダプターを取得
     */
    async listAdapters() {
        try {
            await fs.ensureDir(this.adaptersDir);
            const entries = await fs.readdir(this.adaptersDir, { withFileTypes: true });
            const adapters = [];
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    const adapter = await this.loadAdapter(entry.name);
                    if (adapter) {
                        adapters.push(adapter);
                    }
                }
            }
            return adapters;
        }
        catch (error) {
            console.error('Failed to list adapters:', error);
            return [];
        }
    }
    /**
     * 特定のアダプターを取得
     */
    async getAdapter(adapterId) {
        if (this.adaptersCache.has(adapterId)) {
            return this.adaptersCache.get(adapterId);
        }
        return await this.loadAdapter(adapterId);
    }
    /**
     * 新しいアダプターを登録
     */
    async registerAdapter(adapter) {
        try {
            const adapterDir = path.join(this.adaptersDir, adapter.id);
            await fs.ensureDir(adapterDir);
            await fs.ensureDir(path.join(adapterDir, 'Manifest'));
            await fs.ensureDir(path.join(adapterDir, 'Scripts'));
            await fs.ensureDir(path.join(adapterDir, 'Packages'));
            await fs.ensureDir(path.join(adapterDir, 'Prefabs'));
            // アダプター設定ファイルを保存
            await fs.writeJSON(path.join(adapterDir, 'adapter.json'), adapter, { spaces: 2 });
            this.adaptersCache.set(adapter.id, adapter);
            return { success: true };
        }
        catch (error) {
            return { success: false, error: error.message };
        }
    }
    /**
     * アダプターのパッチをUnityプロジェクトに適用
     */
    async applyPatch(adapterId, unityProjectPath) {
        const adapter = await this.getAdapter(adapterId);
        if (!adapter) {
            return { success: false, appliedPatches: [], error: `Adapter '${adapterId}' not found` };
        }
        const appliedPatches = [];
        const adapterDir = path.join(this.adaptersDir, adapterId);
        try {
            for (const patch of adapter.patchFiles) {
                const sourcePath = path.join(adapterDir, patch.sourcePath);
                const destPath = path.join(unityProjectPath, patch.destinationPath);
                if (await fs.pathExists(sourcePath)) {
                    await fs.ensureDir(path.dirname(destPath));
                    await fs.copy(sourcePath, destPath, { overwrite: true });
                    appliedPatches.push(patch.description);
                }
            }
            // ProjectSettings の更新
            await this.updateProjectSettings(adapter, unityProjectPath);
            // manifest.json (Package Manager) の更新
            await this.updatePackageManifest(adapter, unityProjectPath);
            return { success: true, appliedPatches };
        }
        catch (error) {
            return { success: false, appliedPatches, error: error.message };
        }
    }
    /**
     * アダプターテンプレートを生成（新規デバイス対応時用）
     */
    async createAdapterTemplate(deviceName, manufacturer) {
        const adapterId = deviceName.replace(/\s+/g, '_');
        const adapterDir = path.join(this.adaptersDir, adapterId);
        try {
            // 既存チェック
            if (await fs.pathExists(adapterDir)) {
                return { success: false, error: 'Adapter already exists' };
            }
            // ディレクトリ構造作成
            await fs.ensureDir(path.join(adapterDir, 'Manifest'));
            await fs.ensureDir(path.join(adapterDir, 'Scripts'));
            await fs.ensureDir(path.join(adapterDir, 'Packages'));
            await fs.ensureDir(path.join(adapterDir, 'Prefabs'));
            // テンプレートアダプター設定
            const templateAdapter = {
                id: adapterId,
                name: deviceName,
                manufacturer: manufacturer,
                description: `${deviceName} adapter for Arsist Engine`,
                sdkVersion: '1.0.0',
                unityVersion: '2022.3.20f1',
                features: {
                    tracking6DoF: true,
                    tracking3DoF: true,
                    handTracking: false,
                    planeDetection: false,
                    imageTracking: false,
                    passthrough: true,
                    spatialAudio: false,
                },
                buildSettings: {
                    minSdkVersion: 29,
                    targetSdkVersion: 34,
                    targetArchitecture: 'ARM64',
                    graphicsAPI: 'OpenGLES3',
                    orientation: 'Landscape',
                    xrLoaderName: 'YourXRLoader',
                    requiredPackages: [
                        'com.unity.xr.arfoundation',
                        'com.unity.xr.openxr',
                    ],
                },
                patchFiles: [
                    {
                        type: 'manifest',
                        sourcePath: 'Manifest/AndroidManifest.xml',
                        destinationPath: 'Assets/Plugins/Android/AndroidManifest.xml',
                        description: 'Android Manifest with device permissions',
                    },
                    {
                        type: 'script',
                        sourcePath: 'Scripts/DeviceBuildPatcher.cs',
                        destinationPath: 'Assets/Arsist/Editor/DeviceBuildPatcher.cs',
                        description: 'Build pre-processor script',
                    },
                ],
            };
            await fs.writeJSON(path.join(adapterDir, 'adapter.json'), templateAdapter, { spaces: 2 });
            // テンプレートファイル作成
            await this.createTemplateFiles(adapterDir, deviceName);
            return { success: true, path: adapterDir };
        }
        catch (error) {
            return { success: false, error: error.message };
        }
    }
    // ========================================
    // Private Methods
    // ========================================
    async loadAdapter(adapterId) {
        try {
            const configPath = path.join(this.adaptersDir, adapterId, 'adapter.json');
            if (!await fs.pathExists(configPath)) {
                return null;
            }
            const adapter = await fs.readJSON(configPath);
            this.adaptersCache.set(adapterId, adapter);
            return adapter;
        }
        catch (error) {
            console.error(`Failed to load adapter ${adapterId}:`, error);
            return null;
        }
    }
    async updateProjectSettings(adapter, projectPath) {
        const settingsPath = path.join(projectPath, 'ProjectSettings', 'ProjectSettings.asset');
        // ProjectSettings.assetはYAML形式だが、完全な解析は複雑なため、
        // 実際のUnityプロジェクトではEditorスクリプトで設定を適用する
        // ここでは設定ファイルを生成し、Unityが読み込む形式で出力
        const buildSettingsJson = path.join(projectPath, 'Assets', 'ArsistGenerated', 'build_settings.json');
        await fs.ensureDir(path.dirname(buildSettingsJson));
        await fs.writeJSON(buildSettingsJson, adapter.buildSettings, { spaces: 2 });
    }
    async updatePackageManifest(adapter, projectPath) {
        const manifestPath = path.join(projectPath, 'Packages', 'manifest.json');
        try {
            let manifest = {};
            if (await fs.pathExists(manifestPath)) {
                manifest = await fs.readJSON(manifestPath);
            }
            if (!manifest.dependencies) {
                manifest.dependencies = {};
            }
            // 必要なパッケージを追加
            for (const pkg of adapter.buildSettings.requiredPackages) {
                if (!manifest.dependencies[pkg]) {
                    // バージョンは適切なものを設定（通常はSDK側で指定）
                    manifest.dependencies[pkg] = 'latest';
                }
            }
            await fs.writeJSON(manifestPath, manifest, { spaces: 2 });
        }
        catch (error) {
            console.error('Failed to update package manifest:', error);
        }
    }
    async createTemplateFiles(adapterDir, deviceName) {
        // AndroidManifest テンプレート
        const manifestContent = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="com.arsist.generated.app">

    <!-- Device-specific permissions -->
    <uses-feature android:name="android.hardware.usb.host" />
    
    <application>
        <meta-data android:name="com.arsist.target_device" android:value="${deviceName}" />
        
        <activity android:name="com.unity3d.player.UnityPlayerActivity"
                  android:theme="@style/UnityThemeSelector"
                  android:screenOrientation="landscape"
                  android:launchMode="singleTask"
                  android:configChanges="orientation|keyboardHidden|keyboard|screenSize|locale|layoutDirection|fontScale|screenLayout|density|uiMode"
                  android:hardwareAccelerated="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>`;
        await fs.writeFile(path.join(adapterDir, 'Manifest', 'AndroidManifest.xml'), manifestContent);
        // BuildPatcher テンプレート
        const patcherContent = `// Auto-generated adapter script for ${deviceName}
// Customize this script for device-specific build settings

using UnityEditor;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;

namespace Arsist.Adapters
{
    public class ${deviceName.replace(/\s+/g, '')}BuildPatcher : IPreprocessBuildWithReport
    {
        public int callbackOrder => 0;

        public void OnPreprocessBuild(BuildReport report)
        {
            if (report.summary.platform != BuildTarget.Android) return;

            UnityEngine.Debug.Log("[Arsist] Applying ${deviceName} patches...");

            // TODO: Add device-specific settings here
            // PlayerSettings.Android.minSdkVersion = AndroidSdkVersions.AndroidApiLevel29;
            // PlayerSettings.Android.targetSdkVersion = AndroidSdkVersions.AndroidApiLevel34;
            // PlayerSettings.SetScriptingBackend(BuildTargetGroup.Android, ScriptingImplementation.IL2CPP);
            // PlayerSettings.Android.targetArchitectures = AndroidArchitecture.ARM64;
        }
    }
}`;
        await fs.writeFile(path.join(adapterDir, 'Scripts', 'DeviceBuildPatcher.cs'), patcherContent);
    }
}
exports.AdapterManager = AdapterManager;
//# sourceMappingURL=AdapterManager.js.map