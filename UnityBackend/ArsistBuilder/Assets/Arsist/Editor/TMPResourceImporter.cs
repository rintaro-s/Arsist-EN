using UnityEngine;
using UnityEditor;
using System.IO;

namespace Arsist.Builder
{
    /// <summary>
    /// Utility to import TMP Essential Resources and copy fonts to Resources folder
    /// Run this manually in Unity Editor before building if fonts are missing
    /// </summary>
    public class TMPResourceImporter : EditorWindow
    {
        [MenuItem("Arsist/Setup TMP Fonts")]
        public static void SetupTMPFonts()
        {
            Debug.Log("[TMPResourceImporter] Starting TMP font setup...");
            
            // Step 1: Find TMP Essential Resources package
            var packagePath = "Packages/com.unity.ugui/Package Resources/TMP Essential Resources.unitypackage";
            if (File.Exists(packagePath))
            {
                Debug.Log($"[TMPResourceImporter] Found TMP package at: {packagePath}");
                
                // Import the package
                AssetDatabase.ImportPackage(packagePath, false);
                Debug.Log("[TMPResourceImporter] ✅ TMP Essential Resources imported");
            }
            else
            {
                Debug.LogWarning($"[TMPResourceImporter] TMP package not found at: {packagePath}");
            }
            
            // Step 2: Wait for import and refresh
            AssetDatabase.Refresh();
            
            // Step 3: Copy fonts to Resources
            CopyFontsToResources();
        }
        
        private static void CopyFontsToResources()
        {
            Debug.Log("[TMPResourceImporter] Copying fonts to Resources...");
            
            // Ensure Resources folder exists
            if (!AssetDatabase.IsValidFolder("Assets/Resources"))
            {
                AssetDatabase.CreateFolder("Assets", "Resources");
            }
            
            // Search for LiberationSans SDF in entire project
            var fontGuids = AssetDatabase.FindAssets("LiberationSans SDF t:TMP_FontAsset");
            if (fontGuids.Length > 0)
            {
                var sourcePath = AssetDatabase.GUIDToAssetPath(fontGuids[0]);
                var targetPath = "Assets/Resources/LiberationSans SDF.asset";
                
                Debug.Log($"[TMPResourceImporter] Found font at: {sourcePath}");
                
                if (!File.Exists(targetPath))
                {
                    AssetDatabase.CopyAsset(sourcePath, targetPath);
                    Debug.Log($"[TMPResourceImporter] ✅ Copied font to: {targetPath}");
                }
                else
                {
                    Debug.Log($"[TMPResourceImporter] Font already exists at: {targetPath}");
                }
                
                // Copy material too
                var font = AssetDatabase.LoadAssetAtPath<TMPro.TMP_FontAsset>(sourcePath);
                if (font != null && font.material != null)
                {
                    var matSourcePath = AssetDatabase.GetAssetPath(font.material);
                    var matTargetPath = "Assets/Resources/LiberationSans SDF - Material.mat";
                    
                    if (!File.Exists(matTargetPath) && !string.IsNullOrEmpty(matSourcePath))
                    {
                        AssetDatabase.CopyAsset(matSourcePath, matTargetPath);
                        Debug.Log($"[TMPResourceImporter] ✅ Copied material to: {matTargetPath}");
                    }
                }
            }
            else
            {
                Debug.LogError("[TMPResourceImporter] ❌ LiberationSans SDF not found in project!");
                Debug.LogError("[TMPResourceImporter] Please import TMP Essential Resources manually:");
                Debug.LogError("[TMPResourceImporter] Window > TextMeshPro > Import TMP Essential Resources");
            }
            
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();
            Debug.Log("[TMPResourceImporter] ✅ Font setup complete");
        }
    }
}
