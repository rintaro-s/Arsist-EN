# Arsist Engine

Arsist is a cross-platform development engine for AR glasses. Built with Electron and React, the editor provides integrated editing of scenes, UI, and logic, generating device-ready applications through Unity batch builds.

## Table of Contents

- [Requirements](#requirements)
- [Quick Start](#quick-start)
- [SDK Setup](#sdk-setup)
- [Project Structure](#project-structure)
- [Usage Guide](#usage-guide)
- [Building Applications](#building-applications)
- [Device Adapters](#device-adapters)
- [Scripting](#scripting)
- [Troubleshooting](#troubleshooting)

## Requirements

### Development Environment

- **Node.js**: 18 or higher
- **Unity**: 2022.3.20f1 LTS or higher
- **XREAL SDK**: 3.1.0 or higher
- **Meta Quest SDK**: Core package (`com.meta.xr.sdk.core-*.tgz`)
- **UniVRM**: 0.131.0 or higher (for VRM avatar support)


### Supported Target Devices

- ✅ XREAL One / One Pro
- ✅ Meta Quest (Quest 2, Quest 3, Quest Pro)

## Quick Start

### 1. Clone and Install

```bash
git clone https://github.com/rintaro-s/Arsist-EN.git
cd Arsist-EN
npm install
```

### 2. Set Up SDKs (see [SDK Setup](#sdk-setup) below)

### 3. Launch the Editor

```bash
npm run dev
```

The Arsist Editor will open. You can now create your first AR project!

## SDK Setup

The `sdk/` directory at the repository root must contain all required SDKs and dependencies. Follow these steps carefully:

### Directory Structure

Your `sdk/` folder should look like this:

```
sdk/
├── com.xreal.xr/
│   └── package/
│       ├── package.json
│       ├── Runtime/
│       ├── Editor/
│       └── ...
├── quest/
│   ├── com.meta.xr.sdk.core-XX.X.X.tgz
│   ├── com.meta.xr.mrutilitykit-XX.X.X.tgz (optional)
│   └── Unity-InteractionSDK-Samples/ (optional, for bootstrap)
├── nupkg/
│   ├── jint.X.X.X.nupkg
│   └── esprima.X.X.X.nupkg
├── UniVRM-0.131.0_3b99.unitypackage
├── JKG-M3.unitypackage
└── JKG-M_3.ttf
```

### 1. XREAL SDK Setup

**For XREAL One / XREAL Air 2 development:**

1. Download XREAL SDK 3.1.0+ from [XREAL Developer Portal](https://developer.xreal.com/)
2. Extract the UPM package to `sdk/com.xreal.xr/package/`
3. Verify `sdk/com.xreal.xr/package/package.json` exists

**Verification:**
- Open Arsist Editor → Settings (Ctrl+,) → SDK (XREAL) section
- Status should show "OK" with detected version

### 2. Meta Quest SDK Setup

**For Meta Quest development:**

1. Download Meta XR All-in-One SDK from [Meta Developer Portal](https://developer.oculus.com/)
2. Extract and locate these `.tgz` files:
   - `com.meta.xr.sdk.core-XX.X.X.tgz` (required)
   - `com.meta.xr.mrutilitykit-XX.X.X.tgz` (optional)
3. Place them in `sdk/quest/`

**Optional - Quest Sample Bootstrap:**
- If you have Unity-InteractionSDK-Samples, place the entire folder in `sdk/quest/`
- This provides XR settings and configurations that will be auto-applied

**Verification:**
- Open Arsist Editor → Settings → SDK (Quest) section
- Core package status should show "OK"

### 3. UniVRM Setup

**For VRM avatar support:**

1. Download UniVRM from [VRM Consortium](https://github.com/vrm-c/UniVRM/releases)
2. Place `UniVRM-0.131.0_3b99.unitypackage` in `sdk/`

### 4. Font Package Setup

**For Japanese text rendering (optional):**

1. Place `JKG-M3.unitypackage` in `sdk/`
2. Place `JKG-M_3.ttf` in `sdk/`

### 5. Jint Scripting Engine Setup

**For JavaScript runtime in Unity:**

1. Download Jint and Esprima NuGet packages
2. Place in `sdk/nupkg/`:
   - `jint.X.X.X.nupkg`
   - `esprima.X.X.X.nupkg`

**How to get NuGet packages:**
```bash
# Using NuGet CLI
nuget install Jint -OutputDirectory sdk/nupkg
nuget install Esprima -OutputDirectory sdk/nupkg
```

### SDK Status Check

After setup, verify all SDKs in the editor:
1. Launch Arsist: `npm run dev`
2. Open Settings (Ctrl+, or File → Settings)
3. Check SDK status sections for green "OK" indicators

## Project Structure

```
Arsist-EN/
├── src/
│   ├── main/              # Electron main process
│   │   ├── main.ts        # Application entry point
│   │   ├── unity/         # Unity build integration
│   │   ├── adapters/      # Device adapter management
│   │   └── preload.ts     # IPC bridge
│   ├── renderer/          # React UI (Editor)
│   │   ├── components/    # UI components
│   │   ├── stores/        # State management (Zustand)
│   │   └── App.tsx        # Main application
│   ├── bridge/            # Unity conversion layer
│   └── shared/            # Shared type definitions
├── UnityBackend/          # Unity project template
│   ├── Assets/
│   │   ├── Arsist/        # Core runtime scripts
│   │   ├── Scripts/       # Generated scripts
│   │   └── Resources/     # Runtime resources
│   └── ProjectSettings/
├── Adapters/              # Device adapters
│   ├── XREAL_One/         # XREAL One adapter
│   └── Meta_Quest/        # Meta Quest adapter
├── sdk/                   # SDKs (see SDK Setup)
├── docs/                  # Documentation
├── package.json           # Node.js dependencies
└── README.md              # This file
```

## Usage Guide

### Creating a New Project

1. Launch Arsist Editor: `npm run dev`
2. Click "New Project" or press Ctrl+N
3. Choose a template:
   - **3D AR Scene**: 6DoF tracking, spatial 3D objects
   - **2D Floating Screen**: 3DoF tracking, fixed 2D display
   - **Head-Locked HUD**: Head-locked UI overlay
4. Configure project name and location
5. Select target device (XREAL One or Meta Quest)
6. Click "Create Project"

### Editor Interface

The editor provides four main views:

#### 1. Scene View (3D)
- Place and manipulate 3D objects in AR space
- Configure object properties (position, rotation, scale)
- Set up AR tracking features (planes, images)

#### 2. UI Editor (2D)
- Figma-like visual UI editor
- Drag-and-drop UI components
- Real-time preview
- Responsive layout tools

#### 3. Script Editor
- Write JavaScript logic for your app
- Syntax highlighting with Monaco Editor
- Auto-completion and IntelliSense
- Access to Arsist API

#### 4. Data Flow Editor
- Visual programming with node graph
- Connect data sources to UI elements
- Event handling and state management

### Adding Assets

#### Import 3D Models
1. File → Import Asset → 3D Model
2. Supported formats: `.glb`, `.gltf`, `.fbx`, `.obj`
3. Models appear in Assets panel

#### Import VRM Avatars
1. File → Import Asset → VRM Avatar
2. Select `.vrm` file
3. Avatar appears in Assets panel with animation controls

#### Import Textures/Images
1. File → Import Asset → Texture
2. Supported formats: `.png`, `.jpg`, `.jpeg`

### Scripting Your App

Arsist uses JavaScript for application logic. Scripts run in Unity via Jint.

**Example: Button Click Handler**

```javascript
// In Script Editor
function onButtonClick() {
  console.log("Button clicked!");
  UI.setText("statusText", "Hello AR World!");
}

// Bind to UI button
UI.onClick("myButton", onButtonClick);
```

**Example: Update Loop**

```javascript
function update(deltaTime) {
  // Rotate object continuously
  var rotation = Scene.getRotation("myObject");
  rotation.y += 45 * deltaTime;
  Scene.setRotation("myObject", rotation);
}

// Register update callback
Scene.onUpdate(update);
```

See `docs/scripting-api.md` for complete API reference.

### Saving Your Project

- Auto-save: Enabled by default (every 2 minutes)
- Manual save: Ctrl+S or File → Save
- Save As: Ctrl+Shift+S or File → Save As

## Building Applications

### Build Configuration

1. Open Build Dialog: Ctrl+B or Build → Build Settings
2. Configure:
   - **Unity Path**: Path to Unity 2022.3.20f1+ executable
   - **Target Device**: XREAL One or Meta Quest
   - **Output Path**: Where to save the APK
   - **Development Build**: Enable for debugging

### Build Process

1. Click "Start Build" in Build Dialog
2. Arsist will:
   - Export your project to Unity format
   - Embed required SDKs (XREAL or Quest)
   - Apply device-specific patches
   - Invoke Unity batch build
   - Generate APK file

**Build Output:**
```
OutputPath/
├── TempUnityProject/      # Temporary Unity project
├── YourApp.apk            # Final APK (Android)
└── build.log              # Build log
```

### Installing on Device

**XREAL One (via Beam Pro):**
```bash
adb install YourApp.apk
```

**Meta Quest:**
```bash
adb install YourApp.apk
# Enable developer mode on Quest first
```

### Build Troubleshooting

**Unity License Error:**
- Open Unity Hub and sign in
- Activate license for this PC
- Launch Unity Editor once manually (for first-time activation)

**SDK Not Found:**
- Check Settings → SDK status
- Verify `sdk/` directory structure
- Restart Arsist Editor

**Build Fails:**
- Check Build Log in Build Dialog
- Verify Unity version (2022.3.20f1 LTS+)
- Ensure Android SDK/NDK configured in Unity

## Device Adapters

Adapters are located in `Adapters/` and provide device-specific configurations.

### XREAL One Adapter

**Location:** `Adapters/XREAL_One/`

**Features:**
- 6DoF tracking
- Plane detection
- Image tracking
- Spatial mapping
- Gesture recognition

**Configuration:**
- Graphics API: OpenGLES3 only
- Architecture: ARM64
- Scripting Backend: IL2CPP
- Target FPS: 60

See `Adapters/XREAL_One/README.md` for details.

### Meta Quest Adapter

**Location:** `Adapters/Meta_Quest/`

**Features:**
- 6DoF tracking
- Hand tracking
- Passthrough AR
- Guardian system integration

**Configuration:**
- Graphics API: Vulkan (preferred) or OpenGLES3
- Architecture: ARM64
- Scripting Backend: IL2CPP

See `Adapters/Meta_Quest/README.md` for details.

## Scripting

### Arsist JavaScript API

Arsist provides a JavaScript API for controlling your AR app:

**Scene API:**
```javascript
Scene.createObject("cube", "myCube");
Scene.setPosition("myCube", {x: 0, y: 1, z: 2});
Scene.setRotation("myCube", {x: 0, y: 45, z: 0});
Scene.setScale("myCube", {x: 1, y: 1, z: 1});
Scene.destroy("myCube");
```

**UI API:**
```javascript
UI.setText("label1", "Hello World");
UI.getText("label1");
UI.setVisible("panel1", true);
UI.onClick("button1", handleClick);
```

**Data API:**
```javascript
Data.set("score", 100);
Data.get("score");
Data.increment("score", 10);
```

**Network API:**
```javascript
Network.get("https://api.example.com/data", function(response) {
  console.log(response);
});

Network.post("https://api.example.com/submit", {
  name: "John",
  score: 100
}, function(response) {
  console.log(response);
});
```

See `docs/scripting-api.md` for complete documentation.

## Troubleshooting

### Editor Won't Start
- Check Node.js version: `node --version` (should be 18+)
- Delete `node_modules/` and run `npm install` again
- Check console for errors

### Build Fails with "SDK Not Found"
- Verify SDK directory structure matches [SDK Setup](#sdk-setup)
- Check Settings → SDK status in editor
- Ensure `package.json` exists in SDK folders

### App Crashes on Device
- Enable Development Build for debugging
- Check `adb logcat` for crash logs
- Verify device firmware is up to date
- Ensure APK is signed properly

### Performance Issues
- Reduce polygon count (< 100k per scene)
- Use texture compression (ASTC)
- Limit draw calls (< 100)
- Enable Single Pass Stereo Rendering
- Reduce dynamic lights

### VRM Avatars Not Loading
- Verify UniVRM package in `sdk/`
- Check VRM file version compatibility
- Ensure VRM file is not corrupted

## Documentation

Comprehensive documentation is available in the `docs/` folder:

- `docs/architecture.md` - System architecture overview
- `docs/scripting-api.md` - Complete JavaScript API reference
- `docs/scripting-guide.md` - Scripting tutorials and examples
- `docs/vrm-integration-guide.md` - VRM avatar integration
- `docs/samples/` - Sample projects and tutorials
- `docs/complete-usage-guide.md` - Detailed usage guide
