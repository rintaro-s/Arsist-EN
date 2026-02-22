"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.convertSceneToUnity = convertSceneToUnity;
exports.convertUIToUnity = convertUIToUnity;
exports.generateUnityManifest = generateUnityManifest;
/**
 * シーンデータをUnity用JSONに変換
 */
function convertSceneToUnity(scene) {
    return {
        name: scene.name,
        gameObjects: scene.objects.map(obj => convertObjectToUnity(obj)),
    };
}
function convertObjectToUnity(obj) {
    const components = [];
    // Add mesh components for primitives
    if (obj.type === 'primitive') {
        components.push({
            type: 'MeshFilter',
            properties: {
                mesh: getPrimitiveMeshName(obj.primitiveType),
            },
        });
        components.push({
            type: 'MeshRenderer',
            properties: {
                material: {
                    shader: 'Universal Render Pipeline/Lit',
                    color: hexToRgba(obj.material?.color || '#FFFFFF'),
                    metallic: obj.material?.metallic || 0,
                    smoothness: 1 - (obj.material?.roughness || 0.5),
                },
            },
        });
    }
    // Add model loader component for GLB/GLTF models
    if (obj.type === 'model' && obj.modelPath) {
        components.push({
            type: 'ArsistModelRuntimeLoader',
            properties: {
                modelPath: obj.modelPath,
                destroyAfterLoad: true,
            },
        });
        // **モデルの回転を適用するための補助コンポーネント**
        // (modelLoaderが読み込み後、rotation を設定するため)
        if (obj.transform.rotation.x !== 0 || obj.transform.rotation.y !== 0 || obj.transform.rotation.z !== 0) {
            components.push({
                type: 'ArsistModelRotationApplier',
                properties: {
                    targetRotation: {
                        x: obj.transform.rotation.x,
                        y: obj.transform.rotation.y,
                        z: obj.transform.rotation.z,
                    },
                    applyDelay: 0.5, // モデル読み込み後に遅延適用
                },
            });
        }
    }
    // Add light component
    if (obj.type === 'light') {
        components.push({
            type: 'Light',
            properties: {
                type: 'Point',
                color: hexToRgba(obj.material?.color || '#FFFFFF'),
                intensity: 1,
                range: 10,
            },
        });
    }
    // Add canvas settings for Canvas objects
    if (obj.type === 'canvas' && obj.canvasSettings) {
        components.push({
            type: 'ArsistCanvasSurface',
            properties: {
                layoutId: obj.canvasSettings.layoutId,
                widthMeters: obj.canvasSettings.widthMeters,
                heightMeters: obj.canvasSettings.heightMeters,
                pixelsPerUnit: obj.canvasSettings.pixelsPerUnit,
            },
        });
    }
    return {
        name: obj.name,
        transform: {
            localPosition: obj.transform.position,
            localRotation: obj.transform.rotation,
            localScale: obj.transform.scale,
        },
        components,
        children: obj.children?.map(child => convertObjectToUnity(child)),
    };
}
function getPrimitiveMeshName(primitiveType) {
    switch (primitiveType) {
        case 'cube': return 'Cube';
        case 'sphere': return 'Sphere';
        case 'plane': return 'Plane';
        case 'cylinder': return 'Cylinder';
        case 'capsule': return 'Capsule';
        default: return 'Cube';
    }
}
function hexToRgba(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})?$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16) / 255,
        g: parseInt(result[2], 16) / 255,
        b: parseInt(result[3], 16) / 255,
        a: result[4] ? parseInt(result[4], 16) / 255 : 1,
    } : { r: 1, g: 1, b: 1, a: 1 };
}
/**
 * UIレイアウトをUnity UI Toolkit/uGUI用に変換
 */
function convertUIToUnity(layout) {
    return {
        name: layout.name,
        root: convertUIElementToUnity(layout.root),
    };
}
function convertUIElementToUnity(element) {
    const result = {
        name: `${element.type}_${element.id.substring(0, 8)}`,
        type: element.type,
        rectTransform: calculateRectTransform(element),
        children: element.children?.map(child => convertUIElementToUnity(child)) || [],
    };
    // Layout Group
    if (element.layout && element.layout !== 'Absolute') {
        result.layoutGroup = {
            type: element.layout === 'FlexRow' ? 'Horizontal' :
                element.layout === 'FlexColumn' ? 'Vertical' : 'Grid',
            spacing: element.style.gap || 0,
            childAlignment: mapAlignment(element.style.justifyContent, element.style.alignItems),
            padding: element.style.padding || { left: 0, right: 0, top: 0, bottom: 0 },
        };
    }
    // Image component (for Panel, Button backgrounds)
    if (element.type === 'Panel' || element.type === 'Button') {
        result.image = {
            color: hexToRgba(element.style.backgroundColor || '#00000000'),
            raycastTarget: element.type === 'Button',
        };
        // Blur effect requires special material
        if (element.style.blur) {
            result.image.material = 'UIBlur';
        }
    }
    // Text component
    if (element.type === 'Text' || element.type === 'Button') {
        result.text = {
            text: element.content || '',
            fontSize: element.style.fontSize || 16,
            color: hexToRgba(element.style.color || '#FFFFFF'),
            alignment: mapTextAlignment(element.style.textAlign),
            fontStyle: element.style.fontWeight === 'bold' ? 'Bold' : 'Normal',
        };
    }
    // Button component
    if (element.type === 'Button') {
        const baseColor = hexToRgba(element.style.backgroundColor || '#E94560');
        result.button = {
            targetGraphic: 'Image',
            colors: {
                normalColor: baseColor,
                highlightedColor: { ...baseColor, a: baseColor.a * 0.8 },
                pressedColor: { ...baseColor, a: baseColor.a * 0.6 },
            },
            onClick: '',
        };
    }
    return result;
}
function calculateRectTransform(element) {
    // Default center anchor
    let anchorMin = { x: 0.5, y: 0.5 };
    let anchorMax = { x: 0.5, y: 0.5 };
    let pivot = { x: 0.5, y: 0.5 };
    // Calculate based on position/alignment style
    const pos = element.style.position;
    if (pos === 'absolute') {
        // Absolute positioned: anchor to top-left
        anchorMin = { x: 0, y: 1 };
        anchorMax = { x: 0, y: 1 };
        pivot = { x: 0, y: 1 };
    }
    return {
        anchorMin,
        anchorMax,
        pivot,
        sizeDelta: {
            x: typeof element.style.width === 'number' ? element.style.width : 100,
            y: typeof element.style.height === 'number' ? element.style.height : 100,
        },
        anchoredPosition: {
            x: element.style.left || 0,
            y: -(element.style.top || 0), // Unity Y is inverted
        },
    };
}
function mapAlignment(justify, align) {
    const v = align === 'flex-start' ? 'Upper' :
        align === 'flex-end' ? 'Lower' : 'Middle';
    const h = justify === 'flex-start' ? 'Left' :
        justify === 'flex-end' ? 'Right' : 'Center';
    return `${v}${h}`;
}
function mapTextAlignment(align) {
    switch (align) {
        case 'left': return 'Left';
        case 'center': return 'Center';
        case 'right': return 'Right';
        default: return 'Center';
    }
}
/**
 * プロジェクト全体をUnityマニフェストに変換
 */
function generateUnityManifest(project) {
    const scriptBundle = {
        version: '1.0',
        scripts: (project.scripts ?? [])
            .filter((sc) => sc.enabled)
            .map((sc) => ({
            id: sc.id,
            trigger: sc.trigger,
            code: sc.code,
            enabled: sc.enabled,
        })),
    };
    return {
        arsistVersion: '1.0.0',
        projectId: project.id,
        projectName: project.name,
        appType: project.appType,
        targetDevice: project.targetDevice,
        arSettings: project.arSettings,
        dataFlow: project.dataFlow,
        build: {
            packageName: project.buildSettings.packageName,
            version: project.buildSettings.version,
            versionCode: project.buildSettings.versionCode,
            minSdkVersion: project.buildSettings.minSdkVersion,
            targetSdkVersion: project.buildSettings.targetSdkVersion,
        },
        design: {
            defaultFont: project.designSystem.defaultFont,
            primaryColor: project.designSystem.primaryColor,
            secondaryColor: project.designSystem.secondaryColor,
            backgroundColor: project.designSystem.backgroundColor,
            textColor: project.designSystem.textColor,
        },
        scenes: project.scenes.map(s => ({
            id: s.id,
            name: s.name,
            objectCount: s.objects.length,
        })),
        uiLayouts: project.uiLayouts.map(l => ({
            id: l.id,
            name: l.name,
            scope: l.scope,
        })),
        scriptBundle,
        generatedAt: new Date().toISOString(),
    };
}
//# sourceMappingURL=UnityBridge.js.map