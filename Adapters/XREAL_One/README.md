# XREAL One Adapter for Arsist Engine

Device adapter for XREAL One AR glasses.

## Overview

This adapter provides the necessary configurations and patches to build AR applications for XREAL One/One Pro using the Arsist engine.

## Supported Devices

- XREAL One
- XREAL One Pro
- (XREAL Air series also has basic compatibility)

## Required SDKs

- **XREAL SDK**: 3.1.0以上
- **Unity**: 2022.3.20f1 LTS以上
- **AR Foundation**: 5.0.0以上
- **XR Interaction Toolkit**: 2.5.0以上
- **OpenXR Plugin**: 1.9.0以上

## Installation

1. Select XREAL One in the Arsist engine adapter management screen
2. Click "Install Adapter"
3. Patches will be automatically applied to the Unity project

## File Structure

```
XREAL_One/
├── adapter.json        # Adapter configuration file
├── XrealBuildPatcher.cs # Build patcher
├── AndroidManifest.xml  # Android manifest template
└── README.md           # This file
```

## Applied Patches

### Player Settings
- **Architecture**: ARM64 only
- **Scripting Backend**: IL2CPP
- **Graphics API**: OpenGLES3 only (Vulkan disabled)
- **Color Space**: Linear
- **Screen Orientation**: Landscape locked

### Quality Settings
- **Anti-Aliasing**: MSAAx4
- **Shadow Distance**: 20m
- **Target Frame Rate**: 60fps

### XR Configuration
- Enable XREAL Loader in XR Plug-in Management (Android)
- Initialize XR Interaction Toolkit
- Configure gaze/ray interaction

## Display Specifications

| Item | Value |
|------|-------|
| Resolution | 1920x1080 (per eye) |
| Field of View | 50° (horizontal) / 28° (vertical) |
| Refresh Rate | 60Hz / 90Hz |
| Color Depth | 24bit |

## Supported Features

| Feature | Support |
|---------|---------|
| 6DoF Tracking | ✅ |
| Plane Detection | ✅ |
| Image Tracking | ✅ |
| Spatial Mapping | ✅ |
| Gesture Recognition | ✅ |
| Hand Tracking | ❌ |
| Face Tracking | ❌ |
| Voice Input | ❌ |

## Usage

### From Arsist Editor

1. Create/open a project
2. Select "XREAL One" in build settings
3. Click "Build"

### From Command Line

```bash
# Build with Arsist CLI
arsist build --device xreal-one --output ./build/

# Direct Unity build
unity -batchmode -quit \
  -executeMethod Arsist.Builder.ArsistBuildPipeline.BuildFromCLI \
  -targetDevice xreal-one \
  -outputPath ./build/
```

## Performance Recommendations

1. **Draw Calls**: Keep below 100
2. **Polygon Count**: Below 100k for entire scene
3. **Textures**: Use ASTC compression, max 2048x2048
4. **Dynamic Lights**: Minimize usage
5. **Transparent Objects**: Reduce
6. **Single Pass Stereo Rendering**: Enable

## Troubleshooting

### Build Fails

- Verify XREAL SDK is installed
- Verify Unity version is 2022.3.20f1 or higher
- Verify Android SDK/NDK paths are configured

### App Won't Launch

- Verify APK is signed
- Verify minSdkVersion is 29 or higher
- Verify XREAL One firmware is up to date

### Tracking is Unstable

- Improve lighting conditions
- Avoid walls with few textures
- Check camera for dirt

## License

MIT License

## Support

- Issue Reports: https://github.com/arsist/adapters/issues
- Documentation: https://arsist.dev/docs/adapters/xreal-one
