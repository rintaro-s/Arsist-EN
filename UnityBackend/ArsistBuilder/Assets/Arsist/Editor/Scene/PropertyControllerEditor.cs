// ==============================================
// Arsist Engine - Property Controller Editor
// Assets/Arsist/Editor/Scene/PropertyControllerEditor.cs
// ==============================================
#if UNITY_EDITOR

using System.Collections.Generic;
using UnityEditor;
using UnityEngine;
using Arsist.Runtime.Scene;

namespace Arsist.Editor.Scene
{
    [CustomEditor(typeof(PropertyController))]
    public class PropertyControllerEditor : UnityEditor.Editor
    {
        private SerializedProperty _animatorProp;
        private SerializedProperty _blendShapesProp;
        private SerializedProperty _bonesProp;

        private bool _showBlendShapes = false;
        private bool _showBones = false;
        private bool _showDetection = true;

        private void OnEnable()
        {
            _animatorProp = serializedObject.FindProperty("_animator");
            _blendShapesProp = serializedObject.FindProperty("_blendShapes");
            _bonesProp = serializedObject.FindProperty("_bones");
        }

        public override void OnInspectorGUI()
        {
            serializedObject.Update();

            EditorGUILayout.LabelField("Property Controller", EditorStyles.boldLabel);
            EditorGUILayout.Space();

            // Animator参照の表示
            EditorGUILayout.PropertyField(_animatorProp, new GUIContent("Animator", "このGameObjectのAnimator"));
            EditorGUILayout.Space();

            // 能力検出セクション
            DrawDetectionSection();
            EditorGUILayout.Space();

            // BlendShape (表情) セクション
            DrawBlendShapesSection();
            EditorGUILayout.Space();

            // ボーンセクション
            DrawBonesSection();

            serializedObject.ApplyModifiedProperties();
        }

        private void DrawDetectionSection()
        {
            EditorGUILayout.BeginVertical(EditorStyles.helpBox);

            if (GUILayout.Button("🔍 Detect Capabilities", GUILayout.Height(30)))
            {
                DetectCapabilities();
            }

            EditorGUILayout.EndVertical();
        }

        private void DrawBlendShapesSection()
        {
            EditorGUILayout.BeginVertical(EditorStyles.helpBox);

            _showBlendShapes = EditorGUILayout.Foldout(_showBlendShapes,
                $"BlendShapes (表情) [{_blendShapesProp.arraySize}]",
                EditorStyles.foldoutHeader);

            if (_showBlendShapes)
            {
                EditorGUI.indentLevel++;

                if (_blendShapesProp.arraySize == 0)
                {
                    EditorGUILayout.HelpBox("No BlendShapes detected. Click \"Detect Capabilities\" to scan.", MessageType.Info);
                }
                else
                {
                    for (int i = 0; i < _blendShapesProp.arraySize; i++)
                    {
                        DrawBlendShapeProperty(i);
                    }
                }

                EditorGUI.indentLevel--;
            }

            EditorGUILayout.EndVertical();
        }

        private void DrawBlendShapeProperty(int index)
        {
            var element = _blendShapesProp.GetArrayElementAtIndex(index);
            var nameProp = element.FindPropertyRelative("name");
            var rendererProp = element.FindPropertyRelative("renderer");
            var weightProp = element.FindPropertyRelative("weight");

            EditorGUILayout.BeginHorizontal();

            EditorGUILayout.LabelField(nameProp.stringValue, GUILayout.Width(120));
            EditorGUILayout.Slider(weightProp, 0f, 100f, GUILayout.Width(150));

            EditorGUILayout.EndHorizontal();
        }

        private void DrawBonesSection()
        {
            EditorGUILayout.BeginVertical(EditorStyles.helpBox);

            _showBones = EditorGUILayout.Foldout(_showBones,
                $"Humanoid Bones [{_bonesProp.arraySize}]",
                EditorStyles.foldoutHeader);

            if (_showBones)
            {
                EditorGUI.indentLevel++;

                if (_bonesProp.arraySize == 0)
                {
                    EditorGUILayout.HelpBox("No Humanoid bones detected. Ensure Animator is set and is Humanoid.", MessageType.Info);
                }
                else
                {
                    for (int i = 0; i < _bonesProp.arraySize; i++)
                    {
                        DrawBoneProperty(i);
                    }
                }

                EditorGUI.indentLevel--;
            }

            EditorGUILayout.EndVertical();
        }

        private void DrawBoneProperty(int index)
        {
            var element = _bonesProp.GetArrayElementAtIndex(index);
            var boneName = element.FindPropertyRelative("humanoidBoneName").stringValue;
            var rotationProp = element.FindPropertyRelative("_currentLocalRotation");

            EditorGUILayout.BeginVertical(EditorStyles.helpBox);

            EditorGUILayout.LabelField(boneName, EditorStyles.boldLabel);
            EditorGUILayout.PropertyField(rotationProp, new GUIContent("Current Rotation"));

            EditorGUILayout.EndVertical();
        }

        private void DetectCapabilities()
        {
            var controller = (PropertyController)target;
            var gameObject = controller.gameObject;

            // Animatorを検出
            var animator = gameObject.GetComponent<Animator>();
            if (animator == null)
            {
                EditorUtility.DisplayDialog("Warning", "No Animator found on this GameObject", "OK");
                return;
            }

            _animatorProp.objectReferenceValue = animator;

            // BlendShapeを検出
            DetectBlendShapes(gameObject);

            // Humanoidボーンを検出
            if (animator.isHuman)
            {
                DetectHumanoidBones(animator);
            }

            serializedObject.ApplyModifiedProperties();
            EditorUtility.DisplayDialog("Success", "Capabilities detected successfully", "OK");
        }

        private void DetectBlendShapes(GameObject gameObject)
        {
            _blendShapesProp.ClearArray();

            var meshes = gameObject.GetComponentsInChildren<SkinnedMeshRenderer>();
            var seenNames = new HashSet<string>();

            foreach (var smr in meshes)
            {
                if (smr == null || smr.sharedMesh == null) continue;

                int blendCount = smr.sharedMesh.blendShapeCount;
                for (int i = 0; i < blendCount; i++)
                {
                    var name = smr.sharedMesh.GetBlendShapeName(i);

                    if (!string.IsNullOrEmpty(name) && seenNames.Add(name))
                    {
                        int index = _blendShapesProp.arraySize;
                        _blendShapesProp.InsertArrayElementAtIndex(index);

                        var element = _blendShapesProp.GetArrayElementAtIndex(index);
                        element.FindPropertyRelative("name").stringValue = name;
                        element.FindPropertyRelative("renderer").objectReferenceValue = smr;
                        element.FindPropertyRelative("blendShapeIndex").intValue = i;
                    }
                }
            }
        }

        private void DetectHumanoidBones(Animator animator)
        {
            _bonesProp.ClearArray();

            foreach (HumanBodyBones bone in System.Enum.GetValues(typeof(HumanBodyBones)))
            {
                if (bone == HumanBodyBones.LastBone) continue;

                Transform boneTransform = animator.GetBoneTransform(bone);
                if (boneTransform != null)
                {
                    int index = _bonesProp.arraySize;
                    _bonesProp.InsertArrayElementAtIndex(index);

                    var element = _bonesProp.GetArrayElementAtIndex(index);
                    element.FindPropertyRelative("humanoidBoneName").stringValue = bone.ToString();
                    element.FindPropertyRelative("boneType").enumValueIndex = (int)bone;
                    element.FindPropertyRelative("boneTransform").objectReferenceValue = boneTransform;
                }
            }
        }
    }
}

#endif
